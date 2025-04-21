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
    const db = admin.database();
    const now = Date.now();
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
    const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    
    let authRequestsDeleted = 0;
    const oldAuthRequestsSnapshot = await db.ref('authRequests')
      .orderByChild('createdAt')
      .endAt(oneMonthAgo)
      .limitToFirst(500)
      .once('value');

    if (oldAuthRequestsSnapshot.exists()) {
      const updates = {};
      oldAuthRequestsSnapshot.forEach(child => {
        updates[`authRequests/${child.key}`] = null;
        authRequestsDeleted++;
      });
      await db.ref().update(updates);
    }

    
    let subscriptionsDeleted = 0;
    const oldSubscriptionsSnapshot = await db.ref('subscriptions')
      .orderByChild('endTime')
      .endAt(threeMonthsAgo)
      .limitToFirst(500)
      .once('value');

    if (oldSubscriptionsSnapshot.exists()) {
      const updates = {};
      oldSubscriptionsSnapshot.forEach(child => {
        updates[`subscriptions/${child.key}`] = null;
        subscriptionsDeleted++;
      });
      await db.ref().update(updates);
    }

    
    let logsDeleted = 0;
    const oldLogsSnapshot = await db.ref('userLogs')
      .orderByChild('timestamp')
      .endAt(oneMonthAgo)
      .limitToFirst(500)
      .once('value');

    if (oldLogsSnapshot.exists()) {
      const updates = {};
      oldLogsSnapshot.forEach(child => {
        updates[`userLogs/${child.key}`] = null;
        logsDeleted++;
      });
      await db.ref().update(updates);
    }

    
    let accessCodesDeleted = 0;
    const oldAccessCodesSnapshot = await db.ref('accessCodes')
      .orderByChild('created')
      .endAt(sevenDaysAgo)
      .once('value');

    if (oldAccessCodesSnapshot.exists()) {
      const updates = {};
      oldAccessCodesSnapshot.forEach(child => {
        const accessCode = child.val();
        if (!accessCode.isLinked) {
          updates[`accessCodes/${child.key}`] = null;
          accessCodesDeleted++;
        }
      });
      await db.ref().update(updates);
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
