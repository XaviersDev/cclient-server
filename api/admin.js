const admin = require('firebase-admin');
const fs = require('fs');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

module.exports = async (req, res) => {
  const log = (message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message} ${JSON.stringify(data)}\n`;
    fs.appendFileSync('admin.log', logEntry);
    console.log(logEntry);
  };

  log('Received request', { method: req.method, body: req.body });

  if (req.method !== 'POST') {
    log('Method not allowed', { method: req.method });
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { action, apiPassword } = req.body;
  if (!apiPassword || apiPassword !== process.env.APIPASSWORD) {
    log('Unauthorized access attempt', { action });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const db = admin.database();
    log('Processing action', { action });
    switch (action) {
      case 'createSubscription': {
        const { telegramId, durationDays } = req.body;
        if (!telegramId || !durationDays) {
          log('Missing required fields for createSubscription', { telegramId, durationDays });
          return res.status(400).json({ error: 'Missing required fields' });
        }
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
          log('Updating existing subscription', { subscriptionId, telegramId, endTime });
          await db.ref(`subscriptions/${subscriptionId}`).update({ endTime: endTime });
        } else {
          const newSubRef = db.ref('subscriptions').push();
          log('Creating new subscription', { subscriptionId: newSubRef.key, telegramId, endTime });
          await newSubRef.set({
            telegramId: telegramId,
            startTime: now,
            endTime: endTime,
            createdAt: now
          });
          subscriptionId = newSubRef.key;
        }
        log('Subscription processed successfully', { telegramId, endTime });
        res.status(200).json({ success: true, endTime: endTime });
        break;
      }
      case 'registerLicense': {
        const { licenseKey, username, telegramId } = req.body;
        if (!licenseKey || !username || !telegramId) {
          log('Missing required fields for registerLicense', { licenseKey, username, telegramId });
          return res.status(400).json({ error: 'Missing required fields' });
        }
        const licensesRef = db.ref('licenses');
        const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
        if (snapshot.exists()) {
          log('License key already exists', { licenseKey });
          return res.status(409).json({ success: false, message: 'Ключ уже существует' });
        }
        log('Registering new license', { licenseKey, username, telegramId });
        await licensesRef.push({
          licenseKey,
          username,
          telegramId,
          created_at: Date.now(),
          active: true
        });
        log('License registered successfully', { licenseKey });
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
        log('Cleaned expired data', { authRequestsDeleted, subscriptionsDeleted, logsDeleted, accessCodesDeleted });
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
        if (!requestId || !status || !['approved', 'denied'].includes(status)) {
          log('Missing or invalid fields for updateAuthStatus', { requestId, status });
          return res.status(400).json({ error: 'Missing or invalid fields' });
        }
        const authRequestSnapshot = await db.ref(`authRequests/${requestId}`).once('value');
        if (!authRequestSnapshot.exists()) {
          log('Auth request not found', { requestId });
          return res.status(404).json({ error: 'Request not found' });
        }
        log('Updating auth status', { requestId, status });
        await db.ref(`authRequests/${requestId}`).update({
          status,
          completedAt: admin.database.ServerValue.TIMESTAMP
        });
        log('Auth status updated successfully', { requestId, status });
        res.status(200).json({ success: true, status });
        break;
      }
      default:
        log('Invalid action', { action });
        res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    log('Error in admin API', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Internal server error' });
  }
};
