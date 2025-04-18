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

  const { licenseKey, username, ip, hwid } = req.body;

  console.log('Received license check:', { licenseKey, username, ip, hwid });

  if (!licenseKey || !username || !ip || !hwid) {
    console.error('Missing fields:', { licenseKey, username, ip, hwid });
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

    if (!snapshot.exists()) {
      console.error('License not found:', licenseKey);
      res.status(404).json({ error: 'License not found' });
      return;
    }

    const licenseData = Object.values(snapshot.val())[0];

    if (licenseData.username !== username) {
      console.error('Username mismatch:', { licenseUsername: licenseData.username, providedUsername: username });
      res.status(403).json({ error: 'Username does not match license' });
      return;
    }

    if (!licenseData.isActive) {
      console.error('License inactive:', licenseKey);
      res.status(403).json({ error: 'License is inactive' });
      return;
    }

    console.log('License check successful:', { licenseKey, telegramId: licenseData.telegramId });

    res.status(200).json({
      success: true,
      telegramId: licenseData.telegramId
    });
  } catch (error) {
    console.error('Error checking license:', error);
    res.status(500).json({ error: error.message });
  }
};
