const admin = require('firebase-admin');


if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_URL
    });
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    
    
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', success: false });
  }

  const { action, apiPassword } = req.body;

  if (!apiPassword || apiPassword !== process.env.APIPASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Password', success: false });
  }

  try {
    const db = admin.database();
    const now = Date.now();

    switch (action) {
      case 'createSubscription': {
        const { telegramId, durationDays, paymentInfo, grantedBy, isFreeTrial } = req.body;
        if (!telegramId || !durationDays) {
          return res.status(400).json({ error: 'Missing required fields (telegramId, durationDays)', success: false });
        }

        const parsedDurationDays = parseInt(durationDays, 10);
        if (isNaN(parsedDurationDays) || parsedDurationDays <= 0) {
            return res.status(400).json({ error: 'Invalid durationDays', success: false });
        }

        const subscriptionsSnapshot = await db.ref('subscriptions').orderByChild('telegramId').equalTo(String(telegramId)).once('value');
        let existingSubscriptionId = null;
        let currentEndTime = 0;

        if (subscriptionsSnapshot.exists()) {
          subscriptionsSnapshot.forEach(child => {
            const sub = child.val();
            if (sub.endTime > now) { 
              if (sub.endTime > currentEndTime) { 
                  currentEndTime = sub.endTime;
                  existingSubscriptionId = child.key;
              }
            } else if (!existingSubscriptionId && sub.endTime <= now) { 
                if (sub.endTime > currentEndTime) { 
                    currentEndTime = sub.endTime; 
                    existingSubscriptionId = child.key;
                }
            }
          });
        }
        
        
        const baseTime = currentEndTime > now ? currentEndTime : now;
        const newEndTime = baseTime + (parsedDurationDays * 24 * 60 * 60 * 1000);

        const subscriptionData = {
          telegramId: String(telegramId),
          startTime: (currentEndTime > now && existingSubscriptionId) ? (await db.ref(`subscriptions/${existingSubscriptionId}/startTime`).once('value')).val() : now, 
          endTime: newEndTime,
          durationDaysGiven: parsedDurationDays,
          lastUpdatedAt: now,
          ...(paymentInfo && { paymentInfo }), 
          ...(grantedBy && { grantedByAdmin: String(grantedBy) }), 
          ...(isFreeTrial && { isFreeTrial: true, freeTrialActivatedAt: now }) 
        };

        if (existingSubscriptionId) {
          await db.ref(`subscriptions/${existingSubscriptionId}`).update(subscriptionData);
        } else {
          const newSubRef = db.ref('subscriptions').push();
          await newSubRef.set({ ...subscriptionData, createdAt: now }); 
        }
        
        
        if (grantedBy) {
            await db.ref('adminActionsLog').push({
                action: 'createSubscription',
                adminId: String(grantedBy),
                targetTelegramId: String(telegramId),
                durationDays: parsedDurationDays,
                newEndTime: newEndTime,
                timestamp: now,
            });
        }

        return res.status(200).json({ success: true, endTime: newEndTime, message: "Subscription created/updated." });
      }

      case 'removeSubscriptionDays': {
        const { telegramId, daysToRemove, reason, adminId } = req.body;
        if (!telegramId || !daysToRemove) {
          return res.status(400).json({ error: 'Missing required fields (telegramId, daysToRemove)', success: false });
        }
        const parsedDaysToRemove = parseInt(daysToRemove, 10);
        if (isNaN(parsedDaysToRemove) || parsedDaysToRemove <= 0) {
            return res.status(400).json({ error: 'Invalid daysToRemove', success: false });
        }

        const subscriptionsSnapshot = await db.ref('subscriptions').orderByChild('telegramId').equalTo(String(telegramId)).once('value');
        if (!subscriptionsSnapshot.exists()) {
          return res.status(404).json({ error: 'No subscription found for this user to modify.', success: false });
        }

        let activeSubscriptionId = null;
        let currentActiveEndTime = 0;
        subscriptionsSnapshot.forEach(child => {
            const sub = child.val();
            if (sub.endTime > now && sub.endTime > currentActiveEndTime) { 
                currentActiveEndTime = sub.endTime;
                activeSubscriptionId = child.key;
            }
        });

        if (!activeSubscriptionId) {
            return res.status(404).json({ error: 'No active subscription found for this user.', success: false });
        }
        
        const newEndTime = currentActiveEndTime - (parsedDaysToRemove * 24 * 60 * 60 * 1000);
        
        await db.ref(`subscriptions/${activeSubscriptionId}`).update({ 
            endTime: newEndTime,
            lastUpdatedAt: now,
            lastModification: {
                type: 'daysRemoved',
                days: parsedDaysToRemove,
                reason: reason || "N/A",
                adminId: String(adminId) || "Unknown",
                timestamp: now
            }
        });

        await db.ref('adminActionsLog').push({
            action: 'removeSubscriptionDays',
            adminId: String(adminId) || "Unknown",
            targetTelegramId: String(telegramId),
            daysRemoved: parsedDaysToRemove,
            reason: reason || "N/A",
            newEndTime: newEndTime,
            timestamp: now,
        });

        return res.status(200).json({ success: true, newEndTime: newEndTime, message: `${parsedDaysToRemove} days removed.` });
      }

      case 'banUser': {
        const { telegramId, durationDays, reason, bannedByAdminId } = req.body;
        if (!telegramId || durationDays === undefined || !reason) { 
          return res.status(400).json({ error: 'Missing required fields (telegramId, durationDays, reason)', success: false });
        }
        const parsedDurationDays = parseInt(durationDays, 10);
         if (isNaN(parsedDurationDays) || parsedDurationDays < 0) {
            return res.status(400).json({ error: 'Invalid durationDays for ban', success: false });
        }

        const banEndTime = now + (parsedDurationDays * 24 * 60 * 60 * 1000);
        const banData = {
          telegramId: String(telegramId),
          reason: reason,
          banStartTime: now,
          banEndTime: banEndTime,
          durationDays: parsedDurationDays,
          bannedByAdminId: String(bannedByAdminId) || "Unknown",
          isActive: true
        };
        await db.ref(`userBans/${String(telegramId)}`).set(banData);

        await db.ref('adminActionsLog').push({
            action: 'banUser',
            adminId: String(bannedByAdminId) || "Unknown",
            targetTelegramId: String(telegramId),
            durationDays: parsedDurationDays,
            reason: reason,
            banEndTime: banEndTime,
            timestamp: now,
        });
        return res.status(200).json({ success: true, banEndTime: banEndTime, message: "User banned." });
      }

      case 'unbanUser': {
        const { telegramId, unbannedByAdminId } = req.body;
        if (!telegramId) {
          return res.status(400).json({ error: 'Missing telegramId', success: false });
        }
        const banRef = db.ref(`userBans/${String(telegramId)}`);
        const banSnapshot = await banRef.once('value');
        if (!banSnapshot.exists()) {
          return res.status(404).json({ error: 'User is not currently banned or ban record not found.', success: false });
        }
        
        await banRef.update({ 
            isActive: false, 
            unbannedAt: now,
            unbannedByAdminId: String(unbannedByAdminId) || "Unknown"
        }); 
        

        await db.ref('adminActionsLog').push({
            action: 'unbanUser',
            adminId: String(unbannedByAdminId) || "Unknown",
            targetTelegramId: String(telegramId),
            timestamp: now,
        });
        return res.status(200).json({ success: true, message: "User unbanned." });
      }
      
      case 'updateAuthStatus': { 
        const { requestId, status } = req.body;
        if (!requestId || !status || !['approved', 'denied', 'expired_pending', 'expired_sent', 'error_api_update_failed', 'error_api_http', 'error_unknown'].includes(status)) {
            return res.status(400).json({ error: 'Missing or invalid fields for updateAuthStatus', success: false });
        }
        const authRequestRef = db.ref(`authRequests/${requestId}`);
        const authRequestSnapshot = await authRequestRef.once('value');
        if (!authRequestSnapshot.exists()) {
            return res.status(404).json({ error: 'AuthRequest not found in DB', success: false });
        }
        await authRequestRef.update({
            status: status,
            apiConfirmedAt: now, 
            ...(status === 'approved' && { approvedAt: now }),
            ...(status === 'denied' && { deniedAt: now }),
        });
        
        
        return res.status(200).json({ success: true, status: status, message: `AuthRequest ${requestId} status updated to ${status} via API.` });
      }

      case 'registerLicense': { 
        const { licenseKey, username, telegramId } = req.body;
        if (!licenseKey || !username || !telegramId) return res.status(400).json({ error: 'Missing required fields' });
        const licensesRef = db.ref('licenses');
        const snapshot = await licensesRef.orderByChild('licenseKey').equalTo(licenseKey).once('value');
        if (snapshot.exists()) return res.status(409).json({ success: false, message: 'Ключ уже существует' });
        await licensesRef.push({
          licenseKey,
          username,
          telegramId: String(telegramId),
          created_at: now,
          active: true
        });
        res.status(200).json({ success: true, message: 'Лицензия зарегистрирована' });
        break;
      }
      case 'cleanExpiredData': { 
        const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
        const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        
        let operations = {
            authRequestsDeleted: 0,
            subscriptionsDeleted: 0,
            userLogsDeleted: 0, 
            accessCodesDeleted: 0
        };
        const updates = {};

        
        const oldAuthRequestsSnapshot = await db.ref('authRequests').orderByChild('createdAt').endAt(oneMonthAgo).limitToFirst(100).once('value');
        if (oldAuthRequestsSnapshot.exists()) {
          oldAuthRequestsSnapshot.forEach(child => {
            const req = child.val();
            if (req.status !== 'pending' && req.status !== 'sent') { 
                updates[`authRequests/${child.key}`] = null;
                operations.authRequestsDeleted++;
            }
          });
        }
        
        const oldSubscriptionsSnapshot = await db.ref('subscriptions').orderByChild('endTime').endAt(threeMonthsAgo).limitToFirst(100).once('value');
        if (oldSubscriptionsSnapshot.exists()) {
          oldSubscriptionsSnapshot.forEach(child => {
            updates[`subscriptions/${child.key}`] = null;
            operations.subscriptionsDeleted++;
          });
        }
        
        const oldLogsSnapshot = await db.ref('userLogs').orderByChild('timestamp').endAt(oneMonthAgo).limitToFirst(100).once('value');
        if (oldLogsSnapshot.exists()) {
          oldLogsSnapshot.forEach(child => {
            updates[`userLogs/${child.key}`] = null;
            operations.userLogsDeleted++;
          });
        }
        
        
        
        const oldAccessCodesSnapshot = await db.ref('accessCodes').orderByChild('created').endAt(sevenDaysAgo).once('value');
        if (oldAccessCodesSnapshot.exists()) {
          oldAccessCodesSnapshot.forEach(child => {
            const accessCode = child.val();
            if (!accessCode.isLinked) {
              updates[`accessCodes/${child.key}`] = null;
              operations.accessCodesDeleted++;
            }
          });
        }
        
        if (Object.keys(updates).length > 0) {
            await db.ref().update(updates);
        }
        
        res.status(200).json({ success: true, ...operations, message: "Cleanup process completed." });
        break;
      }
      default:
        res.status(400).json({ error: 'Invalid action specified', success: false });
    }
  } catch (error) {
    console.error('Error in admin API:', error);
    res.status(500).json({ error: 'Internal Server Error: ' + error.message, success: false });
  }
};
