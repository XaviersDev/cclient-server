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

  if (!requestId || !status || !['approved', 'denied'].includes(status)) {
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
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const requestKey = Object.keys(snapshot.val())[0];
    await authRequestsRef.child(requestKey).update({
      status,
      completed_at: Date.now()
    });

    res.status(200).json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
