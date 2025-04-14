
const { MongoClient } = require('mongodb');
const axios = require('axios');

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

  const { licenseKey, username, deviceId, location } = req.body;

  if (!licenseKey || !username || !deviceId) {
    return res.status(400).json({ approved: false, message: 'Отсутствуют обязательные параметры' });
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return res.status(500).json({ approved: false, message: 'Ошибка конфигурации сервера' });
  }

  let client;
  try {
    client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();

    const database = client.db('cclient_licenses');
    const licenses = database.collection('licenses');
    const authRequests = database.collection('auth_requests');

    
    const license = await licenses.findOne({ licenseKey });

    if (!license) {
      return res.status(200).json({ approved: false, message: 'Неверный лицензионный ключ' });
    }

    if (!license.telegramChatId) {
      return res.status(200).json({ approved: false, message: 'К лицензии не привязан Telegram аккаунт' });
    }

    
    const authId = Math.random().toString(36).substring(2, 15);
    const authRequest = {
      authId,
      licenseKey,
      username,
      deviceId,
      location: location || 'Неизвестно',
      timestamp: new Date(),
      status: 'pending' 
    };

    await authRequests.insertOne(authRequest);

    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = license.telegramChatId;
    
    const message = `🔐 Запрос на вход в CClient:\n\n👤 Ник: ${username}\n📍 Локация: ${location || 'Неизвестно'}\n\nЭто вы?`;
    
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ Да, это я", callback_data: `auth_yes_${authId}` },
          { text: "❌ Нет, это не я", callback_data: `auth_no_${authId}` }
        ]
      ]
    };
    
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      reply_markup: JSON.stringify(inlineKeyboard)
    });

    
    let attempts = 0;
    const maxAttempts = 30; 
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const updatedRequest = await authRequests.findOne({ authId });
      
      if (updatedRequest.status !== 'pending') {
        if (updatedRequest.status === 'approved') {
          
          await licenses.updateOne(
            { licenseKey },
            { 
              $set: { 
                lastTelegramAuth: new Date(),
                lastActive: new Date()
              }
            }
          );
          
          return res.status(200).json({ approved: true });
        } else {
          return res.status(200).json({ 
            approved: false, 
            message: 'Авторизация отклонена через Telegram' 
          });
        }
      }
      
      attempts++;
    }
    
    
    return res.status(200).json({ 
      approved: false, 
      message: 'Время ожидания подтверждения истекло' 
    });
  } catch (error) {
    console.error('Ошибка авторизации через Telegram:', error);
    return res.status(500).json({ approved: false, message: 'Ошибка сервера: ' + error.message });
  } finally {
    if (client) {
      await client.close();
    }
  }
};
