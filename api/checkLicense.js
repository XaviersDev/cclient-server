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

  console.log('Checking license:', { licenseKey, username, ip, hwid });

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

    const license = Object.values(snapshot.val())[0];
    if (license.username !== username || license.isActive === false) {
      console.error('Invalid license:', { licenseKey, username });
      res.status(403).json({ error: 'Invalid license' });
      return;
    }

    const authRequestsRef = db.ref('authRequests');
    const authSnapshot = await authRequestsRef
      .orderByChild('telegramId')
      .equalTo(license.telegramId)
      .limitToLast(1)
      .once('value');

    if (authSnapshot.exists()) {
      const authRequest = Object.values(authSnapshot.val())[0];
      if (authRequest.status === 'approved') {
        console.log('License approved:', { licenseKey, telegramId: license.telegramId });
        res.status(200).json({ success: true, telegramId: license.telegramId });
        return;
      } else if (authRequest.status === 'denied') {
        console.log('License denied:', { licenseKey, telegramId: license.telegramId });
        res.status(403).json({ error: 'License authorization denied' });
        return;
      }
    }

    console.log('No auth request found, requiring Telegram auth:', { licenseKey, telegramId: license.telegramId });
    res.status(200).json({ success: true, telegramId: license.telegramId, requiresAuth: true });
  } catch (error) {
    console.error('Error checking license:', error);
    res.status(500).json({ error: error.message });
  }
};
