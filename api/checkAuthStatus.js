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
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { requestId } = req.query;
  
  if (!requestId) {
    res.status(400).json({ error: 'Missing requestId parameter' });
    return;
  }

  try {
    const db = admin.database();
    const authRequestsRef = db.ref('authRequests');
    
    const snapshot = await authRequestsRef
      .orderByChild('requestId')
      .equalTo(requestId)
      .once('value');
    
    if (!snapshot.exists()) {
      res.status(200).json({ status: 'not_found' });
      return;
    }
    
    const requests = snapshot.val();
    const requestKey = Object.keys(requests)[0];
    const authRequest = requests[requestKey];
    
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (authRequest.created_at < fiveMinutesAgo && authRequest.status !== 'approved' && authRequest.status !== 'denied') {
      await authRequestsRef.child(requestKey).update({
        status: 'expired',
        completed_at: Date.now()
      });
      res.status(200).json({ status: 'expired' });
      return;
    }
    
    if (authRequest.status === 'approved' || authRequest.status === 'denied') {
      await authRequestsRef.child(requestKey).update({
        status: 'completed',
        completed_at: Date.now()
      });
    }
    
    res.status(200).json({ status: authRequest.status });
  } catch (error) {
    console.error('Error in checkAuthStatus:', error);
    res.status(500).json({ error: error.message });
  }
};
