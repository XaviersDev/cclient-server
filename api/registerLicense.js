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
  
  const { licenseKey, username, telegramId, apiPassword } = req.body;

  console.log("Received password:", apiPassword);
  console.log("Expected password:", process.env.APIPASSWORD);
  console.log("Match:", apiPassword === process.env.APIPASSWORD);
  
  if (!apiPassword || apiPassword !== process.env.APIPASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  
  if (!licenseKey || !username || !telegramId) {
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
    
    if (snapshot.exists()) {
      res.status(409).json({ success: false, message: 'Ключ уже существует' });
      return;
    }
    
    await licensesRef.push({
      licenseKey,
      username,
      telegramId,
      created_at: Date.now(),
      active: true
    });
    
    res.status(200).json({ success: true, message: 'Лицензия зарегистрирована' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
