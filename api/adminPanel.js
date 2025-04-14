
const { MongoClient } = require('mongodb');

module.exports = async (req, res) => {
  
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  
  const { username, password } = req.body;
  
  if (username !== 'admin' || password !== 'admin') {
    return res.status(401).json({ error: 'Неверные учетные данные' });
  }

  if (req.method === 'POST') {
    
    const { action } = req.body;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
    }

    let client;
    try {
      client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
      await client.connect();

      const database = client.db('cclient_licenses');
      const licenses = database.collection('licenses');

      switch (action) {
        case 'getLicenses':
          const allLicenses = await licenses.find({}).toArray();
          return res.status(200).json({ licenses: allLicenses });

        case 'createLicense':
          const { username, telegramId } = req.body;
          const newLicense = {
            licenseKey: generateLicenseKey(),
            username: username || null,
            telegramChatId: telegramId || null,
            active: true,
            createdAt: new Date(),
            devices: [],
            lastActive: null,
            lastTelegramAuth: null
          };
          
          await licenses.insertOne(newLicense);
          return res.status(200).json({ success: true, license: newLicense });

        case 'toggleLicense':
          const { licenseKey, active } = req.body;
          await licenses.updateOne(
            { licenseKey },
            { $set: { active: active } }
          );
          return res.status(200).json({ success: true });

        case 'deleteLicense':
          const { licenseKeyToDelete } = req.body;
          await licenses.deleteOne({ licenseKey: licenseKeyToDelete });
          return res.status(200).json({ success: true });

        default:
          return res.status(400).json({ error: 'Неизвестное действие' });
      }
    } catch (error) {
      console.error('Ошибка в админ-панели:', error);
      return res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    } finally {
      if (client) {
        await client.close();
      }
    }
  } else {
    
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(adminPanelHtml);
  }
};


function generateLicenseKey() {
  const uuid = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return `cclient-${uuid()}-${uuid()}`.substring(0, 36);
}


