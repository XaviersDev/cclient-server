const { MongoClient } = require('mongodb');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey, username, deviceId } = req.body;

  if (!licenseKey || !username || !deviceId) {
    return res.status(400).json({ valid: false, message: 'Отсутствуют обязательные параметры' });
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return res.status(500).json({ valid: false, message: 'Ошибка конфигурации сервера' });
  }

  let client;
  try {
    client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();

    const database = client.db('cclient_licenses');
    const licenses = database.collection('licenses');

    
    const license = await licenses.findOne({ licenseKey });

    if (!license) {
      return res.status(200).json({ valid: false, message: 'Неверный лицензионный ключ' });
    }

    
    if (license.username && license.username !== username) {
      return res.status(200).json({ 
        valid: false, 
        message: 'Этот ключ привязан к другому нику: ' + license.username 
      });
    }

    
    if (license.active) {
      
      if (license.currentDevice && license.currentDevice !== deviceId) {
        
        const lastActive = new Date(license.lastActive || 0);
        const now = new Date();
        const diffMinutes = (now - lastActive) / (1000 * 60);

        
        if (diffMinutes < 15) {
          return res.status(200).json({ 
            valid: false, 
            message: 'Вы уже играете на другом компьютере!' 
          });
        }
      }

      
      await licenses.updateOne(
        { licenseKey },
        { 
          $set: { 
            username: username, 
            currentDevice: deviceId,
            lastActive: new Date(),
          },
          $addToSet: { devices: deviceId } 
        }
      );

      
      
      const requireAuth = !license.devices || !license.devices.includes(deviceId) || 
                          (license.lastTelegramAuth && 
                           (new Date() - new Date(license.lastTelegramAuth)) > (1000 * 60 * 60 * 12));

      return res.status(200).json({ 
        valid: true, 
        requireTelegramAuth: requireAuth 
      });
    } else {
      return res.status(200).json({ 
        valid: false, 
        message: 'Лицензия деактивирована' 
      });
    }
  } catch (error) {
    console.error('Ошибка проверки лицензии:', error);
    return res.status(500).json({ valid: false, message: 'Ошибка сервера: ' + error.message });
  } finally {
    if (client) {
      await client.close();
    }
  }
};
