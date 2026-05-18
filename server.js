const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const configPath = path.join(__dirname, 'config.json');
const rulePath = path.join(__dirname, 'rule.json');

let config = JSON.parse(fs.readFileSync(configPath));
let rule = JSON.parse(fs.readFileSync(rulePath));

const loginPath = path.join(__dirname, 'login.json'); 
const tokensPath = path.join(__dirname, 'tokens.json'); 


if (!fs.existsSync(loginPath)) {
    fs.writeFileSync(loginPath, JSON.stringify({ users: [], sessions: {} }, null, 2));
}

if (!fs.existsSync(tokensPath)) {
    fs.writeFileSync(tokensPath, JSON.stringify({ tokens: [] }, null, 2));
}

let loginData = JSON.parse(fs.readFileSync(loginPath));
let tokensData = JSON.parse(fs.readFileSync(tokensPath));

const app = express();
const PORT = process.env.PORT || 20672;

app.use(cors());
app.use(bodyParser.json());

function reloadConfig() {
    config = JSON.parse(fs.readFileSync(configPath));
}

function reloadRule() {
    rule = JSON.parse(fs.readFileSync(rulePath));
}

function saveLoginData() {
    fs.writeFileSync(loginPath, JSON.stringify(loginData, null, 2));
}

function saveTokensData() {
    fs.writeFileSync(tokensPath, JSON.stringify(tokensData, null, 2));
}

function getRealIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           '127.0.0.1';
}

function isUserLoggedIn(req) {
    try {
        const userIP = getRealIP(req);
        
        
        // قراءة أحدث بيانات من ملف login.json
        const currentLoginData = JSON.parse(fs.readFileSync(loginPath, 'utf8'));            
        const now = new Date().toISOString();
        
        // البحث عن مستخدم مسجل بنفس IP
        const loggedUser = currentLoginData.users.find(user => user.ip === userIP);
      
        
        if (!loggedUser) {
       
            return false;
        }
        
        
        const activeSession = Object.values(currentLoginData.sessions).find(session => {
            const matchesUser = session.discordId === loggedUser.discordId || session.ip === userIP;
            const notExpired = session.expiresAt > now;           
            
            return matchesUser && notExpired;
        });
        
  
        return !!activeSession;
        
    } catch (error) {
        console.error('خطأ في التحقق من تسجيل الدخول:', error);
        return false;
    }
}

