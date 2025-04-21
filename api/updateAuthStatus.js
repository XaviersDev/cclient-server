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
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { requestId, status } = req.body;

  if (!requestId || !status || !['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    const db = admin.firestore();
    
    const authRequestDoc = await db.collection('authRequests').doc(requestId).get();
    
    if (!authRequestDoc.exists) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    await db.collection('authRequests').doc(requestId).update({
      status,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(200).json({ success: true, status });
  } catch (error) {
    console.error('Error updating auth status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
