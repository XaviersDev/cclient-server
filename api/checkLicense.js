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
  
  if (!licenseKey || !username || !hwid) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const db = admin.database();
    const licensesRef = db.ref('licenses');
    
    const snapshot = await licensesRef
      .orderByChild('licenseKey')
      .equalTo(licenseKey)
      .once('value');
    
    const licenses = snapshot.val();
    
    if (!licenses) {
      res.status(404).json({ valid: false, message: 'Неверный лицензионный ключ' });
      return;
    }
    
    const licenseId = Object.keys(licenses)[0];
    const license = licenses[licenseId];
    
    if (license.username !== username) {
      res.status(403).json({ valid: false, message: 'Ключ привязан к другому пользователю' });
      return;
    }
    
    if (license.active_hwid && license.active_hwid !== hwid) {
      res.status(403).json({ valid: false, message: 'Вы уже играете на другом компьютере!' });
      return;
    }
    
    await licensesRef.child(licenseId).update({
      last_login: Date.now(),
      active_hwid: hwid
    });
    
    res.status(200).json({ 
      valid: true, 
      telegramId: license.telegramId,
      message: 'Лицензия проверена'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
