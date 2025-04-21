const admin = require('firebase-admin');
const fetch = require('node-fetch');

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

  const { telegramId, accessCode, ip, hwid, requestId } = req.body;

  if (!telegramId || !accessCode || !hwid || !requestId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = admin.database();

    
    const oldRequestsSnapshot = await db.ref('authRequests')
      .orderByChild('telegramId')
      .equalTo(telegramId)
      .once('value');

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
};
