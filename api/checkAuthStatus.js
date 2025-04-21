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
    const db = admin.firestore();
    
    const authRequestDoc = await db.collection('authRequests').doc(requestId).get();
    
    if (!authRequestDoc.exists) {
      return res.status(200).json({ status: 'not_found' });
    }
    
    const authRequest = authRequestDoc.data();
    
    
    const createdAt = authRequest.createdAt?.toDate?.() || new Date(authRequest.createdAt);
    const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
    
    if (createdAt < fiveMinutesAgo && authRequest.status !== 'approved' && authRequest.status !== 'denied') {
      await db.collection('authRequests').doc(requestId).update({
        status: 'expired',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(200).json({ status: 'expired' });
    }
    
    
    if (authRequest.status === 'approved' || authRequest.status === 'denied') {
      await db.collection('authRequests').doc(requestId).update({
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.status(200).json({ status: authRequest.status });
  } catch (error) {
    console.error('Error checking auth status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