const adminPanelHtml = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CClient Admin Panel</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #121212;
            color: #e0e0e0;
            margin: 0;
            padding: 0;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: #1e1e1e;
            padding: 20px;
            text-align: center;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        h1, h2 {
            color: #4caf50;
            margin: 0;
        }
        .card {
            background-color: #1e1e1e;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .login-form, .create-license-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        input, button {
            padding: 12px;
            border-radius: 4px;
            border: 1px solid #333;
            background-color: #333;
            color: #fff;
            font-size: 16px;
        }
        button {
            background-color: #4caf50;
            cursor: pointer;
            border: none;
            font-weight: bold;
        }
        button:hover {
            background-color: #45a049;
        }
        .license-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .license-table th, .license-table td {
            border: 1px solid #333;
            padding: 12px;
            text-align: left;
        }
        .license-table th {
            background-color: #333;
        }
        .license-table tr:nth-child(even) {
            background-color: #252525;
        }
        .license-actions {
            display: flex;
            gap: 10px;
        }
        .active {
            color: #4caf50;
        }
        .inactive {
            color: #f44336;
        }
        .hidden {
            display: none;
        }
        .button-red {
            background-color: #f44336;
        }
        .button-red:hover {
            background-color: #d32f2f;
        }
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .dashboard-card {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .dashboard-number {
            font-size: 36px;
            font-weight: bold;
            margin: 10px 0;
            color: #4caf50;
        }
        .search-bar {
            margin-bottom: 20px;
        }
        #searchInput {
            width: 100%;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>CClient Система Лицензирования</h1>
            <p>Админ-панель для управления лицензиями CClient</p>
        </div>

        <div id="loginSection" class="card">
            <h2>Вход в систему</h2>
            <div class="login-form">
                <input type="text" id="username" placeholder="Имя пользователя">
                <input type="password" id="password" placeholder="Пароль">
                <button id="loginButton">Войти</button>
            </div>
        </div>

        <div id="adminSection" class="hidden">
            <div class="dashboard">
                <div class="dashboard-card">
                    <h3>Всего лицензий</h3>
                    <div id="totalLicenses" class="dashboard-number">0</div>
                </div>
                <div class="dashboard-card">
                    <h3>Активных лицензий</h3>
                    <div id="activeLicenses" class="dashboard-number">0</div>
                </div>
                <div class="dashboard-card">
                    <h3>Активных устройств</h3>
                    <div id="activeDevices" class="dashboard-number">0</div>
                </div>
            </div>

            <div class="card">
                <h2>Создать новую лицензию</h2>
                <div class="create-license-form">
                    <input type="text" id="newLicenseUsername" placeholder="Никнейм (опционально)">
                    <input type="text" id="newLicenseTelegramId" placeholder="Telegram ID (опционально)">
                    <button id="createLicenseButton">Создать лицензию</button>
                </div>
            </div>

            <div class="card">
                <h2>Список лицензий</h2>
                <div class="search-bar">
                    <input type="text" id="searchInput" placeholder="Поиск по никнейму или лицензионному ключу...">
                </div>
                <div id="licenseTableContainer">
                    <table class="license-table">
                        <thead>
                            <tr>
                                <th>Ключ лицензии</th>
                                <th>Никнейм</th>
                                <th>Telegram ID</th>
                                <th>Статус</th>
                                <th>Дата создания</th>
                                <th>Последняя активность</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody id="licenseTableBody">
                            <!-- Данные будут загружены с помощью JavaScript -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <script>
        
        let authToken = '';
        let licenses = [];

        
        document.getElementById('loginButton').addEventListener('click', login);
        document.getElementById('createLicenseButton').addEventListener('click', createLicense);
        document.getElementById('searchInput').addEventListener('input', filterLicenses);

        
        async function login() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/adminPanel', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username,
                        password,
                        action: 'getLicenses'
                    })
                });

                const data = await response.json();

                if (response.ok && data.licenses) {
                    authToken = btoa(username + ':' + password);
                    licenses = data.licenses;
                    
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('adminSection').classList.remove('hidden');
                    
                    updateDashboard();
                    renderLicenseTable();
                } else {
                    alert('Ошибка входа: ' + (data.error || 'Неверные учетные данные'));
                }
            } catch (error) {
                console.error('Ошибка входа:', error);
                alert('Ошибка соединения с сервером');
            }
        }

        
        async function createLicense() {
            const username = document.getElementById('newLicenseUsername').value;
            const telegramId = document.getElementById('newLicenseTelegramId').value;

            try {
                const response = await fetch('/api/adminPanel', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + authToken
                    },
                    body: JSON.stringify({
                        username: 'admin',
                        password: 'admin',
                        action: 'createLicense',
                        username,
                        telegramId
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    alert('Лицензия успешно создана: ' + data.license.licenseKey);
                    
                    fetchLicenses();
                } else {
                    alert('Ошибка создания лицензии: ' + (data.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка создания лицензии:', error);
                alert('Ошибка соединения с сервером');
            }
        }

        
        async function toggleLicenseStatus(licenseKey, currentStatus) {
            try {
                const response = await fetch('/api/adminPanel', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + authToken
                    },
                    body: JSON.stringify({
                        username: 'admin',
                        password: 'admin',
                        action: 'toggleLicense',
                        licenseKey,
                        active: !currentStatus
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    alert('Статус лицензии изменен');
                    
                    fetchLicenses();
                } else {
                    alert('Ошибка изменения статуса лицензии: ' + (data.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка изменения статуса лицензии:', error);
                alert('Ошибка соединения с сервером');
            }
        }

        
        async function deleteLicense(licenseKey) {
            if (!confirm('Вы уверены что хотите удалить лицензию ' + licenseKey + '?')) {
                return;
            }

            try {
                const response = await fetch('/api/adminPanel', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + authToken
                    },
                    body: JSON.stringify({
                        username: 'admin',
                        password: 'admin',
                        action: 'deleteLicense',
                        licenseKeyToDelete: licenseKey
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    alert('Лицензия успешно удалена');
                    
                    fetchLicenses();
                } else {
                    alert('Ошибка удаления лицензии: ' + (data.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка удаления лицензии:', error);
                alert('Ошибка соединения с сервером');
            }
        }

        
        async function fetchLicenses() {
            try {
                const response = await fetch('/api/adminPanel', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + authToken
                    },
                    body: JSON.stringify({
                        username: 'admin',
                        password: 'admin',
                        action: 'getLicenses'
                    })
                });

                const data = await response.json();

                if (response.ok && data.licenses) {
                    licenses = data.licenses;
                    updateDashboard();
                    renderLicenseTable();
                } else {
                    alert('Ошибка получения лицензий: ' + (data.error || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка получения лицензий:', error);
                alert('Ошибка соединения с сервером');
            }
        }

        
        function filterLicenses() {
            const searchText = document.getElementById('searchInput').value.toLowerCase();
            const filteredLicenses = licenses.filter(license => {
                return (license.licenseKey && license.licenseKey.toLowerCase().includes(searchText)) ||
                       (license.username && license.username.toLowerCase().includes(searchText));
            });
            renderLicenseTable(filteredLicenses);
        }

        
        function renderLicenseTable(data = licenses) {
            const tableBody = document.getElementById('licenseTableBody');
            tableBody.innerHTML = '';

            data.forEach(license => {
                const row = document.createElement('tr');
                
                
                const createdDate = license.createdAt ? new Date(license.createdAt).toLocaleString() : 'Не указано';
                const lastActiveDate = license.lastActive ? new Date(license.lastActive).toLocaleString() : 'Никогда';
                
                row.innerHTML = \`
                    <td>\${license.licenseKey}</td>
                    <td>\${license.username || 'Не привязан'}</td>
                    <td>\${license.telegramChatId || 'Не привязан'}</td>
                    <td class="\${license.active ? 'active' : 'inactive'}">\${license.active ? 'Активна' : 'Неактивна'}</td>
                    <td>\${createdDate}</td>
                    <td>\${lastActiveDate}</td>
                    <td class="license-actions">
                        <button onclick="toggleLicenseStatus('\${license.licenseKey}', \${license.active})" class="\${license.active ? 'button-red' : ''}">\${license.active ? 'Деактивировать' : 'Активировать'}</button>
                        <button onclick="deleteLicense('\${license.licenseKey}')" class="button-red">Удалить</button>
                    </td>
                \`;
                
                tableBody.appendChild(row);
            });
        }

        
        function updateDashboard() {
            document.getElementById('totalLicenses').textContent = licenses.length;
            document.getElementById('activeLicenses').textContent = licenses.filter(license => license.active).length;
            
            
            const uniqueDevices = new Set();
            licenses.forEach(license => {
                if (license.devices && Array.isArray(license.devices)) {
                    license.devices.forEach(device => uniqueDevices.add(device));
                }
            });
            document.getElementById('activeDevices').textContent = uniqueDevices.size;
        }
    </script>
</body>
</html>
`;
