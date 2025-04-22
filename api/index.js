const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

const app = express();
app.use(express.json());


app.post('/api/authRequest', async (req, res) => {
  const { telegramId, accessCode, ip, hwid, requestId } = req.body;
  if (!telegramId || !accessCode || !hwid || !requestId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = admin.database();
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
    const botApiResponse = await fetch(`${process.env.TELEGRAM_URL}/api/saveAuthRequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId,
        accessCode,
        ip: ip || 'unknown',
        hwid,
        requestId,
        requestTime: Math.floor(Date.now() / 1000)
      })
    });
    if (!botApiResponse.ok) {
      console.error('Failed to send to bot API:', await botApiResponse.text());
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error creating auth request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/checkAccessStatus', async (req, res) => {
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
  } catch (error) {
    console.error('Error checking access status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/checkAuthStatus', async (req, res) => {
  const { requestId } = req.query;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId parameter' });
  }
  try {
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
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/checkLicense', async (req, res) => {
  const { licenseKey, username, hwid } = req.body;
  console.log('Received license check:', { licenseKey, username, hwid });
  if (!licenseKey || !username || !hwid) {
    console.error('Missing fields:', { licenseKey, username, hwid });
    res.status(400).json({ valid: false, message: 'Missing required fields' });
    return;
  }
  try {
    const db = admin.database();
    const licensesRef = db.ref('licenses');
    const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
    if (!snapshot.exists()) {
      console.log('License not found:', licenseKey);
      res.status(404).json({ valid: false, message: 'Неверный лицензионный ключ' });
      return;
    }
    const licenses = snapshot.val();
    const licenseId = Object.keys(licenses)[0];
    const license = licenses[licenseId];
    console.log('Found license:', { licenseId, license });
    if (license.username !== username) {
      console.log('Username mismatch:', { licenseUsername: license.username, providedUsername: username });
      res.status(403).json({ valid: false, message: 'Ключ привязан к другому пользователю' });
      return;
    }
    if (license.active_hwid && license.active_hwid !== hwid) {
      console.log('HWID mismatch:', { licenseHwid: license.active_hwid, providedHwid: hwid });
      res.status(403).json({ valid: false, message: 'Вы уже играете на другом компьютере!' });
      return;
    }
    await licensesRef.child(licenseId).update({
      last_login: Date.now(),
      active_hwid: hwid
    });
    console.log('License validated, returning telegramId:', license.telegramId);
    res.status(200).json({
      valid: true,
      telegramId: license.telegramId,
      message: 'Лицензия проверена'
    });
  } catch (error) {
    console.error('Error in checkLicense:', error);
    res.status(500).json({ valid: false, message: error.message });
  }
});


app.post('/api/cleanExpiredData', async (req, res) => {
  try {
    const db = admin.database();
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
  } catch (error) {
    console.error('Error cleaning up data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/createSubscription', async (req, res) => {
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
});


app.post('/api/generateAccessCode', async (req, res) => {
  const { hwid, ip } = req.body;
  if (!hwid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = admin.database();
    const accessCode = generateNumericCode(8);
    const formattedCode = `${accessCode.substring(0,2)}-${accessCode.substring(2,4)}-${accessCode.substring(4,6)}-${accessCode.substring(6,8)}`;
    const hwidSnapshot = await db.ref('accessCodes').orderByChild('hwid').equalTo(hwid).once('value');
    if (hwidSnapshot.exists()) {
      const accessCodeData = Object.values(hwidSnapshot.val())[0];
      return res.status(200).json({
        accessCode: accessCodeData.code,
        message: 'Existing code retrieved'
      });
    }
    await db.ref(`accessCodes/${accessCode}`).set({
      code: accessCode,
      hwid: hwid,
      ip: ip || 'unknown',
      created: admin.database.ServerValue.TIMESTAMP,
      isLinked: false,
      telegramId: null
    });
    console.log(`New access code generated: ${formattedCode}`);
    res.status(200).json({
      accessCode: accessCode,
      message: 'New access code generated'
    });
  } catch (error) {
    console.error('Error generating access code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/logoutUser', async (req, res) => {
  const { accessCode, telegramId } = req.body;
  if (!accessCode || !telegramId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = admin.database();
    const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
    if (!accessCodeSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Access code not found' });
    }
    await db.ref('userLogs').push({
      type: 'logout',
      accessCode,
      telegramId,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error logging out user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/registerLicense', async (req, res) => {
  const { licenseKey, username, telegramId, apiPassword } = req.body;
  console.log("Received password:", apiPassword);
  console.log("Expected password:", process.env.APIPASSWORD);
  console.log("Match:", apiPassword === process.env.APIPASSWORD);
  if (!apiPassword || apiPassword !== process.env.APIPASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!licenseKey || !username || !telegramId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  try {
    const db = admin.database();
    const licensesRef = db.ref('licenses');
    const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
    if (snapshot.exists()) {
      res.status(409).json({ success: false, message: 'Ключ уже существует' });
      return;
    }
    await licensesRef.push({
      licenseKey,
      username,
      telegramId,
      created_at: Date.now(),
      active: true
    });
    res.status(200).json({ success: true, message: 'Лицензия зарегистрирована' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post('/api/unlinkAccessCode', async (req, res) => {
  const { accessCode, hwid } = req.body;
  if (!accessCode || !hwid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = admin.database();
    const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
    if (!accessCodeSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Access code not found' });
    }
    const accessCodeData = accessCodeSnapshot.val();
    if (accessCodeData.hwid !== hwid) {
      return res.status(403).json({ success: false, message: 'HWID mismatch' });
    }
    await db.ref(`accessCodes/${accessCode}`).update({
      isLinked: false,
      telegramId: null,
      linkedUsername: null
    });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error unlinking access code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/updateAuthStatus', async (req, res) => {
  const { requestId, status } = req.body;
  if (!requestId || !status || !['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }
  try {
    const db = admin.database();
    const authRequestSnapshot = await db.ref(`authRequests/${requestId}`).once('value');
    if (!authRequestSnapshot.exists()) {
      return res.status(404).json({ error: 'Request not found' });
    }
    await db.ref(`authRequests/${requestId}`).update({
      status,
      completedAt: admin.database.ServerValue.TIMESTAMP
    });
    res.status(200).json({ success: true, status });
  } catch (error) {
    console.error('Error updating auth status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/additionalFunction1', async (req, res) => {
  
  res.status(501).json({ error: 'Not implemented' });
});


app.post('/api/additionalFunction2', async (req, res) => {
  
  res.status(501).json({ error: 'Not implemented' });
});


app.post('/api/additionalFunction3', async (req, res) => {
  
  res.status(501).json({ error: 'Not implemented' });
});

function generateNumericCode(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

module.exports = app;
