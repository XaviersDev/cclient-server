const admin = require('firebase-admin');
const crypto = require('crypto');

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

  const { hwid, ip } = req.body;

  if (!hwid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = admin.firestore();
    
    
    const accessCode = generateNumericCode(8);
    const formattedCode = `${accessCode.substring(0,2)}-${accessCode.substring(2,4)}-${accessCode.substring(4,6)}-${accessCode.substring(6,8)}`;
    
    
    const hwidSnapshot = await db.collection('accessCodes')
      .where('hwid', '==', hwid)
      .limit(1)
      .get();
    
    if (!hwidSnapshot.empty) {
      
      const doc = hwidSnapshot.docs[0];
      return res.status(200).json({ 
        accessCode: doc.data().code,
        message: 'Existing code retrieved' 
      });
    }
    
    
    await db.collection('accessCodes').doc(accessCode).set({
      code: accessCode,
      hwid: hwid,
      ip: ip || 'unknown',
      created: admin.firestore.FieldValue.serverTimestamp(),
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
};

function generateNumericCode(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}
