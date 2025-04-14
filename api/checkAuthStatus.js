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
      res.status(404).json({ status: 'not_found' });
      return;
    }
    
    const requests = snapshot.val();
    const requestKey = Object.keys(requests)[0];
    const authRequest = requests[requestKey];
    
    if (authRequest.status === 'approved') {
      await authRequestsRef.child(requestKey).update({
        status: 'completed',
        completed_at: Date.now()
      });
      
      res.status(200).json({ status: 'approved' });
    } else if (authRequest.status === 'denied') {
      await authRequestsRef.child(requestKey).update({
        status: 'completed',
        completed_at: Date.now()
      });
      
      res.status(200).json({ status: 'denied' });
    } else {
      res.status(200).json({ status: 'pending' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
