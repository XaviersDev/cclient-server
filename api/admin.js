const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const { action, apiPassword } = req.body;
  if (!apiPassword || apiPassword !== process.env.APIPASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const db = admin.database();
    switch (action) {
      case 'createSubscription': {
        const { telegramId, durationDays } = req.body;
        if (!telegramId || !durationDays) return res.status(400).json({ error: 'Missing required fields' });
        const now = Date.now();
        const subscriptionsSnapshot = await db.ref('subscriptions').orderByChild('telegramId').equalTo(telegramId).once('value');
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
          await db.ref(`subscriptions/${subscriptionId}`).update({ endTime: endTime });
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
        break;
      }
      case 'registerLicense': {
        const { licenseKey, username, telegramId } = req.body;
        if (!licenseKey || !username || !telegramId) return res.status(400).json({ error: 'Missing required fields' });
        const licensesRef = db.ref('licenses');
        const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
        if (snapshot.exists()) return res.status(409).json({ success: false, message: 'Ключ уже существует' });
        await licensesRef.push({
          licenseKey,
          username,
          telegramId,
          created_at: Date.now(),
          active: true
        });
        res.status(200).json({ success: true, message: 'Лицензия зарегистрирована' });
        break;
      }
      case 'cleanExpiredData': {
        const now = Date.now();
        const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
        const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        let authRequestsDeleted = 0;
        const oldAuthRequestsSnapshot = await db.ref('authRequests').orderByChild('createdAt').endAt(oneMonthAgo).limitToFirst(500).once('value');
        if (oldAuthRequestsSnapshot.exists()) {
          const updates = {};
          oldAuthRequestsSnapshot.forEach(child => {
            updates[`authRequests/${child.key}`] = null;
            authRequestsDeleted++;
          });
          await db.ref().update(updates);
        }
        let subscriptionsDeleted = 0;
        const oldSubscriptionsSnapshot = await db.ref('subscriptions').orderByChild('endTime').endAt(threeMonthsAgo).limitToFirst(500).once('value');
        if (oldSubscriptionsSnapshot.exists()) {
          const updates = {};
          oldSubscriptionsSnapshot.forEach(child => {
            updates[`subscriptions/${child.key}`] = null;
            subscriptionsDeleted++;
          });
          await db.ref().update(updates);
        }
        let logsDeleted = 0;
        const oldLogsSnapshot = await db.ref('userLogs').orderByChild('timestamp').endAt(oneMonthAgo).limitToFirst(500).once('value');
        if (oldLogsSnapshot.exists()) {
          const updates = {};
          oldLogsSnapshot.forEach(child => {
            updates[`userLogs/${child.key}`] = null;
            logsDeleted++;
          });
          await db.ref().update(updates);
        }
        let accessCodesDeleted = 0;
        const oldAccessCodesSnapshot = await db.ref('accessCodes').orderByChild('created').endAt(sevenDaysAgo).once('value');
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
        break;
      }
      case 'updateAuthStatus': {
        const { requestId, status } = req.body;
        if (!requestId || !status || !['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Missing or invalid fields' });
        const authRequestSnapshot = await db.ref(`authRequests/${requestId}`).once('value');
        if (!authRequestSnapshot.exists()) return res.status(404).json({ error: 'Request not found' });
        await db.ref(`authRequests/${requestId}`).update({
          status,
          completedAt: admin.database.ServerValue.TIMESTAMP
        });
        res.status(200).json({ success: true, status });
        break;
      }
      default:
        res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Error in admin API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
