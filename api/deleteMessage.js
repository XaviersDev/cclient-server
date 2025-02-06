const admin = require('firebase-admin');
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}
module.exports = async (req, res) => {
  if (req.method !== 'DELETE') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const key = req.query.key;
  if (!key) {
    res.status(400).json({ error: 'Missing message key' });
    return;
  }
  try {
    const ref = admin.database().ref('messages').child(key);
    await ref.remove();
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
