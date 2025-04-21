const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

module.exports = async (req, res) => {
  try {
    const db = admin.firestore();
    const now = Date.now();
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
    
    
    const oldAuthRequestsSnapshot = await db.collection('authRequests')
      .where('createdAt', '<', admin.firestore.Timestamp.fromMillis(oneMonthAgo))
      .limit(500)  
      .get();
    
    let authRequestsDeleted = 0;
    if (!oldAuthRequestsSnapshot.empty) {
      const batch = db.batch();
      oldAuthRequestsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
        authRequestsDeleted++;
      });
      await batch.commit();
    }
    
    
    const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
    const oldSubscriptionsSnapshot = await db.collection('subscriptions')
      .where('endTime', '<', threeMonthsAgo)
      .limit(500)
      .get();
    
    let subscriptionsDeleted = 0;
    if (!oldSubscriptionsSnapshot.empty) {
      const batch = db.batch();
      oldSubscriptionsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
        subscriptionsDeleted++;
      });
      await batch.commit();
    }
    
    
    const oldLogsSnapshot = await db.collection('userLogs')
      .where('timestamp', '<', admin.firestore.Timestamp.fromMillis(oneMonthAgo))
      .limit(500)
      .get();
    
    let logsDeleted = 0;
    if (!oldLogsSnapshot.empty) {
      const batch = db.batch();
      oldLogsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
        logsDeleted++;
      });
      await batch.commit();
    }
    
    
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const oldAccessCodesSnapshot = await db.collection('accessCodes')
      .where('isLinked', '==', false)
      .where('created', '<', admin.firestore.Timestamp.fromMillis(sevenDaysAgo))
      .limit(500)
      .get();
    
    let accessCodesDeleted = 0;
    if (!oldAccessCodesSnapshot.empty) {
      const batch = db.batch();
      oldAccessCodesSnapshot.forEach(doc => {
        batch.delete(doc.ref);
        accessCodesDeleted++;
      });
      await batch.commit();
    }
    
    res.status(200).json({
      success: true,
      authRequestsDeleted,
      subscriptionsDeleted,
      logsDeleted,
      accessCodesDeleted
    });
  } catch (error) {
    console.error('Error cleaning up data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
