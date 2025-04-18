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
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { telegramId, username, ip, hwid, requestId } = req.body;
  
  if (!telegramId || !username || !ip || !hwid || !requestId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const db = admin.database();
    const authRequestsRef = db.ref('authRequests');
  
    const snapshot = await authRequestsRef
      .orderByChild('telegramId')
      .equalTo(telegramId)
      .once('value');
    
    if (snapshot.exists()) {
      const requests = snapshot.val();
      for (const key in requests) {
        if (requests[key].status === 'pending' || requests[key].status === 'sent') {
          await authRequestsRef.child(key).update({
            status: 'expired',
            completed_at: Date.now()
          });
        }
      }
    }
    
    await authRequestsRef.push({
      telegramId,
      username,
      ip,
      hwid,
      requestId,
      created_at: Date.now(),
      status: 'pending'
    });
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in authRequest:', error);
    res.status(500).json({ error: error.message });
  }
};
