const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const Lowdb = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fetch = require('node-fetch');
const config = require('./config.json');
const rules = require('./rule.json');

const adapter = new FileSync('db.json');
const db = Lowdb(adapter);
db.defaults({ postedUrls: [], history: [], deletions: [] }).write();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

function hasPermission(member, command) {
    if (member.id === '1324828948843991200') return true;
    const allowedRoles = (rules[command] || []).map(r => r.id);
    return member.roles.cache.some(r => allowedRoles.includes(r.id));
}

function removeInvisibleChars(text) {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function hasBannedTags(tagsString, bannedTagsList = config.bannedTags) {
    const tags = tagsString.toLowerCase().split(' ');
    return bannedTagsList.some(banned => tags.includes(banned.toLowerCase()));
}

function isVideo(url) {
    return /\.(mp4|webm)$/i.test(url);
}

function isImage(url) {
    return /\.(jpg|jpeg|png)$/i.test(url);
}

function isAllowedType(url, type) {
    if (!url) return false;
    if (type === 'video') return isVideo(url);
    if (type === 'image') return isImage(url);
    return isImage(url) || isVideo(url);
}

const xml2js = require('xml2js');
const parser = new xml2js.Parser();
                 
function getSourceInfo(source) {
    switch (source) {
        case 'danbooru':
            return {
                name: 'DANBOORU',
                url: 'https://danbooru.donmai.us'
            };
        case 'gelbooru':
            return {
                name: 'GELBOORU',
                url: 'https://gelbooru.com'
            };
        case 'rule34':
            return {
                name: 'RULE34',
                url: 'https://rule34.xxx'
            };
        default:
            return {
                name: 'DANBOORU',
                url: 'https://danbooru.donmai.us'
            };
    }
}

async function fetchGelbooruPosts(tags, limit) {
    const results = [];
    let page = 0;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = encodeURIComponent(tags.join(' ') + ' rating:explicit');
        
        // استخدام نفس النمط من الكود الشغال
        const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${tagQuery}&limit=${countToFetch}&pid=${page}&api_key=633aa18c7c7ced9186d7e593ab8a70f3c43fabeafb2c44cf4c599ea5e9051cf6a63d4295309dcbdf361bc1e9541c90fe34533ffc416e69b10202dd5c2c60596e&user_id=1794493`;
        try {
            const response = await fetch(url, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json, */*',
                    'Cache-Control': 'no-cache'
                },
                timeout: 15000
            });

            if (!response.ok) {
                console.error(`❌ Gelbooru HTTP Error: ${response.status} - ${response.statusText}`);
                if (response.status === 401) {
                    console.error('❌ Gelbooru: API Key غير صحيح أو منتهي الصلاحية');
                }
                break;
            }

            const text = await response.text();
            
            // تنظيف النص من BOM والمحارف الغريبة
            const cleanText = text.replace(/^\uFEFF/, '').trim();
            
            if (!cleanText) {
                console.warn('⚠️ Gelbooru: استجابة فارغة');
                break;
            }

            let data;
            try {
                data = JSON.parse(cleanText);
            } catch (jsonError) {
                console.error(`📛 الرد من Gelbooru مش JSON صالح (page: ${page})`);
                console.error('Response text:', cleanText.substring(0, 200));
                break;
            }

            // التحقق من هيكل البيانات
            if (!data) {
                console.warn('⚠️ Gelbooru: لا توجد بيانات');
                break;
            }

            let posts = [];
            
            // التعامل مع الاستجابات المختلفة من Gelbooru
            if (Array.isArray(data)) {
                // أحيانا يرجع array مباشر
                posts = data;
            } else if (data.post) {
                // أحيانا يرجع object مع post
                posts = Array.isArray(data.post) ? data.post : [data.post];
            } else if (data['@attributes'] && data['@attributes'].count === '0') {
                // لا توجد نتائج
                console.log('⚠️ Gelbooru: لا توجد نتائج لهذه التاغات');
                break;
            } else {
                console.warn('⚠️ Gelbooru: هيكل استجابة غير متوقع');
                break;
            }

            if (!posts.length) {
                console.log('⚠️ Gelbooru: لا توجد منشورات في هذه الصفحة');
                break;
            }

            // تحويل البيانات لتتوافق مع باقي الكود
            const processedPosts = posts.map(post => ({
                file_url: post.file_url,
                tags: post.tags || post.tag_string || '',
                id: post.id,
                // إضافة خصائص أخرى مفيدة
                width: post.width,
                height: post.height,
                score: post.score
            }));

            results.push(...processedPosts);
            
            // إذا حصلنا على عدد أقل من المطلوب، يعني وصلنا لآخر صفحة
            if (processedPosts.length < countToFetch) break;
            
            page++;
            
            // تأخير بين الطلبات لتجنب rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (err) {
            console.error('❌ خطأ في جلب البيانات من Gelbooru:', err.message);
            break;
        }
    }

    console.log(`✅ Gelbooru: تم جلب ${results.length} نتيجة`);
    return results.slice(0, limit);
}

// إضافة دالة للتحقق من حالة API
async function testGelbooruAPI() {
    try {
        const testUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=rating:explicit&limit=1&api_key=${config.api_key}&user_id=${config.user_id}`;
        
        const response = await fetch(testUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        console.log(`🔍 Gelbooru API Test Status: ${response.status}`);
        
        if (response.ok) {
            const text = await response.text();
            const data = JSON.parse(text);
            console.log('✅ Gelbooru API يعمل بشكل صحيح');
            return true;
        } else {
            console.log('❌ Gelbooru API لا يعمل');
            return false;
        }
        
    } catch (error) {
        console.error('❌ فشل اختبار Gelbooru API:', error.message);
        return false;
    }
}
    
async function fetchDanbooruPosts(tags, limit) {
    const results = [];
    let page = 1;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = tags.join('+') + '+rating:explicit';
        const url = `https://danbooru.donmai.us/posts.json?tags=${tagQuery}&limit=${countToFetch}&page=${page}&login=${config.danbooru.login}&api_key=${config.danbooru.api_key}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;
            results.push(...data);
            if (data.length < countToFetch) break;
            page++;
        } catch {
            break;
        }
    }

    return results.slice(0, limit);
}

async function fetchRule34Posts(tags, limit) {
    const results = [];
    let page = 0;
    const perPage = 100;

    while (results.length < limit) {
        const countToFetch = Math.min(perPage, limit - results.length);
        const tagQuery = tags.join('%20') + '%20rating:explicit';
        
        
        const endpoints = [
            `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&tags=${tagQuery}&limit=${countToFetch}&pid=${page}&json=1`,
            `https://rule34.xxx/index.php?page=dapi&s=post&q=index&tags=${tagQuery}&limit=${countToFetch}&pid=${page}`
        ];

        let success = false;

        for (const url of endpoints) {
            try {
                const res = await fetch(url, {
                    headers: { 
                        'User-Agent': config.rule34?.userAgent || 'Mozilla/5.0 (compatible; DiscordBot)',
                        'Accept': 'application/json, application/xml, text/xml, */*',
                        'Cache-Control': 'no-cache'
                    },
                    timeout: 15000
                });

                if (!res.ok) {
                    
                    continue;
                }

                const contentType = res.headers.get('content-type') || '';

                
                if (url.includes('json=1') || contentType.includes('application/json')) {
                    try {
                        const data = await res.json();
                        
                        if (data && Array.isArray(data)) {
                            const posts = data.map(post => ({
                                file_url: post.file_url || post.image,
                                tags: post.tags || post.tag_string || '',
                                id: post.id
                            }));
                            
                            results.push(...posts);
                            success = true;
                            break;
                        }
                    } catch (jsonErr) {
                      
                    }
                }

                
                try {
                    const text = await res.text();
                    
                    
                    const cleanText = text.replace(/^\uFEFF/, '').trim();
                    
                    if (cleanText.startsWith('<?xml') || cleanText.startsWith('<posts')) {
                        const data = await parser.parseStringPromise(cleanText);
                        
                        if (data && data.posts && data.posts.post) {
                            const posts = Array.isArray(data.posts.post) ? data.posts.post : [data.posts.post];
                            const processedPosts = posts.map(post => ({
                                file_url: post.$.file_url || post.$.image,
                                tags: post.$.tags || '',
                                id: post.$.id
                            }));
                            
                            results.push(...processedPosts);
                            success = true;
                            break;
                        }
                    }
                } catch (xmlErr) {
                  
                }

            } catch (err) {
               
                continue;
            }
        }

        if (!success) {
           
            break;
        }

        if (results.length === 0) break;
        page++;
        
        
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    
}

