const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_URL
    });
  } catch (error) {
    console.error("Ошибка инициализации Firebase Admin:", error);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const db = admin.database();
      const broadcastsRef = db.ref('adminBroadcasts');
      const snapshot = await broadcastsRef.once('value');
      const broadcasts = snapshot.val() || {};
      res.status(200).json({ broadcasts });
    } catch (error) {
      console.error("Ошибка при получении сообщений:", error);
      res.status(500).json({ error: error.message });
    }
  } else if (req.method === 'DELETE') {
    const key = req.query.key;
    if (!key) {
      res.status(400).json({ error: 'Missing broadcast key' });
      return;
    }
    try {
      const ref = admin.database().ref('adminBroadcasts').child(key);
      await ref.remove();
      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).send('Method Not Allowed');
  }
};
