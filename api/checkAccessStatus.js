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
    const db = admin.firestore();
    
    
    const accessCodeDoc = await db.collection('accessCodes').doc(accessCode).get();
    
    if (!accessCodeDoc.exists) {
      return res.status(404).json({ 
        isLinked: false,
        hasSubscription: false,
        message: 'Access code not found' 
      });
    }
    
    const accessCodeData = accessCodeDoc.data();
    
    
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
    
    
    const subscriptionsSnapshot = await db.collection('subscriptions')
      .where('telegramId', '==', accessCodeData.telegramId)
      .where('endTime', '>', Date.now())
      .limit(1)
      .get();
    
    const hasSubscription = !subscriptionsSnapshot.empty;
    let subscriptionEndTime = 0;
    
    if (hasSubscription) {
      subscriptionEndTime = subscriptionsSnapshot.docs[0].data().endTime;
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