async function fetchWithORLogic(tags, limit, fetchFunction, siteName) {
    const results = [];
    const seenUrls = new Set();
    
    
    
    
    for (const tag of tags) {
        if (results.length >= limit) break;
        
        
        
        try {
            const posts = await fetchFunction([tag], Math.min(100, limit - results.length));
            
            for (const post of posts) {
                if (results.length >= limit) break;
                
                const url = post.file_url || post.file?.url || post.fileUrl;
                if (url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    results.push(post);
                }
            }
        } catch (error) {
           
        }
        
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
   
    return results.slice(0, limit);
}

async function postContent(channel, tags, type, count, userId, source, roomBannedTags = [], searchMode = "AND") {
    const postedUrls = db.get('postedUrls').value();
    const postedUrlsSet = new Set(postedUrls.map(p => p.url));
    const results = [];

    
    const allBannedTags = [...config.bannedTags, ...roomBannedTags];

    console.log(`🔍 نمط البحث: ${searchMode}`);
    console.log(`🏷️ التاغات: ${tags.join(', ')}`);
    console.log(`🚫 التاغات المحظورة: ${allBannedTags.join(', ')}`);

    let fetchFunction;
    
    if (searchMode === 'OR' && tags.length > 0) {
        // منطق OR 
        switch (source) {
            case 'rule34':
                fetchFunction = (limit) => fetchWithORLogic(tags, limit, fetchRule34Posts, 'Rule34');
                break;
            case 'gelbooru':
                fetchFunction = (limit) => fetchWithORLogic(tags, limit, fetchGelbooruPosts, 'Gelbooru');
                break;
            case 'danbooru':
            default:
                fetchFunction = (limit) => fetchWithORLogic(tags, limit, fetchDanbooruPosts, 'Danbooru');
                break;
        }
    } else {
        // منطق AND 
        switch (source) {
            case 'rule34':
                fetchFunction = () => fetchRule34Posts(tags, 100);
                break;
            case 'gelbooru':
                fetchFunction = () => fetchGelbooruPosts(tags, 100);
                break;
            case 'danbooru':
            default:
                fetchFunction = () => fetchDanbooruPosts(tags, 500);
                break;
        }
    }

    for (let round = 0; round < 5 && results.length < count; round++) {
        console.log(`🔄 الجولة ${round + 1} - المطلوب: ${count}, الموجود: ${results.length}`);
        
        const posts = searchMode === 'OR' ? 
            await fetchFunction(count - results.length + 50) : 
            await fetchFunction();

        if (!posts || posts.length === 0) {
            
            break;
        }

       

        for (const post of posts) {
            if (results.length >= count) break;

            const url = post.file_url || post.file?.url || post.fileUrl;
            if (!url || !isAllowedType(url, type)) continue;

            let postTags = '';
            if (Array.isArray(post.tags)) postTags = post.tags.join(' ');
            else if (typeof post.tags === 'string') postTags = post.tags;
            else if (typeof post.tag_string === 'string') postTags = post.tag_string;

            
            if (hasBannedTags(postTags, allBannedTags)) {
                console.log(`🚫 تم رفض المنشور بسبب تاغ محظور: ${url}`);
                continue;
            }
            
            if (postedUrlsSet.has(url)) {
             
                continue;
            }

            try {
                await channel.send(url);
              

                db.get('postedUrls').push({ url, channelId: channel.id }).write();
                db.get('history').push({
                    channelId: channel.id,
                    url,
                    userId,
                    timestamp: new Date().toISOString()
                }).write();

                postedUrlsSet.add(url);
                results.push(post);
            } catch (e) {
                
            }
        }

      
        
       
        if (posts.length === 0) break;
    }

    
    return results.length;
}
async function getSafeHentaiGif(tags = []) {
    const query = [...tags, 'animated', 'gif', 'rating:explicit']
        .filter(t => !config.bannedTags.includes(t.toLowerCase()))
        .join('+');

    const url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&tags=${query}&limit=100&pid=0`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': config.rule34?.userAgent || 'DiscordBot' }
        });
        const xml = await res.text();
        const parsed = await parser.parseStringPromise(xml);
        const posts = parsed?.posts?.post || [];
        const gifs = posts.filter(p => p.$?.file_url?.endsWith('.gif'));
        if (gifs.length === 0) return null;

        const random = gifs[Math.floor(Math.random() * gifs.length)];
        return random.$.file_url;
    } catch (err) {
        console.warn('⚠️ فشل في جلب صورة GIF من Rule34:', err.message);
        return null;
    }
}

function getTimeLimit(duration) {
    const now = Date.now();
    const map = {
        day: 86400000,
        week: 604800000,
        month: 2592000000,
        year: 31536000000
    };
    return new Date(now - (map[duration] || 0));
}

// دالة لإنشاء خيارات الرومات بناءً على الفروم
function getRoomChoicesForForum(forumId) {
    const forum = config.forums[forumId];
    if (!forum || !forum.channels) return [];
    
    return Object.entries(forum.channels).map(([channelId, channelData]) => ({
        name: channelData.name,
        value: channelId
    }));
}

//  خيارات الفرومات
function getForumChoices() {
    const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    return Object.entries(currentConfig.forums).map(([forumId, forumData]) => ({
        name: forumData.name,
        value: forumId
    }));
}

async function registerSlashCommands() {
    const forumChoices = getForumChoices();

    const commands = [
        new SlashCommandBuilder()
            .setName('post')
            .setDescription('نـشـر مـحـتـوى تـلـقـائـي\nAUTOMATIC CONTENT POSTING')
            .addStringOption(opt =>
                opt.setName('forum')
                    .setDescription('اخـتـيـار الـفـروم\nSELECT THE FORUM')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اخـتـيـار الـروم\nSELECT THE ROOM')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('نـوع الـمـحـتـوى\nCONTENT TYPE')
                    .setRequired(true)
                    .addChoices(
                        { name: 'صـور فـقـط', value: 'image' },
                        { name: 'فـيـديـو فـقـط', value: 'video' },
                        { name: 'كـلاهـمـا', value: 'both' }
                    )
            )
            .addIntegerOption(opt =>
                opt.setName('count')
                    .setDescription('عـدد الـمـنـشـورات (5-250)\nNUMBER OF POSTS ')
                    .setRequired(true)
                    .setMinValue(5)
                    .setMaxValue(250)
            )
            .addStringOption(opt =>
                opt.setName('source')
                    .setDescription('تـحـديـد الـمـصـدر \nSELECT SOURCE ')
                    .setRequired(true)
                    .addChoices(       
                        { name: 'DANBOORU  [الـأفـضـل]', value: 'danbooru' },
                        { name: 'GELBOORU  [غـيـر دقـيـق بـعـض الـأحـيـان]', value: 'gelbooru' },
                        { name: 'RULE34 [مـعـطـل تـحـت صـيـانـة]', value: 'rule34' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('reset')
            .setDescription('اعـادة ضـبـط سـجـل الـنـشـر\nRESET POSTING LOG')
            .addStringOption(opt =>
                opt.setName('forum')
                    .setDescription('اخـتـيـار الـفـروم\nSELECT THE FORUM')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اخـتـيـار الـروم او كـل الـرومـات\nSELECT ROOM OR ALL ROOMS')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('reason')
                    .setDescription('سـبـب اعـادة الـضـبـط\nREASON FOR RESET')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('info')
            .setDescription('عـرض احـصـائـيـات الـنـشـر فـقـط\nSHOW POSTING STATISTICS ONLY')
            .addStringOption(opt =>
                opt.setName('duration')
                    .setDescription('اخـتـيـار الـمـدة\nCHOOSE DURATION')
                    .setRequired(true)
                    .addChoices(
                        { name: 'الـيـوم', value: 'day' },
                        { name: 'الـاسـبـوع', value: 'week' },
                        { name: 'الـشـهـر', value: 'month' },
                        { name: 'الـسـنـة', value: 'year' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('forum')
                    .setDescription('اخـتـيـار الـفـروم\nSELECT THE FORUM')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اخـتـيـار الـروم او كـل الـرومـات\nSELECT ROOM OR ALL ROOMS')
                    .setRequired(true)
                    .setAutocomplete(true)
            ),

        new SlashCommandBuilder()
            .setName('reset_log')
            .setDescription('عـرض عـمـلـيـات حـذف سـجـل الـنـشـر\nSHOW POSTING LOG DELETION ACTIONS')
            .addStringOption(opt =>
                opt.setName('duration')
                    .setDescription('اخـتـيـار الـمـدة\nCHOOSE DURATION')
                    .setRequired(true)
                    .addChoices(
                        { name: 'الـيـوم', value: 'day' },
                        { name: 'الـاسـبـوع', value: 'week' },
                        { name: 'الـشـهـر', value: 'month' },
                        { name: 'الـسـنـة', value: 'year' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('forum')
                    .setDescription('اخـتـيـار الـفـروم\nSELECT THE FORUM')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('room')
                    .setDescription('اخـتـيـار الـروم او كـل الـرومـات\nSELECT ROOM OR ALL ROOMS')
                    .setRequired(true)
                    .setAutocomplete(true)
            ),

        new SlashCommandBuilder()
            .setName('help')
            .setDescription('عـرض قـائـمـة الاوامـر مـع الـشـرح\nSHOW COMMANDS LIST WITH EXPLANATION')
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
}
client.once('ready', async () => {
    console.log(`🤖 البوت شغّال كـ ${client.user.tag}`);
    await registerSlashCommands();
});

const fs = require('fs');

// معالجة Autocomplete للأوامر
client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        const command = interaction.commandName;
        
        if (['post', 'reset', 'info', 'reset_log'].includes(command)) {
            const focusedOption = interaction.options.getFocused(true);
            
            if (focusedOption.name === 'forum') {
                const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
                const forumChoices = Object.entries(currentConfig.forums).map(([forumId, forumData]) => ({
                    name: forumData.name,
                    value: forumId
                }));
                
                const filtered = forumChoices.filter(choice => 
                    choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
                );
                
                await interaction.respond(filtered.slice(0, 25));
            } 
            else if (focusedOption.name === 'room') {
                const selectedForum = interaction.options.getString('forum');
                const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
                
                if (selectedForum && currentConfig.forums[selectedForum]) {
                    const roomChoices = [];
                    
                    if (command !== 'post') {
                        roomChoices.push({
                            name: 'جميع الرومات - ALL ROOMS',
                            value: 'all'
                        });
                    }
                    
                    if (currentConfig.forums[selectedForum].channels) {
                        Object.entries(currentConfig.forums[selectedForum].channels).forEach(([channelId, channelData]) => {
                            roomChoices.push({
                                name: channelData.name,
                                value: channelId
                            });
                        });
                    }
                    
                    const filtered = roomChoices.filter(choice => 
                        choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
                    );
                    
                    if (filtered.length === 0 && focusedOption.value === '') {
                        await interaction.respond([
                            { name: '❌ لا توجد رومات في هذا الفروم', value: 'no_rooms_in_forum' }
                        ]);
                    } else {
                        await interaction.respond(filtered.slice(0, 25));
                    }
                } else {
                    await interaction.respond([
                        { name: '⚠️ يرجى اختيار فروم أولاً', value: 'no_forum_selected' }
                    ]);
                }
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

    if (config.botStatus === 'stopped') {
        return interaction.reply({
            content: '**__<a:warning:1395414609527046326> الـبـوت مـتـوقـف حـالـيـا مـن قـبـل الـمـبـرمـجـيـن !__**',
            ephemeral: true
        });
    }

    const command = interaction.commandName;
    if (command === 'post') {
        if (!hasPermission(interaction.member, 'POST')) {
            return interaction.reply({
                content: '**__<a:warning:1395414609527046326> لـيـس لـديـك صـلاحـيـات لاسـتـخـدام هـذا الـامـر__**',
                flags: 64
            });
        }

        const forumId = interaction.options.getString('forum');
        const roomId = interaction.options.getString('room');
        const type = interaction.options.getString('type');
        const count = interaction.options.getInteger('count');
        const sourceFilter = interaction.options.getString('source') || 'all';

        // تحديث config للحصول على أحدث البيانات
        const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        
        // التحقق من صحة الروم value
        if (roomId === 'no_forum_selected') {
            return interaction.reply({
                content: '**__<a:warning:1395414609527046326> يرجى اختيار فروم صحيح أولاً__**',
                flags: 64
            });
        }

        if (roomId === 'no_rooms_in_forum') {
            return interaction.reply({
                content: '**__<a:warning:1395414609527046326> لا توجد رومات في الفروم المختار__**',
                flags: 64
            });
        }

        // التحقق من أن الروم موجود في الفروم المحدد
        const forum = currentConfig.forums[forumId];
        if (!forum || !forum.channels || !forum.channels[roomId]) {
            return interaction.reply({
                content: '**__<a:warning:1395414609527046326> الروم المحدد غير موجود في الفروم المختار__**',
                flags: 64
            });
        }

        const targetChannel = await client.channels.fetch(roomId).catch(() => null);
        if (!targetChannel) {
            return interaction.reply({
                content: '**__<a:warning:1395414609527046326> لايـمـكـن الـوصول لـلـروم الـمـحـدد__**',
                flags: 64
            });
        }

     const tags = forum.channels[roomId].tags || [];
     const roomBannedTags = forum.channels[roomId].bannedTags || [];
     const searchMode = forum.channels[roomId].searchMode || "AND";
        
   await interaction.reply({
      content: '**__<a:ezgif4aa2ec402b1c43:1393268691142971492> جـاري بـحـث عـن مـنـشـورات و نـشـرهـا الـارجـاء انـتـظـار  __**',
      flags: 64
});


  const sentCount = await postContent(targetChannel, tags, type, count, interaction.user.id, sourceFilter, roomBannedTags, searchMode);
        if (sentCount === 0) {
            return interaction.editReply({
                content: `**__<a:warning:1395414609527046326> لـم يـتـم الـعـثـور عـلـى مـحـتـوى مـنـاسـب لـلـتـاقـات: \`${tags.join(' + ')}\`__**`
            });
        }

        await interaction.editReply({
            content: `تـم نـشـر ${sentCount} مـنـشـور فـي <#${roomId}>`
        });

