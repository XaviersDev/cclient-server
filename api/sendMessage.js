// api/sendMessage.js

const admin = require('firebase-admin');

// Инициализация firebase-admin (однократно)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_URL // Пример: "https://your-database.firebaseio.com/"
    });
  } catch (error) {
    console.error("Ошибка инициализации Firebase Admin:", error);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    // Ожидаем JSON с полями: from, to, content
    const { from, to, content } = req.body;
    if (!from || !to || !content) {
      res.status(400).json({ error: 'Missing required fields: from, to, content' });
      return;
    }

    const db = admin.database();
    const messagesRef = db.ref('messages');

    // Формируем объект сообщения
    const messageData = {
      from,
      to,
      content,
      timestamp: Date.now()
    };

    await messagesRef.push(messageData);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Ошибка при отправке сообщения:", error);
    res.status(500).json({ error: error.message });
  }
};
