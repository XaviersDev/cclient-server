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

  const { licenseKey, username } = req.body;
  
  if (!licenseKey || !username) {
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
      res.status(404).json({ success: false, message: 'Лицензия не найдена' });
      return;
    }
    
    const licenses = snapshot.val();
    const licenseId = Object.keys(licenses)[0];
    const license = licenses[licenseId];
    
    if (license.username !== username) {
      res.status(403).json({ success: false, message: 'Неверный пользователь' });
      return;
    }
    
    await licensesRef.child(licenseId).update({
      active_hwid: null,
      last_logout: Date.now()
    });
    
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
