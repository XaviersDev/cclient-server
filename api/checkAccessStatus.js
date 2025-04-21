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
      return res.status(404).json({
        isLinked: false,
        hasSubscription: false,
        message: 'Access code not found'
      });
    }

    const accessCodeData = accessCodeSnapshot.val();

    
    if (accessCodeData.hwid !== hwid) {
      return res.status(403).json({
        isLinked: false,
        hasSubscription: false,
        message: 'Access code is linked to a different device'
      });
    }

    
    if (!accessCodeData.isLinked || !accessCodeData.telegramId) {
      return res.status(200).json({
        isLinked: false,
        hasSubscription: false,
        message: 'Access code not linked to Telegram'
      });
    }

    
    const subscriptionsSnapshot = await db.ref('subscriptions')
      .orderByChild('telegramId')
      .equalTo(accessCodeData.telegramId)
      .once('value');

    let hasSubscription = false;
    let subscriptionEndTime = 0;

    if (subscriptionsSnapshot.exists()) {
      subscriptionsSnapshot.forEach(child => {
        const subscription = child.val();
        if (subscription.endTime > Date.now()) {
          hasSubscription = true;
          subscriptionEndTime = subscription.endTime;
        }
      });
    }

    res.status(200).json({
      isLinked: true,
      telegramId: accessCodeData.telegramId,
      hasSubscription: hasSubscription,
      subscriptionEndTime: subscriptionEndTime,
      message: hasSubscription ? 'Access code valid with active subscription' : 'No active subscription'
    });
  } catch (error) {
    console.error('Error checking access status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
