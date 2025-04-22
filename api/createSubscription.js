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

  const { telegramId, durationDays, apiPassword } = req.body;

  if (!telegramId || !durationDays || !apiPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (apiPassword !== process.env.APIPASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = admin.database();
    const now = Date.now();
    const subscriptionsSnapshot = await db.ref('subscriptions')
      .orderByChild('telegramId')
      .equalTo(telegramId)
      .once('value');

    let subscriptionId = null;
    let endTime = now + (durationDays * 24 * 60 * 60 * 1000);

    if (subscriptionsSnapshot.exists()) {
      subscriptionsSnapshot.forEach(child => {
        const sub = child.val();
        if (sub.endTime > now) {
          subscriptionId = child.key;
          endTime = sub.endTime + (durationDays * 24 * 60 * 60 * 1000);
        }
      });
    }

    if (subscriptionId) {
      await db.ref(`subscriptions/${subscriptionId}`).update({
        endTime: endTime
      });
    } else {
      const newSubRef = db.ref('subscriptions').push();
      await newSubRef.set({
        telegramId: telegramId,
        startTime: now,
        endTime: endTime,
        createdAt: now
      });
      subscriptionId = newSubRef.key;
    }

    res.status(200).json({ success: true, endTime: endTime });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
