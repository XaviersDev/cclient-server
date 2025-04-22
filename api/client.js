const admin = require('firebase-admin');
const fetch = require('node-fetch');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

function generateNumericCode(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { requestId } = req.query;
      if (requestId) {
        const db = admin.database();
        const authRequestSnapshot = await db.ref(`authRequests/${requestId}`).once('value');
        if (!authRequestSnapshot.exists()) {
          return res.status(200).json({ status: 'not_found' });
        }
        const authRequest = authRequestSnapshot.val();
        const createdAt = authRequest.createdAt || Date.now();
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        if (createdAt < fiveMinutesAgo && authRequest.status !== 'approved' && authRequest.status !== 'denied') {
          await db.ref(`authRequests/${requestId}`).update({
            status: 'expired',
            completedAt: admin.database.ServerValue.TIMESTAMP
          });
          return res.status(200).json({ status: 'expired' });
        }
        if (authRequest.status === 'approved' || authRequest.status === 'denied') {
          await db.ref(`authRequests/${requestId}`).update({
            status: 'completed',
            completedAt: admin.database.ServerValue.TIMESTAMP
          });
        }
        res.status(200).json({ status: authRequest.status });
      } else {
        res.status(400).json({ error: 'Missing requestId' });
      }
    } else if (req.method === 'POST') {
      const { action } = req.body;
      const db = admin.database();
      switch (action) {
        case 'generateAccessCode': {
          const { hwid, ip } = req.body;
          if (!hwid) return res.status(400).json({ error: 'Missing required fields' });
          const accessCode = generateNumericCode(8);
          const hwidSnapshot = await db.ref('accessCodes').orderByChild('hwid').equalTo(hwid).once('value');
          if (hwidSnapshot.exists()) {
            const accessCodeData = Object.values(hwidSnapshot.val())[0];
            return res.status(200).json({ accessCode: accessCodeData.code, message: 'Existing code retrieved' });
          }
          await db.ref(`accessCodes/${accessCode}`).set({
            code: accessCode,
            hwid: hwid,
            ip: ip || 'unknown',
            created: admin.database.ServerValue.TIMESTAMP,
            isLinked: false,
            telegramId: null
          });
          res.status(200).json({ accessCode: accessCode, message: 'New access code generated' });
          break;
        }
        case 'checkAccessStatus': {
          const { accessCode, hwid } = req.body;
          if (!accessCode || !hwid) return res.status(400).json({ error: 'Missing required fields' });
          const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
          if (!accessCodeSnapshot.exists()) {
            return res.status(404).json({ isLinked: false, hasSubscription: false, message: 'Access code not found' });
          }
          const accessCodeData = accessCodeSnapshot.val();
          if (accessCodeData.hwid !== hwid) {
            return res.status(403).json({ isLinked: false, hasSubscription: false, message: 'Access code is linked to a different device' });
          }
          if (!accessCodeData.isLinked || !accessCodeData.telegramId) {
            return res.status(200).json({ isLinked: false, hasSubscription: false, message: 'Access code not linked to Telegram' });
          }
          const subscriptionsSnapshot = await db.ref('subscriptions').orderByChild('telegramId').equalTo(accessCodeData.telegramId).once('value');
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
            linkedUsername: accessCodeData.linkedUsername || 'Unknown',
            hasSubscription: hasSubscription,
            subscriptionEndTime: subscriptionEndTime,
            message: hasSubscription ? 'Access code valid with active subscription' : 'No active subscription'
          });
          break;
        }
        case 'authRequest': {
          const { telegramId, accessCode, ip, hwid, requestId } = req.body;
          if (!telegramId || !accessCode || !hwid || !requestId) return res.status(400).json({ error: 'Missing required fields' });
          const oldRequestsSnapshot = await db.ref('authRequests').orderByChild('telegramId').equalTo(telegramId).once('value');
          if (oldRequestsSnapshot.exists()) {
            const updates = {};
            oldRequestsSnapshot.forEach(child => {
              const request = child.val();
              if (request.status === 'pending' || request.status === 'sent') {
                updates[`authRequests/${child.key}/status`] = 'expired';
                updates[`authRequests/${child.key}/completedAt`] = admin.database.ServerValue.TIMESTAMP;
              }
            });
            await db.ref().update(updates);
          }
          await db.ref(`authRequests/${requestId}`).set({
            telegramId,
            accessCode,
            ip: ip || 'unknown',
            hwid,
            requestId,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            status: 'pending'
          });
          await fetch(`${process.env.TELEGRAM_URL}/api/saveAuthRequest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, accessCode, ip: ip || 'unknown', hwid, requestId, requestTime: Math.floor(Date.now() / 1000) })
          });
          res.status(200).json({ success: true });
          break;
        }
        case 'logoutUser': {
          const { accessCode, telegramId } = req.body;
          if (!accessCode || !telegramId) return res.status(400).json({ error: 'Missing required fields' });
          const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
          if (!accessCodeSnapshot.exists()) return res.status(404).json({ success: false, message: 'Access code not found' });
          await db.ref('userLogs').push({
            type: 'logout',
            accessCode,
            telegramId,
            timestamp: admin.database.ServerValue.TIMESTAMP
          });
          res.status(200).json({ success: true });
          break;
        }
        case 'unlinkAccessCode': {
          const { accessCode, hwid } = req.body;
          if (!accessCode || !hwid) return res.status(400).json({ error: 'Missing required fields' });
          const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
          if (!accessCodeSnapshot.exists()) return res.status(404).json({ success: false, message: 'Access code not found' });
          const accessCodeData = accessCodeSnapshot.val();
          if (accessCodeData.hwid !== hwid) return res.status(403).json({ success: false, message: 'HWID mismatch' });
          await db.ref(`accessCodes/${accessCode}`).update({
            isLinked: false,
            telegramId: null,
            linkedUsername: null
          });
          res.status(200).json({ success: true });
          break;
        }
        case 'checkLicense': {
          const { licenseKey, username, hwid } = req.body;
          if (!licenseKey || !username || !hwid) return res.status(400).json({ valid: false, message: 'Missing required fields' });
          const licensesRef = db.ref('licenses');
          const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
          if (!snapshot.exists()) return res.status(404).json({ valid: false, message: 'Неверный лицензионный ключ' });
          const licenses = snapshot.val();
          const licenseId = Object.keys(licenses)[0];
          const license = licenses[licenseId];
          if (license.username !== username) return res.status(403).json({ valid: false, message: 'Ключ привязан к другому пользователю' });
          if (license.active_hwid && license.active_hwid !== hwid) return res.status(403).json({ valid: false, message: 'Вы уже играете на другом компьютере!' });
          await licensesRef.child(licenseId).update({
            last_login: Date.now(),
            active_hwid: hwid
          });
          res.status(200).json({ valid: true, telegramId: license.telegramId, message: 'Лицензия проверена' });
          break;
        }
        default:
          res.status(400).json({ error: 'Invalid action' });
      }
    } else {
      res.status(405).json({ error: 'Method Not Allowed' });
    }
  } catch (error) {
    console.error('Error in client API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
