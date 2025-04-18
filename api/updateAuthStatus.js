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

  const { requestId, status } = req.body;

  console.log('Received status update:', { requestId, status });

  if (!requestId || !status || !['approved', 'denied'].includes(status)) {
    console.error('Missing or invalid fields:', { requestId, status });
    res.status(400).json({ error: 'Missing or invalid fields' });
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
      console.error('Request not found:', requestId);
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const requestKey = Object.keys(snapshot.val())[0];
    await authRequestsRef.child(requestKey).update({
      status,
      completed_at: Date.now()
    });

    console.log('Updated auth request status:', { requestId, status });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating auth status:', error);
    res.status(500).json({ error: error.message });
  }
};
