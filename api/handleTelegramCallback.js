
const { MongoClient } = require('mongodb');

module.exports = async (req, res) => {
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { callback_query } = req.body;
  
  if (!callback_query) {
    return res.status(400).json({ error: 'Invalid request format' });
  }

  const { data, from } = callback_query;
  
  if (!data || !data.startsWith('auth_')) {
    return res.status(200).json({ ok: true }); 
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const uri = process.env.MONGODB_URI;
  
  if (!uri || !botToken) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  
  const parts = data.split('_');
  if (parts.length !== 3) {
    return res.status(200).json({ ok: true }); 
  }

  const action = parts[1]; 
  const authId = parts[2];

  let client;
  try {
    client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();

    const database = client.db('cclient_licenses');
    const authRequests = database.collection('auth_requests');

    
    const request = await authRequests.findOne({ authId });
    
    if (!request) {
      
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callback_query.id,
          text: 'Запрос не найден или устарел'
        })
      });
      
      return res.status(200).json({ ok: true });
    }

    
    const newStatus = action === 'yes' ? 'approved' : 'rejected';
    await authRequests.updateOne(
      { authId },
      { $set: { status: newStatus } }
    );

    
    const responseText = action === 'yes' 
      ? 'Вход подтвержден! CClient запускается.' 
      : 'Вход отклонен. CClient заблокирован.';
    
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callback_query.id,
        text: responseText
      })
    });

    
    const updatedMessage = `${callback_query.message.text}\n\n${action === 'yes' ? '✅ Подтверждено!' : '❌ Отклонено!'}`;
    
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: callback_query.message.chat.id,
        message_id: callback_query.message.message_id,
        text: updatedMessage
      })
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling Telegram callback:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    if (client) {
      await client.close();
    }
  }
};
