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
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { accessCode, hwid } = req.body;

  if (!accessCode || !hwid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = admin.database();
    const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');

    if (!accessCodeSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Access code not found' });
    }

    const accessCodeData = accessCodeSnapshot.val();

    if (accessCodeData.hwid !== hwid) {
      return res.status(403).json({ success: false, message: 'HWID mismatch' });
    }

    await db.ref(`accessCodes/${accessCode}`).update({
      isLinked: false,
      telegramId: null,
      linkedUsername: null
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error unlinking access code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
