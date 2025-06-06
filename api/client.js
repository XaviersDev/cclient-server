const admin = require('firebase-admin');
const fetch = require('node-fetch'); 


if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_URL
    });
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK in client.js:", error);
  }
}

function generateNumericCode(length) {
  let result = '';
  const characters = '0123456789';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

module.exports = async (req, res) => {
  try {
    const db = admin.database();
    const now = Date.now();

    if (req.method === 'GET') {
      const { requestId } = req.query;
      if (requestId) {
        const authRequestSnapshot = await db.ref(`authRequests/${requestId}`).once('value');
        if (!authRequestSnapshot.exists()) {
          return res.status(200).json({ status: 'not_found', message: 'Auth request ID not found.' });
        }
        const authRequest = authRequestSnapshot.val();
        
        
        
        const requestCreatedAt = authRequest.createdAt || authRequest.requestTime * 1000 || 0; 
        const tenMinutesMs = 10 * 60 * 1000;

        if ((authRequest.status === 'pending' || authRequest.status === 'sent') && (requestCreatedAt < (now - tenMinutesMs))) {
            const newStatus = authRequest.status === 'pending' ? 'expired_pending_polled' : 'expired_sent_polled';
            await db.ref(`authRequests/${requestId}`).update({
                status: newStatus,
                completedAt: admin.database.ServerValue.TIMESTAMP, 
                reason: "Expired due to client poll on old request"
            });
            return res.status(200).json({ status: newStatus, message: `Request expired (${newStatus}).` });
        }
        
        return res.status(200).json({ status: authRequest.status, details: authRequest });

      } else {
        return res.status(400).json({ error: 'Missing requestId parameter' });
      }
    } else if (req.method === 'POST') {
      const { action } = req.body;
      switch (action) {
        case 'generateAccessCode': {
          const { hwid, ip } = req.body;
          if (!hwid) return res.status(400).json({ error: 'Missing required field: hwid' });

          
          const hwidSnapshot = await db.ref('accessCodes').orderByChild('hwid').equalTo(hwid).once('value');
          if (hwidSnapshot.exists()) {
            
            const codes = hwidSnapshot.val();
            const existingCodeKey = Object.keys(codes)[0]; 
            const existingCodeData = codes[existingCodeKey];
            return res.status(200).json({ accessCode: existingCodeData.code, message: 'Existing access code retrieved for this HWID.' });
          }

          
          let accessCode;
          let codeExists = true;
          let attempts = 0;
          do {
            accessCode = generateNumericCode(8);
            const codeCheckSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
            codeExists = codeCheckSnapshot.exists();
            attempts++;
            if (attempts > 10 && codeExists) { 
                return res.status(500).json({error: "Failed to generate a unique access code after multiple attempts."});
            }
          } while (codeExists);

          await db.ref(`accessCodes/${accessCode}`).set({
            code: accessCode,
            hwid: hwid,
            ip: ip || 'unknown',
            created: admin.database.ServerValue.TIMESTAMP,
            isLinked: false,
            telegramId: null
          });
          return res.status(200).json({ accessCode: accessCode, message: 'New access code generated.' });
        }

        case 'checkAccessStatus': {
          const { accessCode, hwid } = req.body;
          if (!accessCode || !hwid) return res.status(400).json({ error: 'Missing required fields (accessCode, hwid)' });

          const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
          if (!accessCodeSnapshot.exists()) {
            return res.status(200).json({ isLinked: false, hasSubscription: false, isActive: false, message: 'Access code not found.' });
          }
          const accessCodeData = accessCodeSnapshot.val();

          if (accessCodeData.hwid !== hwid) {
            
            console.warn(`HWID mismatch for accessCode ${accessCode}. Expected ${accessCodeData.hwid}, got ${hwid}`);
            return res.status(200).json({ isLinked: false, hasSubscription: false, isActive: false, message: 'Access code is registered to a different device.' });
          }

          if (!accessCodeData.isLinked || !accessCodeData.telegramId) {
            return res.status(200).json({ isLinked: false, hasSubscription: false, isActive: false, message: 'Access code not linked to a Telegram account yet.' });
          }

          
          const telegramIdStr = String(accessCodeData.telegramId);
          const banSnapshot = await db.ref(`userBans/${telegramIdStr}`).once('value');
          if (banSnapshot.exists()) {
              const banData = banSnapshot.val();
              if (banData.isActive && banData.banEndTime > now) {
                  return res.status(200).json({
                      isLinked: true,
                      telegramId: telegramIdStr,
                      isActive: false, 
                      isBanned: true,
                      banReason: banData.reason,
                      banEndTime: banData.banEndTime,
                      message: `User is banned until ${new Date(banData.banEndTime).toLocaleString()}. Reason: ${banData.reason}`
                  });
              }
          }

          
          const subscriptionsSnapshot = await db.ref('subscriptions').orderByChild('telegramId').equalTo(telegramIdStr).once('value');
          let hasActiveSubscription = false;
          let subscriptionEndTime = 0;
          if (subscriptionsSnapshot.exists()) {
            subscriptionsSnapshot.forEach(child => {
              const subscription = child.val();
              if (subscription.endTime > now) {
                if (subscription.endTime > subscriptionEndTime) { 
                    hasActiveSubscription = true;
                    subscriptionEndTime = subscription.endTime;
                }
              }
            });
          }

          if (!hasActiveSubscription) {
            return res.status(200).json({
                isLinked: true,
                telegramId: telegramIdStr,
                linkedUsername: accessCodeData.linkedUsername || 'Unknown',
                hasSubscription: false,
                isActive: false, 
                message: 'Access code is valid and linked, but no active subscription found.'
            });
          }

          return res.status(200).json({
            isLinked: true,
            telegramId: telegramIdStr,
            linkedUsername: accessCodeData.linkedUsername || 'Unknown',
            hasSubscription: true,
            subscriptionEndTime: subscriptionEndTime,
            isActive: true, 
            message: 'Access code valid, linked, with active subscription.'
          });
        }

        case 'authRequest': { 
          const { telegramId, accessCode, ip, hwid, requestId } = req.body;
          if (!telegramId || !accessCode || !hwid || !requestId) {
            return res.status(400).json({ error: 'Missing required fields for authRequest.' });
          }

          
          const oldRequestsSnapshot = await db.ref('authRequests')
                                            .orderByChild('telegramId').equalTo(String(telegramId))
                                            .once('value');
          if (oldRequestsSnapshot.exists()) {
            const updates = {};
            oldRequestsSnapshot.forEach(child => {
              const request = child.val();
              if (request.status === 'pending' || request.status === 'sent') {
                updates[`authRequests/${child.key}/status`] = 'expired_by_new_request';
                updates[`authRequests/${child.key}/completedAt`] = admin.database.ServerValue.TIMESTAMP;
              }
            });
            if (Object.keys(updates).length > 0) {
                await db.ref().update(updates);
            }
          }
          
          await db.ref(`authRequests/${requestId}`).set({
            telegramId: String(telegramId),
            accessCode: accessCode,
            ip: ip || 'unknown',
            hwid: hwid,
            requestId: requestId,
            createdAt: admin.database.ServerValue.TIMESTAMP, 
            status: 'pending' 
          });
          
          return res.status(200).json({ success: true, message: "Authentication request initiated. Check Telegram." });
        }
        
        case 'logoutUser': { 
          const { accessCode, telegramId, hwid } = req.body; 
          if (!accessCode || !telegramId || !hwid) return res.status(400).json({ error: 'Missing required fields' });
          
          const accessCodeSnapshot = await db.ref(`accessCodes/${accessCode}`).once('value');
          if (!accessCodeSnapshot.exists()) return res.status(404).json({ success: false, message: 'Access code not found' });
          const accessCodeData = accessCodeSnapshot.val();
          if (accessCodeData.telegramId !== String(telegramId) || accessCodeData.hwid !== hwid) {
            return res.status(403).json({ success: false, message: 'Mismatch in logout request details.' });
          }

          
          await db.ref('userLogs').push({
            type: 'logout',
            accessCode: accessCode,
            telegramId: String(telegramId),
            hwid: hwid,
            timestamp: admin.database.ServerValue.TIMESTAMP
          });
          
          
          return res.status(200).json({ success: true, message: "Logout recorded." });
        }

        case 'unlinkAccessCode': { 
          const { accessCode, hwid, telegramId } = req.body;
          if (!accessCode || !hwid || !telegramId) return res.status(400).json({ error: 'Missing required fields' });
          
          const accessCodeRef = db.ref(`accessCodes/${accessCode}`);
          const accessCodeSnapshot = await accessCodeRef.once('value');
          if (!accessCodeSnapshot.exists()) return res.status(404).json({ success: false, message: 'Access code not found' });
          
          const accessCodeData = accessCodeSnapshot.val();
          if (accessCodeData.hwid !== hwid) return res.status(403).json({ success: false, message: 'HWID mismatch. Cannot unlink.' });
          if (accessCodeData.telegramId !== String(telegramId)) return res.status(403).json({ success: false, message: 'Telegram ID mismatch. Cannot unlink.' });
          if (!accessCodeData.isLinked) return res.status(200).json({ success: true, message: 'Access code was already unlinked.' });

          await accessCodeRef.update({
            isLinked: false,
            telegramId: null,
            linkedUsername: null,
            unlinkedAt: admin.database.ServerValue.TIMESTAMP
          });
          return res.status(200).json({ success: true, message: "Access code successfully unlinked from Telegram account." });
        }

        case 'checkLicense': { 
          const { licenseKey, username, hwid } = req.body;
          if (!licenseKey || !username || !hwid) return res.status(400).json({ valid: false, message: 'Missing required fields' });
          const licensesRef = db.ref('licenses');
          const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
          if (!snapshot.exists()) return res.status(200).json({ valid: false, message: 'Неверный лицензионный ключ' }); 
          
          const licenses = snapshot.val();
          const licenseId = Object.keys(licenses)[0];
          const license = licenses[licenseId];

          if (!license.active) return res.status(200).json({valid: false, message: 'Лицензия не активна'});
          if (license.username !== username) return res.status(200).json({ valid: false, message: 'Ключ привязан к другому пользователю (логин Minecraft)' });
          
          if (license.active_hwid && license.active_hwid !== hwid) {
            
            
            return res.status(200).json({ valid: false, message: 'Лицензия уже используется на другом компьютере!' });
          }
          
          await licensesRef.child(licenseId).update({
            last_login: now,
            last_ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress, 
            active_hwid: hwid 
          });
          return res.status(200).json({ valid: true, telegramId: license.telegramId, username: license.username, message: 'Лицензия успешно проверена.' });
        }
        default:
          res.status(400).json({ error: 'Invalid action specified' });
      }
    } else {
      res.status(405).json({ error: 'Method Not Allowed' });
    }
  } catch (error) {
    console.error('Error in client API:', error);
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
};
