const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { licenseKey, username, hwid } = req.body;

  console.log('Received license check:', { licenseKey, username, hwid });

  if (!licenseKey || !username || !hwid) {
    console.error('Missing fields:', { licenseKey, username, hwid });
    res.status(400).json({ valid: false, message: 'Missing required fields' });
    return;
  }

  try {
    const db = admin.database();
    const licensesRef = db.ref('licenses');

    const snapshot = await licensesRef
      .orderByChild('licenseKey')
      .equalTo(licenseKey)
      .once('value');

    if (!snapshot.exists()) {
      console.log('License not found:', licenseKey);
      res.status(404).json({ valid: false, message: 'Неверный лицензионный ключ' });
      return;
    }

    const licenses = snapshot.val();
    const licenseId = Object.keys(licenses)[0];
    const license = licenses[licenseId];

    console.log('Found license:', { licenseId, license });

    if (license.username !== username) {
      console.log('Username mismatch:', { licenseUsername: license.username, providedUsername: username });
      res.status(403).json({ valid: false, message: 'Ключ привязан к другому пользователю' });
      return;
    }

    if (license.active_hwid && license.active_hwid !== hwid) {
      console.log('HWID mismatch:', { licenseHwid: license.active_hwid, providedHwid: hwid });
      res.status(403).json({ valid: false, message: 'Вы уже играете на другом компьютере!' });
      return;
    }

    await licensesRef.child(licenseId).update({
      last_login: Date.now(),
      active_hwid: hwid
    });

    console.log('License validated, returning telegramId:', license.telegramId);
    res.status(200).json({
      valid: true,
      telegramId: license.telegramId,
      message: 'Лицензия проверена'
    });
  } catch (error) {
    console.error('Error in checkLicense:', error);
    res.status(500).json({ valid: false, message: error.message });
  }
};
