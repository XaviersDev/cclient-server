const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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
};