// صفحة رفض الوصول
function getAccessDeniedPage() {
    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🚫 تـم رفـض الـوصـول - BLACK LIST DASHBOARD</title>
        <link rel="icon" href="image.png" type="image/png">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
            
            body {
                font-family: 'Cairo', sans-serif;
                background: linear-gradient(135deg, #1a1a20 0%, #25252b 100%);
                color: #f2f2f2;
                margin: 0;
                padding: 0;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                direction: rtl;
            }
            
            .access-denied-container {
                background: #1a1a20;
                border: 2px solid #ff6f00;
                border-radius: 20px;
                padding: 40px;
                text-align: center;
                box-shadow: 0 15px 35px rgba(255, 111, 0, 0.3);
                max-width: 500px;
                width: 90%;
                animation: slideIn 0.5s ease-out;
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(-30px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .error-icon {
                font-size: 4rem;
                color: #ff6f00;
                margin-bottom: 20px;
                text-shadow: 0 0 20px rgba(255, 111, 0, 0.5);
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
            
            h1 {
                color: #ff6f00;
                font-size: 2rem;
                font-weight: 700;
                margin-bottom: 20px;
                text-shadow: 0 0 10px rgba(255, 111, 0, 0.3);
            }
            
            .message {
                font-size: 1.2rem;
                line-height: 1.6;
                margin-bottom: 30px;
                color: #ddd;
            }
            
            .warning {
                font-size: 1rem;
                color: #ff9800;
                margin-bottom: 30px;
                font-style: italic;
                padding: 15px;
                background: rgba(255, 152, 0, 0.1);
                border-radius: 10px;
                border-left: 4px solid #ff9800;
            }
            
            .back-button {
                background: linear-gradient(45deg, #ff6f00, #ffa040);
                color: white;
                border: none;
                padding: 15px 30px;
                border-radius: 10px;
                font-size: 1.1rem;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s ease;
                font-family: 'Cairo', sans-serif;
                text-decoration: none;
                display: inline-block;
            }
            
            .back-button:hover {
                background: linear-gradient(45deg, #ffa040, #ffcc70);
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(255, 111, 0, 0.4);
            }
            
            .footer-info {
                margin-top: 30px;
                font-size: 0.9rem;
                color: #666;
                border-top: 1px solid #333;
                padding-top: 20px;
            }
            
            .brand {
                color: #ff6f00;
                font-weight: bold;
                font-size: 1.1rem;
                margin-top: 15px;
            }
            
            .debug-info {
                margin-top: 20px;
                padding: 10px;
                background: rgba(255, 0, 0, 0.1);
                border-radius: 5px;
                font-size: 0.8rem;
                color: #ff6666;
            }
        </style>
    </head>
    <body>
        <div class="access-denied-container">
            <div class="error-icon">🚫</div>
            <h1> تـم رفـض الـوصـول</h1>
            <div class="message">
                لا يمكنك الدخول إلى لوحة التحكم دون تسجيل الدخول أولاً.<br>
                يجب عليك تسجيل الدخول من خلال Discord.
            </div>
            <div class="warning">
                ⚠️ إذا كنت قد سجلت الدخول مسبقاً، فقد انتهت صلاحية دخولك<br>
                 تنتهي صلاحية الدخول بعد 24 ساعة من آخر تسجيل 
            </div>
            <a href="/index.html" class="back-button">
                العودة للصفحة الرئيسية
            </a>
            <div class="footer-info">
               الـدخـول فـقـط لـلـمـبـرمـجـيـن و ألـادارة الـعـلـيا !
                <div class="brand">𝐁𝐋𝐀𝐂𝐊 𝐋𝐈𝐒𝐓 𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃</div>
            </div>
        </div>
    </body>
    </html>
    `;
}



const logPath = path.join(__dirname, 'log.json');


if (!fs.existsSync(logPath)) {
  fs.writeFileSync(logPath, JSON.stringify({ logs: [] }, null, 2));
}


function loadLogs() {
  try { return JSON.parse(fs.readFileSync(logPath, 'utf8')); }
  catch { return { logs: [] }; }
}
function saveLogs(data) {
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

function resolveActor(req) {
  try {
    
    loginData = JSON.parse(fs.readFileSync(loginPath, 'utf8'));
  } catch {
    
  }

  const ip = getRealIP(req);
  const ua = req.headers['user-agent'] || 'غير معروف';

  
  let candidate = null;
  for (const u of (loginData?.users || [])) {
    if (!u) continue;
    if (u.ip === ip && (!u.userAgent || u.userAgent === ua)) {
      candidate = u;
    }
  }

  if (candidate?.loginType === 'Developer' || candidate?.isDeveloper) {
    return { type: 'Developer', ip, userAgent: ua };
  }
  if (candidate?.discordId) {
    return {
      type: 'DiscordUser',
      discordId: candidate.discordId,
      username: candidate.username || candidate.globalName || 'غير معروف',
      ip, userAgent: ua
    };
  }
  return { type: 'Unknown', ip, userAgent: ua };
}

// ======= مسار الصفحة الرئيسية (index.html) =======
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ======= مسار callback الخاص بـ Discord OAuth2 =======
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("لم يتم توفير كود التفويض.");

    const params = new URLSearchParams();
    params.append("client_id", "1396846209821577276");
    params.append("client_secret", "qtdsH0oognWkK8Zqaxix4dBTyj98gAUI");
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "http://prem-eu2.bot-hosting.net:20672/callback");
    params.append("scope", "identify guilds email");

    try {
        
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            return res.send(`خطأ في الحصول على التوكن: ${tokenData.error_description || tokenData.error}`);
        }

        
        const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        
        const tokenInfo = {
            discordId: userData.id,
            username: userData.username,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenType: tokenData.token_type,
            expiresIn: tokenData.expires_in,
            scope: tokenData.scope,
            savedAt: new Date().toISOString(),
            ip: getRealIP(req)
        };

        
        const existingTokenIndex = tokensData.tokens.findIndex(token => token.discordId === userData.id);
        
        if (existingTokenIndex !== -1) {
            
            tokensData.tokens[existingTokenIndex] = tokenInfo;
        } else {
            
            tokensData.tokens.push(tokenInfo);
        }

        saveTokensData();  

        
        const guildRes = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` }
        });
        const guilds = await guildRes.json();

       
        const guildId = "1391087147045486623";
        const targetGuild = guilds.find(g => g.id === guildId && (parseInt(g.permissions) & 0x8));

        if (!targetGuild) {
          return res.send(`
            <html lang="ar">
            <head>
              <meta charset="UTF-8" />
              <title>🚫 ممنوع الدخول</title>
              <style>
                body {
                  background-color: #1c1c1c;
                  color: #ffa94d;
                  font-family: 'Tajawal', sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  direction: rtl;
                }

                .box {
                  background-color: #2b2b2b;
                  border-radius: 18px;
                  border: 1px solid #ffa94d;
                  padding: 35px 30px;
                  text-align: center;
                  box-shadow: 0 0 25px #ff880088;
                  max-width: 520px;
                }

                .icon {
                  font-size: 40px;
                  margin-bottom: 15px;
                }

                h1 {
                  font-size: 26px;
                  margin-bottom: 10px;
                  color: #ffa94d;
                }

                p {
                  font-size: 18px;
                  color: #ffcc99;
                  margin-bottom: 20px;
                }

                .tip {
                  font-size: 15px;
                  color: #999;
                }

                .btn {
                  margin-top: 20px;
                  padding: 10px 25px;
                  font-size: 16px;
                  font-weight: bold;
                  border: none;
                  border-radius: 8px;
                  background-color: #ffa94d;
                  color: #000;
                  cursor: pointer;
                  transition: 0.3s ease;
                }

                .btn:hover {
                  background-color: #ffbb66;
                }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="icon">🔐</div>
                <h1>تـم رفـض الـوصـول الـى لـوحـة الـتـحـكـم</h1>
                <p>لـيـس لـديـك صـلاحـيـات لـدخـول الـ 𝐁𝐋𝐀𝐂𝐊 𝐋𝐈𝐒𝐓 𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃 </p>
                <div class="tip">اذا كـنـت تـريـد الـدخـول الـرجـاء تـواصـل مـع احـد الـادارة الـعـلـيـا</div>
                <button class="btn" onclick="history.go(-2)"> الـرجـوع </button>
              </div>
            </body>
            </html>
          `);
        }


        
        const userIP = getRealIP(req);
        const currentTime = new Date().toISOString();
        const sessionId = uuidv4();

        const loginInfo = {
            sessionId: sessionId,
            discordId: userData.id,
            username: userData.username,
            discriminator: userData.discriminator || '0',
            globalName: userData.global_name,
            email: userData.email || 'غير متوفر',
            avatar: userData.avatar,
            ip: userIP,
            loginTime: currentTime,
            guildName: targetGuild.name,
            guildId: targetGuild.id,
            userAgent: req.headers['user-agent'] || 'غير معروف'
        };

        
        const existingUserIndex = loginData.users.findIndex(user => user.discordId === userData.id);
        
        if (existingUserIndex !== -1) {
            
            loginData.users[existingUserIndex] = {
                ...loginData.users[existingUserIndex],
                ...loginInfo,
                lastLogin: currentTime,
                loginCount: (loginData.users[existingUserIndex].loginCount || 1) + 1
            };
        } else {
            
            loginData.users.push({
                ...loginInfo,
                firstLogin: currentTime,
                lastLogin: currentTime,
                loginCount: 1
            });
        }

        
        loginData.sessions[sessionId] = {
            discordId: userData.id,
            createdAt: currentTime,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };

        saveLoginData();
        console.log(`✅ تم تسجيل دخول: ${userData.username} (${userData.id}) من IP: ${userIP}`);
        return res.redirect("/dashboard.html");

    } catch (err) {
        console.error("خطأ في /callback:", err);
        res.status(500).send("حدث خطأ أثناء المصادقة.");
    }
});




// ======= API Dashboard =======
// عرض اللوق
app.get('/api/logs', (req, res) => {
  res.json(loadLogs());
});

app.get('/config.json', (req, res) => {
    res.sendFile(configPath);
});


app.get('/api/channels', (req, res) => {
    reloadConfig();
    res.json(config.channels);
});

// ========== API للفـروم ==========
//  سجل لوق
app.post('/api/log', (req, res) => {
  try {
    const { action, details, url, method } = req.body || {};
    const actor = resolveActor(req);

    const entry = {
      id: uuidv4(),                                  
      time: new Date().toISOString(),
      action: action || 'DASHBOARD_MUTATION',
      method: (method || req.method || 'GET').toUpperCase(),
      url: url || req.originalUrl,
      actor,
      details: details ?? null
    };

    const logs = loadLogs();
    logs.logs.push(entry);
    saveLogs(logs);

    res.json({ success: true, entry });
  } catch (e) {
    console.error('Log error:', e);
    res.status(500).json({ success: false, error: 'failed_to_log' });
  }
});

// تسجيل دخول المطور
app.post('/api/dev-login', (req, res) => {
    const { password } = req.body;
    const correctPassword = "222";
    
    if (password === correctPassword) {
        const userIP = getRealIP(req);
        const currentTime = new Date().toISOString();
        const sessionId = uuidv4();

        const devLoginInfo = {
            sessionId: sessionId,
            loginType: 'Developer',
            ip: userIP,
            loginTime: currentTime,
            userAgent: req.headers['user-agent'] || 'غير معروف',
            isDeveloper: true
        };

        const existingDevIndex = loginData.users.findIndex(user => user.isDeveloper && user.ip === userIP);
        
        if (existingDevIndex !== -1) {
            loginData.users[existingDevIndex] = {
                ...loginData.users[existingDevIndex],
                ...devLoginInfo,
                lastLogin: currentTime,
                loginCount: (loginData.users[existingDevIndex].loginCount || 1) + 1
            };
        } else {
            loginData.users.push({
                ...devLoginInfo,
                firstLogin: currentTime,
                lastLogin: currentTime,
                loginCount: 1
            });
        }

        loginData.sessions[sessionId] = {
            loginType: 'Developer',
            ip: userIP,
            createdAt: currentTime,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            isDeveloper: true
        };

        saveLoginData();
       
        
        res.json({ success: true, sessionId: sessionId });
    } else {
        res.status(401).json({ success: false, message: 'كلمة مرور خاطئة' });
    }
});


app.get('/api/login-data', (req, res) => {
    const now = new Date().toISOString();
    Object.keys(loginData.sessions).forEach(sessionId => {
        if (loginData.sessions[sessionId].expiresAt < now) {
            delete loginData.sessions[sessionId];
        }
    });
    
    saveLoginData();
    res.json(loginData);
});


app.get('/api/tokens-data', (req, res) => {
    
    const now = Date.now();
    tokensData.tokens = tokensData.tokens.filter(token => {
        const savedTime = new Date(token.savedAt).getTime();
        const expiresAt = savedTime + (token.expiresIn * 1000);
        return expiresAt > now;
    });
    
    saveTokensData();
    res.json(tokensData);
});


app.delete('/api/tokens/:discordId', (req, res) => {
    const { discordId } = req.params;
    const initialLength = tokensData.tokens.length;
    tokensData.tokens = tokensData.tokens.filter(token => token.discordId !== discordId);
    
    if (tokensData.tokens.length < initialLength) {
        saveTokensData();
        res.json({ success: true, message: 'تم حذف التوكن' });
    } else {
        res.status(404).json({ success: false, message: 'التوكن غير موجود' });
    }
});


app.delete('/api/clear-tokens', (req, res) => {
    tokensData = { tokens: [] };
    saveTokensData();
    res.json({ success: true, message: 'تم مسح جميع التوكنز' });
});

// جلب جميع الفرومات
app.get('/api/forums', (req, res) => {
    reloadConfig();
    res.json(config.forums || {});
});

//  حذف روم داخل فروم معين
app.delete('/api/forums/:forumId/channels/:channelId', (req, res) => {
    reloadConfig();
    const { forumId, channelId } = req.params;

    if (!config.forums || !config.forums[forumId]) {
        return res.status(404).json({ success: false, message: 'الفروم غير موجود' });
    }

    if (!config.forums[forumId].channels || !config.forums[forumId].channels[channelId]) {
        return res.status(404).json({ success: false, message: 'الروم غير موجود في هذا الفروم' });
    }

    delete config.forums[forumId].channels[channelId];

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// إضافة فروم جديد
app.post('/api/forums', (req, res) => {
    reloadConfig();
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ success: false, message: 'ID أو الاسم ناقص' });

    if (!config.forums) config.forums = {};
    config.forums[id] = { name, channels: {} };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

//  تعديل روم داخل فروم: الاسم، التاقات، التاقات المحظورة
app.post('/api/forums/:forumId/channels/:channelId', (req, res) => {
    reloadConfig();
    const { forumId, channelId } = req.params;
    const { name, tags, bannedTags, searchMode } = req.body;  

    if (!config.forums?.[forumId]?.channels?.[channelId]) {
        return res.status(404).json({ success: false, message: 'الروم غير موجود' });
    }

    const channel = config.forums[forumId].channels[channelId];

    if (typeof name === 'string') channel.name = name;
    if (Array.isArray(tags)) channel.tags = tags;
    if (Array.isArray(bannedTags)) channel.bannedTags = bannedTags;
    
    
    if (typeof searchMode === 'string' && ['AND', 'OR'].includes(searchMode)) {
        channel.searchMode = searchMode;
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// تعديل فروم 
app.post('/api/forums/:oldId', (req, res) => {
    reloadConfig();
    const { oldId } = req.params;
    const { newId, name } = req.body;

    if (!config.forums || !config.forums[oldId]) {
        return res.status(404).json({ success: false, message: 'الفروم غير موجود' });
    }

    const forumData = config.forums[oldId];
    delete config.forums[oldId];

    config.forums[newId] = {
        name: name || forumData.name,
        channels: forumData.channels || {}
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// حذف فروم بالكامل
app.delete('/api/forums/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    if (!config.forums || !config.forums[id]) {
        return res.status(404).json({ success: false, message: 'الفروم غير موجود' });
    }

    delete config.forums[id];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// إضافة روم داخل فروم
app.post('/api/forums/:forumId/channels', (req, res) => {
    reloadConfig();
    const { forumId } = req.params;
    const { id, name } = req.body;

    if (!config.forums || !config.forums[forumId]) {
        return res.status(404).json({ success: false, message: 'الفروم غير موجود' });
    }

    if (!id || !name) {
        return res.status(400).json({ success: false, message: 'ID أو الاسم ناقص' });
    }

    if (!config.forums[forumId].channels) {
        config.forums[forumId].channels = {};
    }

    config.forums[forumId].channels[id] = {
        name,
        tags: [],
        bannedTags: [],
        searchMode: 'AND'  
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// تحديث قناة معينة 
app.post('/api/channels/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const { name, tags } = req.body;
    if (!Array.isArray(tags) || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'صيغة البيانات غير صحيحة' });
    }
    if (!config.channels[id]) config.channels[id] = {};
    config.channels[id].name = name;
    config.channels[id].tags = tags;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});


app.post('/api/channels', (req, res) => {
    reloadConfig();
    const { id, name, tags } = req.body;
    if (!id || !name || !Array.isArray(tags)) {
        return res.status(400).json({ success: false });
    }
    config.channels[id] = { name, tags, bannedTags: [] };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});


app.delete('/api/channels/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    if (config.channels[id]) {
        delete config.channels[id];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'الروم غير موجود' });
});

// جلب البان العام
app.get('/api/banned', (req, res) => {
    reloadConfig();
    res.json(config.bannedTags || []);
});

// تحديث البان العام
app.post('/api/banned', (req, res) => {
    reloadConfig();
    config.bannedTags = req.body.bannedTags || [];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// جلب البان الخاص بالقناة
app.get('/api/channel-banned/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const ch = config.channels[id];
    if (!ch) return res.status(404).json({ success: false, message: 'الروم غير موجود' });
    res.json(ch.bannedTags || []);
});

// تحديث البان الخاص بالقناة
app.post('/api/channel-banned/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const { bannedTags } = req.body;
    if (!Array.isArray(bannedTags)) return res.status(400).json({ success: false });
    if (!config.channels[id]) return res.status(404).json({ success: false, message: 'الروم غير موجود' });

    config.channels[id].bannedTags = bannedTags;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// جلب قنات الملخص
app.get('/api/summary-channel', (req, res) => {
    reloadConfig();
    res.json({
        summaryChannel: config.summaryChannel || { id: '', name: '' }
    });
});

// تحديث قنات الملخص
app.post('/api/summary-channel', (req, res) => {
    reloadConfig();
    const { summaryChannel, summaryChannelName } = req.body;

    if (!summaryChannel) {
        return res.status(400).json({ success: false, message: 'Missing summaryChannel ID' });
    }

    config.summaryChannel = {
        id: summaryChannel,
        name: summaryChannelName || ''
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});


// جلب الرولات
app.get('/api/rules', (req, res) => {
    reloadRule();
    res.json(rule);
});

// تحديث الرولات
app.post('/api/rules/:command', (req, res) => {
    reloadRule();
    const { command } = req.params;
    const roles = req.body.roles;

    if (!Array.isArray(roles)) return res.status(400).json({ success: false });
    for (const r of roles) {
        if (!r.id || !r.name) {
            return res.status(400).json({ success: false, message: 'كل رول يجب أن يحتوي على id و name' });
        }
    }

    rule[command] = roles;

    fs.writeFileSync(rulePath, JSON.stringify(rule, null, 2));
    res.json({ success: true });
});

// التحكم في حالة البوت 
app.post('/api/bot-status', (req, res) => {
    reloadConfig();
    const { status } = req.body;

    if (!['running', 'stopped'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    config.botStatus = status;
    config.startTime = status === 'running' ? Date.now() : null;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    res.json({ success: true, message: `Bot status set to ${status}` });
});

// جلب وقت تشغيل البوت وحالته
app.get('/api/uptime', (req, res) => {
    reloadConfig();

    const status = config.botStatus || 'stopped';
    const uptime = config.startTime ? Date.now() - config.startTime : 0;

    res.json({ uptime, status });
});

// إعادة تشغيل البوت 
app.post('/api/restart-bot', async (req, res) => {
    const panelURL = 'https://control.bot-hosting.net';
    const serverUUID = '9aba59a0';
    const apiToken = 'ptlc_WMfFGrsKXe1mPT3BxQTWmNXUzuVWPi15RCaqZiKMb8n';

    try {
        const response = await fetch(`${panelURL}/api/client/servers/${serverUUID}/power`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
                'Accept': 'Application/vnd.pterodactyl.v1+json'
            },
            body: JSON.stringify({ signal: 'restart' })
        });

        if (!response.ok) {
            const err = await response.text();
            return res.status(500).json({ success: false, message: 'Failed to restart bot', error: err });
        }

        
        reloadConfig();
        config.botStatus = 'running';
        config.startTime = Date.now(); 
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        res.json({ success: true, message: 'Bot restarted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error connecting to panel', error: err.message });
    }
});


app.get('/dashboard.html', (req, res) => {
   

    
    if (!isUserLoggedIn(req)) {
  
        return res.send(getAccessDeniedPage());
    }
    
    
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});


app.use(express.static(__dirname));

const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(` ✅  running at :http://prem-eu2.bot-hosting.net:20672/`);
    console.log(` ⚙️  Dashboard : http://prem-eu2.bot-hosting.net:20672/dashboard.html`);
    console.log(` 🖥️  Login data will be saved to: ${loginPath}`);
    
});