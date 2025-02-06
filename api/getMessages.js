// api/getMessages.js

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
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    // Ожидаем query параметр "user" (например, ?user=YourUsername)
    const user = req.query.user;
    if (!user) {
      res.status(400).json({ error: 'Missing query parameter: user' });
      return;
    }

    const db = admin.database();
    const messagesRef = db.ref('messages');

    // Получаем сообщения, где поле "to" равно значению user
    const snapshot = await messagesRef.orderByChild('to').equalTo(user).once('value');
    const messages = snapshot.val() || {};

    res.status(200).json({ messages });
  } catch (error) {
    console.error("Ошибка при получении сообщений:", error);
    res.status(500).json({ error: error.message });
  }
};