const sourceInfo = getSourceInfo(sourceFilter); // استخدام المتغير sourceFilter الموجود

const reportChannel = await client.channels.fetch(currentConfig.summaryChannel.id);
const embed = new EmbedBuilder()
    .setTitle('تـقـريـر نـشـر تـلـقـائـي')
    .setColor('Orange')
    .setDescription([
        `**__الـفـروم: <#${forumId}> __** \n `,  // عرض الفورم كـ channel mention مع الاسم
        `**__الـروم: <#${roomId}>__** \n `,
        `**__عـدد الـمـنـشـورات: ${sentCount}__** \n `,
        `**__الـمـصـدر: [${sourceInfo.name}](${sourceInfo.url})__** \n `,  // المصدر الديناميكي
        `**__الـمـسـؤول: <@${interaction.user.id}>__** \n `,
        `**__الـوقـت:__** \n **__ <t:${Math.floor(Date.now() / 1000)}:F>__**`
    ].join('\n'))
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&')
    .setTimestamp();

await reportChannel.send({ embeds: [embed] });
    }
  else if (command === 'reset') {
    if (!hasPermission(interaction.member, 'RESET')) {
        return interaction.reply({ content: '**__ <a:warning:1395414609527046326> لـيـس لـديـك صـلاحـيـات لاسـتـخـدام هـذا الـامـر__**', flags: 64 });
    }

    const forumId = interaction.options.getString('forum');
    const room = interaction.options.getString('room');
    const reason = interaction.options.getString('reason');

    
    if (room === 'no_forum_selected' || room === 'no_rooms_in_forum') {
        return interaction.reply({
            content: '**__<a:warning:1395414609527046326> يرجى اختيار فروم وروم صحيح__**',
            flags: 64
        });
    }

    // تحديث config 
    const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    
    let affectedChannels = [];
    let displayText = '';

    if (room === 'all') {
        // جمع جميع الرومات من الفروم المحدد
        if (currentConfig.forums[forumId] && currentConfig.forums[forumId].channels) {
            Object.keys(currentConfig.forums[forumId].channels).forEach(channelId => {
                affectedChannels.push(channelId);
            });
            displayText = `جميع رومات ${currentConfig.forums[forumId].name}`;
        }
    } else {
        affectedChannels = [room];
        displayText = `<#${room}>`;
    }

    const embedConfirm = new EmbedBuilder()
        .setTitle('تــاكــيــد إعــادة الـضـبـط')
        .setColor('Orange')
        .setDescription(`**__هـل انـت مـتـاكـد مـن حـذف سـجـل مـنـشـورات فـي:__**\n${displayText}\n\n**__الـسـبـب:__** ${reason}`)
        .setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&')
        .setTimestamp();

    await interaction.reply({
        embeds: [embedConfirm],
        components: [{
            type: 1,
            components: [
                { type: 2, label: 'نـعـم', style: 3, custom_id: 'confirm_reset' },
                { type: 2, label: 'لـا', style: 4, custom_id: 'cancel_reset' }
            ]
        }],
        flags: 64
    });

    const filter = i => ['confirm_reset', 'cancel_reset'].includes(i.customId) && i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000, max: 1 });

    collector.on('collect', async i => {
        if (i.customId === 'cancel_reset') {
            return i.update({ content: '**__ <a:warning:1395414609527046326> تـم إلـغـاء الـعـمـلـيـة__**', components: [] });
        }

        const oldPosts = db.get('postedUrls').value();
        let deletedCount = 0;
        let remaining = oldPosts;
        let deletedChannels = [];

        if (room === 'all') {
            deletedCount = oldPosts.filter(p => affectedChannels.includes(p.channelId)).length;
            deletedChannels = affectedChannels;
            remaining = oldPosts.filter(p => !affectedChannels.includes(p.channelId));
        } else {
            deletedCount = oldPosts.filter(p => p.channelId === room).length;
            deletedChannels = [room];
            remaining = oldPosts.filter(p => p.channelId !== room);
        }

        db.set('postedUrls', remaining).write();

        // سجل الحذف في deletions
        for (const id of deletedChannels) {
            const count = oldPosts.filter(p => p.channelId === id).length;
            if (count > 0) {
                db.get('deletions')
                    .push({
                        channelId: id,
                        deletedBy: interaction.user.id,
                        deletedCount: count,
                        reason,
                        timestamp: new Date().toISOString()
                    })
                    .write();
            }
        }

        await i.update({ content: `**__تـم حـذف__** ${deletedCount} **__مـنـشـور مـن__** ${displayText}`, components: [] });

        const reportChannel = await client.channels.fetch(currentConfig.summaryChannel.id);
        const embed = new EmbedBuilder()
            .setTitle(' ســجــل حــذف الــمــنــشــورات')
            .setColor('Purple')
            .setDescription([
                `**__ تــم حــذف مــنــشــورات مــن : \n${deletedChannels.map(id => `🔸 <#${id}>`).join('\n')}__**`,
                `\n**__ عــدـد الــمــنــشــورات :${deletedCount}__**`,
                `\n**__ الــمــســؤول :<@${interaction.user.id}>__**`,
                `\n**__ الــســبــب :${reason}__**`,
                `\n\n**__ الــوقــت  :<t:${Math.floor(Date.now() / 1000)}:F>__**`
            ].join('\n'))
            .setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&')
            .setTimestamp();

        await reportChannel.send({ embeds: [embed] });
    });
}
   else if (command === 'info') {
    if (!hasPermission(interaction.member, 'INFO')) {
        return interaction.reply({
            content: '**__<a:warning:1395414609527046326> لـيـس لـديـك صـلاحـيـات لاسـتـخـدام هـذا الـامـر__**', flags: 64 });
    }

    const duration = interaction.options.getString('duration');
    const forumId = interaction.options.getString('forum');
    const roomId = interaction.options.getString('room');
    const since = getTimeLimit(duration);

    
    if (roomId === 'no_forum_selected' || roomId === 'no_rooms_in_forum') {
        return interaction.reply({
            content: '**__<a:warning:1395414609527046326> يرجى اختيار فروم وروم صحيح__**',
            flags: 64
        });
    }

    const currentConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    let targetChannels = [];
    
    if (roomId === 'all') {
        if (currentConfig.forums[forumId] && currentConfig.forums[forumId].channels) {
            targetChannels = Object.keys(currentConfig.forums[forumId].channels);
        }
    } else {
        targetChannels = [roomId];
    }

    const filtered = db.get('history').filter(e =>
        new Date(e.timestamp) >= since &&
        targetChannels.includes(e.channelId)
    ).value();

    if (filtered.length === 0) {
        return interaction.reply({ content: '**__ لــا يــوجــد عــمــلــيــات نــشــر خــلال فــتــرة تــم اخــتــيــارهــا __**', flags: 64 });
    }

    const stats = {};
    for (const entry of filtered) {
        const room = entry.channelId;
        if (!stats[room]) stats[room] = { total: 0, users: {} };
        stats[room].total++;
        stats[room].users[entry.userId] = (stats[room].users[entry.userId] || 0) + 1;
    }

    let desc = '';
    for (const [room, data] of Object.entries(stats)) {
        desc += `**__الـروم :<#${room}>__**\n`;
        desc += `**__ مـجـمـوع الـمـنـشـروات فـي الـروم: ${data.total} __**\n`;

        for (const [uid, cnt] of Object.entries(data.users)) {
            desc += `**__ <@${uid}>: ${cnt} مـنـشـور عـن طـريـق __**\n`;
        }

        desc += `**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n`;
    }
    
    const embed = new EmbedBuilder()
        .setTitle('احــصــائــيــات الــنــشــر')
        .setColor('#ffa500')
        .setDescription(desc)
        .setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

    else if (command === 'reset_log') {
        if (!hasPermission(interaction.member, 'RESET_LOG')) {
            return interaction.reply({ content: '**__<a:warning:1395414609527046326> لـيـس لـديـك صـلاحـيـات لاسـتـخـدام هـذا الـامـر__**', flags: 64 });
        }

        const duration = interaction.options.getString('duration');
        const roomId = interaction.options.getString('room');
        const since = getTimeLimit(duration);

        const deletions = db.get('deletions')
            .filter(d =>
                (!roomId || d.channelId === roomId) &&
                new Date(d.timestamp) >= since
            )
            .value();
        if (deletions.length === 0) {
            return interaction.reply({ content: '**__ لــا يــوجــد عــمــلــيــات حــذف خــلال فــتــرة تــم اخــتــيــارهــا __**', flags: 64 });
        }

        let desc = '';
        for (const del of deletions) {
            desc += `**__ الـروم : <#${del.channelId}> __**\n`;
            desc += `**__ مـسـؤول عـن الـحـذف : <@${del.deletedBy}> <a:pointright:1395414445022380082> __**\n`;
            desc += `**__ الــســبــب: ${del.reason} __**\n`;
            desc += `**__ <t:${Math.floor(new Date(del.timestamp).getTime() / 1000)}:F> __**\n`;
            desc += `**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**\n\n`;
        }

        const embedReport = new EmbedBuilder()
            .setTitle(' ســجــل حــذ ف مــنــشــورات ')
            .setColor(0xFFA500) // لون برتقالي
            .setDescription(desc)
            .setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&')
            .setTimestamp();

        await interaction.reply({ embeds: [embedReport] });
    }
    else if (command === 'help') {
        const getRoleMentions = (commandName) => {
            const roleObjs = rules[commandName] || [];
            return roleObjs.map(r => `<@&${r.id}>`).join(', ');
        };

        const embed = new EmbedBuilder()
            .setTitle(' 𝗛𝗘𝗟𝗣 𝗠𝗘𝗡𝗨 • قائمة المساعدة ')
            .setColor('#00FFFF')
            .setDescription(`
**<a:ezgif4aa2ec402b1c43:1393268691142971492>  /post**  **
*Auto content publishing to specific channels*
نـشـر هـنـتـاي تـلـقـائـيًـا فـي الـروم الـمـحـدد  **
**__Permissions:__** ${getRoleMentions('POST')} <:1373132543586603149:1393268672411336816> 

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━** **

**<a:ezgif4aa2ec402b1c43:1393268691142971492>  /info**  
*View posting statistics per room and user*  
** عـرض إيـحـصـائـيـات الـنـشـر و مـعـلـومـات روم  **
**__Permissions:__** ${getRoleMentions('INFO')} :<:1373132543586603149:1393268672411336816> 

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**<a:ezgif4aa2ec402b1c43:1393268691142971492>  /reset
*Delete posting history from a channel or all*  
حـذف سـجـل الـنـشـر مـن روم أَو كـل الـرومـات  ** 
**__Permissions:__** ${getRoleMentions('RESET')}<:1373132543586603149:1393268672411336816>  

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━** **

<a:ezgif4aa2ec402b1c43:1393268691142971492>  /reset_log
*View deleted post log history per room*  
عـرض عـمـلـيـات حـذف سـجـل سـابـقـة لـلـرومـات  **
**__Permissions:__** ${getRoleMentions('RESET_LOG')} <:1373132543586603149:1393268672411336816> 

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**<a:ezgif4aa2ec402b1c43:1393268691142971492>  /help**  **
*Show this help menu with command details*  <a:ezgif4b7fd2cb5f9395:1393268658322804887>  
عـرض قـائـمـة الأوامـر و الـمـسـاعـدة <a:ezgif4b7fd2cb5f9395:1393268658322804887>   **
**__Permissions:__** ** Everyone <a:ezgif4ad78639bbc8ec:1393268641729875998>  **

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**
<a:pointright:1395414445022380082> 𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃 
*Access the full web control panel for rooms, tags, and banned tags*
لـتـسـهـيـل الـتـحـكـم بـالـرومـات و الـتـاغـات و الـتـاغـات الـمـحـظـورة
** **
__Permissions: <@&1370967566343995454> | 𝐀𝐃𝐌𝐈𝐍𝐈 𝐒𝐓𝐑𝐀𝐓𝐎𝐑 __** <a:ezgif4da5ac07bb71e6:1393268629163999322> 
**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
`);

        embed.setImage('https://cdn.discordapp.com/attachments/1395691992725590037/1395821046908715028/banner_2.2.png?ex=687bd726&is=687a85a6&hm=372533a8545693d423f53a33fa9f68fa5ea560229c49403113bc85986a6a75c9&');

        await interaction.reply({
            embeds: [embed],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            label: '  𝐃𝐄𝐕𝐄𝐋𝐎𝐏𝐄𝐑',
                            style: 5,
                            emoji: {
                                name: 'ezgif4da5ac07bb71e6',
                                id: '1393268629163999322',
                                animated: true
                            },
                            url: 'https://discord.com/users/1324828948843991200'
                        },
                        {
                            type: 2,
                            label: '𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃  ',
                            style: 5,
                            emoji: {
                                name: '1368646409615577128',
                                id: '1393268613141495808',
                                animated: false
                            },
                            url: 'http://prem-eu2.bot-hosting.net:20672/'
                        }
                    ]
                }
            ],
            ephemeral: false
        });
    }

});

module.exports = client;
