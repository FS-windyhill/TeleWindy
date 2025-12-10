/**
 * TeleWindy Core Logic - Refactored (v2.0)
 * 包含：核心对话、Gist云备份、日夜模式、文件导入导出
 */

// =========================================
// 1. CONFIG & STATE (配置与状态)
// =========================================

const CONFIG = {
    STORAGE_KEY: 'teleWindy_char_data_v1',
    SETTINGS_KEY: 'teleWindy_settings_v1', 
    GIST_ID_KEY: 'telewindy-gist-id',      // 专门存 Gist ID 的 Key
    DEFAULT: {
        API_URL: 'https://api.siliconflow.cn/v1/chat/completions',
        MODEL: 'zai-org/GLM-4.6',
        API_KEY: '', 
        WALLPAPER: 'wallpaper.jpg',
        USER_AVATAR: 'user.jpg',
        GIST_TOKEN: '',
        THEME: 'light' // ★★★ 新增：默认日间模式
    },
    SYSTEM_PROMPT: `
请完全代入角色设定，以该角色的语气和思考方式，与用户交流。
这里是线上聊天。
每次输出3~9句话左右，每两句话中间空一行。自由回答，不必拘束。
<think>
沉入世界，顺其自然。因此，不再需要前置思考了。
</think>
`
};

// 运行时状态
const STATE = {
    contacts: [],
    currentContactId: null,
    settings: {}, 
    isTyping: false
};

// =========================================
// 2. STORAGE SERVICE (本地持久化)
// =========================================
const Storage = {
    load() {
        // 1. 加载设置
        const settingsRaw = localStorage.getItem(CONFIG.SETTINGS_KEY);
        let loadedSettings = settingsRaw ? JSON.parse(settingsRaw) : {};

        // 兼容旧版散装存储的 Theme (如果有)
        const legacyTheme = localStorage.getItem('appTheme');
        if (legacyTheme) {
            loadedSettings.THEME = legacyTheme;
            localStorage.removeItem('appTheme'); // 迁移后删除旧key
        }

        // 合并默认值
        STATE.settings = { ...CONFIG.DEFAULT, ...loadedSettings };

        // 兼容旧的散装头像壁纸
        if (!settingsRaw) {
            const oldUserAvatar = localStorage.getItem('fs_user_avatar');
            const oldWallpaper = localStorage.getItem('fs_wallpaper');
            if (oldUserAvatar) STATE.settings.USER_AVATAR = oldUserAvatar;
            if (oldWallpaper) STATE.settings.WALLPAPER = oldWallpaper;
        }

        // 2. 加载联系人
        const contactsRaw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (contactsRaw) {
            STATE.contacts = JSON.parse(contactsRaw);
        }

        // 兜底：如果没有联系人
        if (STATE.contacts.length === 0) {
            STATE.contacts.push({
                id: Date.now().toString(),
                name: '小真蛸',
                avatar: '😊',
                prompt: '你是一个温柔可爱的助手小真蛸，说话请带上颜文字。',
                history: []
            });
        }
    },

    saveContacts() {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STATE.contacts));
    },

    saveSettings() {
        localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(STATE.settings));
    },
    
    // 获取用于备份的所有数据
    exportAllForBackup() {
        const data = {};
        // 遍历所有 LocalStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            
            // 特殊处理设置中的 Token 加密
            if (key === CONFIG.SETTINGS_KEY) {
                try {
                    const settings = JSON.parse(value);
                    if (settings.GIST_TOKEN && !settings.GIST_TOKEN.startsWith('ENC_')) {
                        const safeSettings = { ...settings };
                        safeSettings.GIST_TOKEN = 'ENC_' + btoa(safeSettings.GIST_TOKEN);
                        data[key] = JSON.stringify(safeSettings);
                    } else {
                        data[key] = value;
                    }
                } catch (e) { data[key] = value; }
            } else {
                data[key] = value;
            }
        }
        return data;
    },

    // 恢复备份数据
    importFromBackup(data) {
        localStorage.clear();
        Object.keys(data).forEach(key => {
            let value = data[key];
            // 特殊处理设置中的 Token 解密
            if (key === CONFIG.SETTINGS_KEY) {
                try {
                    const settings = JSON.parse(value);
                    if (settings.GIST_TOKEN && settings.GIST_TOKEN.startsWith('ENC_')) {
                        settings.GIST_TOKEN = atob(settings.GIST_TOKEN.replace('ENC_', ''));
                        value = JSON.stringify(settings);
                    }
                } catch (e) { console.error('Token decrypt failed', e); }
            }
            localStorage.setItem(key, value);
        });
    }
};

// =========================================
// 3. API SERVICE (LLM通信)
// =========================================
const API = {
    getProvider(url) {
        if (url.includes('anthropic')) return 'claude';
        if (url.includes('googleapis')) return 'gemini';
        return 'openai'; 
    },

    async fetchModels(url, key) {
        const modelsUrl = url.replace(/\/chat\/completions$/, '/models');
        const res = await fetch(modelsUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}` }
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        return await res.json();
    },

    async chat(messages, settings) {
        const { API_URL, API_KEY, MODEL } = settings;
        const provider = this.getProvider(API_URL);
        
        let fetchUrl = API_URL;
        let options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
        const sysPrompts = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');

        // 构建请求体
        if (provider === 'claude') {
            options.headers['x-api-key'] = API_KEY;
            options.headers['anthropic-version'] = '2023-06-01';
            options.body = JSON.stringify({
                model: MODEL,
                system: sysPrompts,
                messages: [{ role: "user", content: lastUserMsg }],
                max_tokens: 4096,
                temperature: 1.1
            });
        } else if (provider === 'gemini') {
            fetchUrl = API_URL.endsWith(':generateContent') ? API_URL : `${API_URL}/${MODEL}:generateContent?key=${API_KEY}`;
            options.body = JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: lastUserMsg }] }],
                system_instruction: { parts: [{ text: sysPrompts }] },
                generationConfig: { temperature: 1.1, maxOutputTokens: 4096 }
            });
        } else {
            // OpenAI Standard
            options.headers['Authorization'] = `Bearer ${API_KEY}`;
            options.body = JSON.stringify({
                model: MODEL,
                messages: messages,
                temperature: 1.1,
                max_tokens: 4096
            });
        }

        console.log(`[${provider}] Sending...`, JSON.parse(options.body));

        const response = await fetch(fetchUrl, options);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error ${response.status}: ${errText}`);
        }
        
        const data = await response.json();
        
        if (provider === 'claude') return data.content[0].text.trim();
        if (provider === 'gemini') return data.candidates[0].content.parts[0].text.trim();
        return data.choices[0].message.content.trim();
    }
};

// =========================================
// 4. CLOUD SYNC (Gist 同步服务)
// =========================================
const CloudSync = {
    // UI 引用
    els: {
        token: document.getElementById('gist-token'),
        idInput: document.getElementById('gist-id-input'),
        status: document.getElementById('gist-status')
    },

    init() {
        const savedId = localStorage.getItem(CONFIG.GIST_ID_KEY);
        if (savedId) {
            this.els.idInput.value = savedId;
            this.showStatus(`本地加载 Gist ID: ${savedId.slice(0, 6)}...`, false);
        }
    },

    showStatus(msg, isError = false) {
        this.els.status.textContent = msg;
        this.els.status.style.color = isError ? '#d32f2f' : '#2e7d32';
    },

    getToken() {
        const token = STATE.settings.GIST_TOKEN;
        if (!token) {
            this.showStatus('请先在上方设置并保存 Token', true);
            return null;
        }
        return token;
    },

    updateGistId(newId) {
        if (newId && typeof newId === 'string' && newId.trim() !== '') {
            const cleanId = newId.trim();
            this.els.idInput.value = cleanId;
            localStorage.setItem(CONFIG.GIST_ID_KEY, cleanId);
            return cleanId;
        }
        return null;
    },

    async findBackup() {
        const token = this.getToken();
        if (!token) return;

        this.showStatus('正在云端查找...');
        try {
            const res = await fetch('https://api.github.com/gists', {
                headers: { Authorization: `token ${token}` }
            });
            if (!res.ok) throw new Error(`查找失败 (${res.status})`);

            const gists = await res.json();
            const backup = gists.find(g => g.description === "TeleWindy 聊天记录与配置自动备份");

            if (backup) {
                this.updateGistId(backup.id);
                this.showStatus(`找到备份！ID: ${backup.id.slice(0, 8)}...`);
            } else {
                this.showStatus('未找到匹配的 TeleWindy 备份', true);
            }
        } catch (e) {
            this.showStatus(e.message, true);
        }
    },

    async createBackup() {
        const token = this.getToken();
        if (!token) return;

        this.showStatus('正在创建并备份...');
        const allData = Storage.exportAllForBackup();
        const payload = {
            description: "TeleWindy 聊天记录与配置自动备份", 
            public: false,
            files: { "telewindy-backup.json": { content: JSON.stringify({ 
                backup_at: new Date().toISOString(), 
                app: "TeleWindy", 
                data: allData 
            }, null, 2) } }
        };

        try {
            const res = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const json = await res.json();
                this.updateGistId(json.id);
                this.showStatus(`创建成功！ID: ${json.id}`);
            } else {
                throw new Error('创建失败');
            }
        } catch (e) {
            this.showStatus(e.message, true);
        }
    },

    async updateBackup() {
        const token = this.getToken();
        const gistId = this.els.idInput.value.trim();
        if (!token || !gistId) return this.showStatus('缺少 Token 或 Gist ID', true);

        this.showStatus('正在同步更新...');
        const allData = Storage.exportAllForBackup();
        const payload = { files: { "telewindy-backup.json": { content: JSON.stringify({ 
            backup_at: new Date().toISOString(), 
            app: "TeleWindy", 
            data: allData 
        }, null, 2) } } };

        try {
            const res = await fetch(`https://api.github.com/gists/${gistId}`, { 
                method: 'PATCH',
                headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                this.showStatus('备份更新成功！' + new Date().toLocaleTimeString());
            } else if (res.status === 404) {
                localStorage.removeItem(CONFIG.GIST_ID_KEY);
                this.showStatus('ID失效，请重新创建', true);
            } else {
                throw new Error('更新失败');
            }
        } catch (e) {
            this.showStatus(e.message, true);
        }
    },

    async restoreBackup() {
        const token = this.getToken();
        const gistId = this.els.idInput.value.trim();
        if (!token || !gistId) return this.showStatus('缺少 Token 或 Gist ID', true);

        this.showStatus('正在拉取恢复...');
        try {
            const res = await fetch(`https://api.github.com/gists/${gistId}`, { 
                headers: { Authorization: `token ${token}` }
            });
            if (!res.ok) throw new Error('获取失败');

            const json = await res.json();
            const file = json.files['telewindy-backup.json'];
            if (!file) throw new Error('文件不存在');

            let content = file.content;
            if (file.truncated) {
                const rawRes = await fetch(file.raw_url);
                content = await rawRes.text();
            }

            // 修复可能存在的控制字符
            const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
            const backupData = JSON.parse(cleaned);

            if (backupData && backupData.data) {
                Storage.importFromBackup(backupData.data);
                this.showStatus('恢复成功！即将刷新...');
                setTimeout(() => location.reload(), 2000);
            }
        } catch (e) {
            this.showStatus('恢复出错: ' + e.message, true);
        }
    }
};

// =========================================
// 5. UI RENDERER (DOM 操作)
// =========================================
const UI = {
    // 缓存常用 DOM
    els: {
        viewList: document.getElementById('view-contact-list'),
        viewChat: document.getElementById('view-chat'),
        contactContainer: document.getElementById('contact-list-container'),
        chatMsgs: document.getElementById('chat-messages'),
        chatTitle: document.getElementById('chat-title'),
        status: document.getElementById('typing-status'),
        input: document.getElementById('task-input'),
        sendBtn: document.getElementById('send-button'),
        rerollBtn: document.getElementById('reroll-footer-btn'),
        modalOverlay: document.getElementById('modal-overlay'),
        mainModal: document.getElementById('main-modal'), 
        
        // Settings Inputs
        settingUrl: document.getElementById('custom-api-url'),
        settingKey: document.getElementById('custom-api-key'),
        settingModel: document.getElementById('custom-model-select'),
        fetchBtn: document.getElementById('fetch-models-btn'),
        themeLight: document.getElementById('theme-light'),
        themeDark: document.getElementById('theme-dark')
    },

    init() {
        this.applyAppearance();
        this.renderContacts();
        CloudSync.init(); // 初始化云同步 ID 显示
    },

    // ★★★ 统一管理外观 (壁纸 + 日夜模式) ★★★
    applyAppearance() {
        const { WALLPAPER, THEME } = STATE.settings;
        
        // 1. 设置壁纸
        document.body.style.backgroundImage = `url('${WALLPAPER}')`;
        // 如果是默认壁纸且是日间模式，给个浅灰底色
        if (WALLPAPER === 'wallpaper.jpg' && THEME !== 'dark') {
            document.body.style.backgroundColor = '#f2f2f2';
        }

        // 2. 设置日夜模式 Class
        if (THEME === 'dark') {
            document.body.classList.add('dark-mode');
            if(this.els.themeDark) this.els.themeDark.checked = true;
        } else {
            document.body.classList.remove('dark-mode');
            if(this.els.themeLight) this.els.themeLight.checked = true;
        }
    },

    toggleTheme(newTheme) {
        STATE.settings.THEME = newTheme;
        Storage.saveSettings();
        this.applyAppearance();
    },

    switchView(viewName) {
        if (viewName === 'chat') {
            this.els.viewList.classList.add('hidden');
            this.els.viewChat.classList.remove('hidden');
        } else {
            this.els.viewChat.classList.add('hidden');
            this.els.viewList.classList.remove('hidden');
            STATE.currentContactId = null;
            this.renderContacts(); 
        }
    },

    renderContacts() {
        this.els.contactContainer.innerHTML = '';
        STATE.contacts.forEach(c => {
            const item = document.createElement('div');
            item.className = 'contact-item';
            
            // 头像处理
            let avatarHtml = `<div class="contact-avatar">${c.avatar || '🌼'}</div>`;
            if (c.avatar.startsWith('data:') || c.avatar.startsWith('http')) {
                avatarHtml = `<img src="${c.avatar}" class="contact-avatar" onerror="this.style.display='none'">`;
            }

            // 预览消息
            let lastMsg = "暂无消息";
            const validMsgs = c.history.filter(m => m.role !== 'system');
            if (validMsgs.length > 0) {
                const content = validMsgs[validMsgs.length - 1].content;
                lastMsg = content.length > 30 ? content.slice(0, 30) + '…' : content;
            }

            item.innerHTML = `
                ${avatarHtml}
                <div class="contact-info">
                    <h3>${c.name}</h3>
                    <p>${lastMsg}</p>
                </div>
            `;
            item.onclick = () => App.enterChat(c.id);
            this.els.contactContainer.appendChild(item);
        });
    },

    renderChatHistory(contact) {
        this.els.chatMsgs.innerHTML = '';
        this.els.chatTitle.innerText = contact.name;
        
        contact.history.forEach(msg => {
            if (msg.role === 'system') return;
            const sender = msg.role === 'assistant' ? 'ai' : 'user';

            const cleanText = typeof msg === 'string' ? msg : msg.content || '';
            const msgTime = typeof msg === 'string' ? null : msg.timestamp;
            
            // 分段渲染逻辑
            const paragraphs = cleanText.split(/\n\s*\n/).filter(p => p.trim());
            if (paragraphs.length > 0) {
                paragraphs.forEach(p => this.appendMessageBubble(p.trim(), sender, contact.avatar, msgTime));
            } else if (cleanText.trim()) {
                this.appendMessageBubble(cleanText.trim(), sender, contact.avatar, msgTime);
            }
        });

        this.scrollToBottom();
        this.updateRerollState(contact);
    },

    removeLatestAiBubbles() {
        const container = this.els.chatMsgs;
        while (container.lastElementChild && container.lastElementChild.classList.contains('ai')) {
            container.removeChild(container.lastElementChild);
        }
    },

    appendMessageBubble(text, sender, aiAvatarUrl, timestampRaw) {
        const template = document.getElementById('msg-template');
        const clone = template.content.cloneNode(true);
        
        const wrapper = clone.querySelector('.message-wrapper');
        const bubble = clone.querySelector('.message-bubble');
        const timeSpan = clone.querySelector('.msg-time');
        const avatarImg = clone.querySelector('.avatar-img');
        const avatarText = clone.querySelector('.avatar-text');

        wrapper.classList.add(sender);
        bubble.innerText = text;

        let timeStr = "";
        if (timestampRaw && timestampRaw.includes(' ')) {
            timeStr = timestampRaw.split(' ')[1]; 
        } else {
            const n = new Date();
            timeStr = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
        }
        timeSpan.innerText = timeStr;

        let currentAvatar = '';
        if (sender === 'user') {
            currentAvatar = STATE.settings.USER_AVATAR || 'user.jpg';
        } else {
            currentAvatar = aiAvatarUrl || '🌸';
        }

        const isImage = currentAvatar.startsWith('http') || currentAvatar.startsWith('data:');

        if (isImage) {
            avatarImg.src = currentAvatar;
            avatarImg.onerror = () => { avatarImg.style.display='none'; avatarText.style.display='flex'; avatarText.innerText='?'; };
            avatarText.style.display = 'none';
        } else {
            avatarImg.style.display = 'none';
            avatarText.style.display = 'flex'; 
            avatarText.innerText = currentAvatar;
        }

        this.els.chatMsgs.appendChild(clone);
        this.scrollToBottom();
    },

    scrollToBottom() {
        this.els.chatMsgs.parentElement.scrollTop = this.els.chatMsgs.parentElement.scrollHeight;
    },

    setLoading(isLoading) {
        STATE.isTyping = isLoading;
        this.els.sendBtn.disabled = isLoading;
        if (isLoading) {
            this.els.status.innerText = '对方正在输入';
            this.els.status.classList.add('typing');
        } else {
            this.els.status.innerText = '在线';
            this.els.status.classList.remove('typing');
        }
    },

    updateRerollState(contact) {
        const hasHistory = contact.history.some(m => m.role === 'assistant');
        this.els.rerollBtn.style.opacity = hasHistory ? '1' : '0.5';
        this.els.rerollBtn.disabled = !hasHistory;
    },

    async playWaterfall(fullText, avatar, timestamp) {
        const paragraphs = fullText.split(/\n\s*\n/).filter(p => p.trim());
        for (let i = 0; i < paragraphs.length; i++) {
            if (i > 0) await new Promise(r => setTimeout(r, 400));
            this.appendMessageBubble(paragraphs[i], 'ai', avatar, timestamp);
        }
    }
};

// =========================================
// 6. APP CONTROLLER (业务逻辑)
// =========================================
const App = {
    init() {
        Storage.load();
        UI.init();
        this.bindEvents();
    },

    enterChat(id) {
        const contact = STATE.contacts.find(c => c.id === id);
        if (!contact) return;
        STATE.currentContactId = id;
        UI.switchView('chat');
        UI.renderChatHistory(contact);
    },

    async handleSend(isReroll = false) {
        const contact = STATE.contacts.find(c => c.id === STATE.currentContactId);
        if (!contact) return;
        
        const { API_URL, API_KEY, MODEL } = STATE.settings;
        if (!API_URL || !API_KEY || !MODEL) {
            alert('请先点击右上角的设置按钮，配置 API 地址、密钥和模型！');
            return;
        }

        let userText = UI.els.input.value.trim();
        const timestamp = formatTimestamp();

        // 历史记录处理
        const sysMsg = { role: 'system', content: contact.prompt };
        if (contact.history.length === 0 || contact.history[0].role !== 'system') {
            contact.history.unshift(sysMsg);
        } else {
            contact.history[0] = sysMsg; 
        }

        if (isReroll) {
            const lastUserMsg = [...contact.history].reverse().find(m => m.role === 'user');
            if (!lastUserMsg) return;
            userText = lastUserMsg.content;
            
            while(contact.history.length > 0 && contact.history[contact.history.length-1].role === 'assistant') {
                contact.history.pop();
            }
            UI.removeLatestAiBubbles(); 
        } else {
            if (!userText) return;
            
            const paragraphs = userText.split(/\n\s*\n/).filter(p => p.trim());
            if (paragraphs.length > 0) {
                paragraphs.forEach(p => UI.appendMessageBubble(p.trim(), 'user', null, timestamp));
            } else {
                UI.appendMessageBubble(userText, 'user', null, timestamp);
            }

            contact.history.push({ 
                role: 'user', 
                content: userText,
                timestamp: timestamp 
            });
            
            UI.els.input.value = '';            
            UI.els.input.style.height = '38px'; 
            
            const isMobile = window.innerWidth < 800;
            if (isMobile) UI.els.input.blur();
            else UI.els.input.focus(); 
        }        

        Storage.saveContacts();
        UI.setLoading(true);

        const recentHistory = contact.history
            .filter(m => m.role !== 'system')
            .slice(-30)
            .map(msg => {
                let content = msg.content || msg;
                if (msg.role === 'user') {
                    let time = msg.timestamp || formatTimestamp(); 
                    return { role: 'user', content: `[${time}] ${content}` };
                } else {
                    return { role: 'assistant', content: content };
                }
            });
        
        const messagesToSend = [
            { role: 'system', content: CONFIG.SYSTEM_PROMPT }, 
            { role: 'system', content: `=== 角色设定 ===\n${contact.prompt}` },
            ...recentHistory
        ];

        try {
            const aiText = await API.chat(messagesToSend, STATE.settings);
            const aiTimestamp = formatTimestamp();
            contact.history.push({ 
                role: 'assistant', 
                content: aiText,
                timestamp: aiTimestamp
            });
            Storage.saveContacts();
            
            UI.setLoading(false);
            await UI.playWaterfall(aiText, contact.avatar, aiTimestamp)

        } catch (error) {
            console.error(error);
            UI.setLoading(false);
            UI.appendMessageBubble(`(发送失败: ${error.message})`, 'ai', contact.avatar);
        } finally {
            UI.updateRerollState(contact);
            if (window.innerWidth >= 800) UI.els.input.focus();
        }
    },

    openSettings() {
        UI.els.mainModal.classList.remove('hidden');
        const s = STATE.settings;
        UI.els.settingUrl.value = s.API_URL || '';
        UI.els.settingKey.value = s.API_KEY || '';
        UI.els.settingModel.value = s.MODEL || 'zai-org/GLM-4.6';
        document.getElementById('gist-token').value = s.GIST_TOKEN || ''; // 填充 Gist Token
        
        // 填充模型Select
        if (s.MODEL) UI.els.settingModel.innerHTML = `<option value="${s.MODEL}">${s.MODEL}</option>`;
        
        // 预览壁纸
        const previewImg = document.getElementById('wallpaper-preview-img');
        if (s.WALLPAPER && s.WALLPAPER.startsWith('data:')) {
            previewImg.src = s.WALLPAPER;
            document.getElementById('wallpaper-preview').classList.remove('hidden');
        }
    },

    saveSettingsFromUI() {
        let rawUrl = UI.els.settingUrl.value.trim().replace(/\/+$/, '');
        if (!rawUrl.includes('anthropic') && !rawUrl.includes('googleapis')) {
            if (rawUrl.endsWith('/chat/completion')) rawUrl += 's'; 
            else if (!rawUrl.includes('/chat/completions')) {
                rawUrl += rawUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
            }
        }
        
        const s = STATE.settings;
        s.API_URL = rawUrl;
        s.API_KEY = UI.els.settingKey.value.trim();
        s.MODEL = UI.els.settingModel.value;
        s.GIST_TOKEN = document.getElementById('gist-token').value.trim() || ''; 

        // 壁纸逻辑
        const wallpaperPreview = document.getElementById('wallpaper-preview-img').src;
        if(wallpaperPreview && wallpaperPreview.startsWith('data:')) {
            s.WALLPAPER = wallpaperPreview;
        } else if (!s.WALLPAPER) {
            s.WALLPAPER = 'wallpaper.jpg';
        }

        Storage.saveSettings();
        UI.applyAppearance(); // 立即应用（包含日夜模式）
        UI.els.mainModal.classList.add('hidden');
        alert(`设置已保存！\nAPI 地址已自动规范化为：\n${rawUrl}`);
    },

    bindEvents() {
        // --- 输入与发送 ---
        UI.els.input.style.overflowY = 'hidden'; 
        UI.els.input.addEventListener('input', function() {
            this.style.height = 'auto'; 
            this.style.height = (this.scrollHeight) + 'px';
            if (this.value === '') this.style.height = '38px';
        });

        UI.els.sendBtn.onclick = () => this.handleSend(false);
        UI.els.input.onkeydown = (e) => {
            const isMobile = window.innerWidth < 800;
            if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault(); 
                App.handleSend(false);
            }
        };
        UI.els.rerollBtn.onclick = () => this.handleSend(true);
        document.getElementById('back-btn').onclick = () => UI.switchView('list');

        // --- 主设置弹窗 ---
        document.getElementById('main-settings-btn').onclick = () => this.openSettings();
        document.getElementById('main-cancel').onclick = () => UI.els.mainModal.classList.add('hidden');
        document.getElementById('main-confirm').onclick = () => this.saveSettingsFromUI();
        UI.els.fetchBtn.onclick = () => this.fetchModelsForUI();

        // ★★★ 日夜模式切换 ★★★
        if (UI.els.themeLight) {
            UI.els.themeLight.addEventListener('change', () => UI.toggleTheme('light'));
        }
        if (UI.els.themeDark) {
            UI.els.themeDark.addEventListener('change', () => UI.toggleTheme('dark'));
        }

        // --- 壁纸上传 ---
        document.getElementById('wallpaper-file-input').onchange = async (e) => {
            if(e.target.files[0]) {
                const base64 = await this.readFile(e.target.files[0]);
                document.getElementById('wallpaper-preview-img').src = base64;
                document.getElementById('wallpaper-preview').classList.remove('hidden');
            }
        };

        // --- 角色编辑弹窗 ---
        const modal = document.getElementById('modal-overlay');
        document.getElementById('add-contact-btn').onclick = () => this.openEditModal(null);
        document.getElementById('chat-settings-btn').onclick = () => this.openEditModal(STATE.currentContactId);
        document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
        document.getElementById('modal-save').onclick = () => { this.saveContactFromModal(); modal.classList.add('hidden'); };
        
        document.getElementById('modal-delete').onclick = () => {
             if (confirm('删除角色？')) {
                 STATE.contacts = STATE.contacts.filter(c => c.id !== this.editingId);
                 Storage.saveContacts();
                 modal.classList.add('hidden');
                 if(STATE.currentContactId === this.editingId) document.getElementById('back-btn').click();
                 else UI.renderContacts();
             }
        };
        document.getElementById('modal-clear-history').onclick = () => {
            if(confirm('清空聊天记录？')) {
                const c = STATE.contacts.find(x => x.id === this.editingId);
                if(c) { c.history = []; Storage.saveContacts(); }
                modal.classList.add('hidden');
                if(STATE.currentContactId === this.editingId) UI.renderChatHistory(c);
            }
        };

        // --- 头像上传 ---
        this.bindImageUpload('edit-avatar-file', 'edit-avatar-preview', 'edit-avatar'); 
        this.bindImageUpload('user-avatar-file', 'user-avatar-preview', null, (base64) => {
            STATE.settings.USER_AVATAR = base64;
            Storage.saveSettings();
            if(STATE.currentContactId) {
                const c = STATE.contacts.find(x => x.id === STATE.currentContactId);
                if(c) UI.renderChatHistory(c);
            }
        });
        document.getElementById('edit-avatar-upload-btn').onclick = () => document.getElementById('edit-avatar-file').click();
        document.getElementById('user-avatar-upload-btn').onclick = () => document.getElementById('user-avatar-file').click();

        // --- ★★★ Cloud Sync (Gist) 事件绑定 ★★★ ---
        document.getElementById('gist-find').onclick = () => CloudSync.findBackup();
        document.getElementById('gist-create-and-backup').onclick = () => CloudSync.createBackup();
        document.getElementById('gist-backup').onclick = () => CloudSync.updateBackup();
        document.getElementById('gist-restore').onclick = () => CloudSync.restoreBackup();
        document.getElementById('gist-id-input').onchange = (e) => CloudSync.updateGistId(e.target.value);
    },

    // 辅助：读取文件转Base64
    readFile(file) {
        return new Promise((r, j) => {
            const reader = new FileReader();
            reader.onload = e => r(e.target.result);
            reader.onerror = j;
            reader.readAsDataURL(file);
        });
    },

    // 辅助：拉取模型列表逻辑
    async fetchModelsForUI() {
        const url = UI.els.settingUrl.value.trim();
        const key = UI.els.settingKey.value.trim();
        if(!url || !key) return alert('请先填写地址和密钥');
        const btn = UI.els.fetchBtn;
        btn.textContent = '获取中...';
        btn.disabled = true;
        try {
            const data = await API.fetchModels(url, key);
            const datalist = document.getElementById('model-options');
            datalist.innerHTML = '';
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    datalist.appendChild(opt);
                });
                if (data.data.length > 0) {
                    UI.els.settingModel.value = data.data[0].id;
                    // 这里不直接存STATE，等用户点保存
                }
                alert(`成功拉取 ${data.data.length} 个模型！`);
            } else {
                alert('连接成功，但对方没有返回有效的模型列表。');
            }
        } catch (e) {
            console.error(e);
            alert('拉取失败，请手动输入模型名。');
        } finally {
            btn.textContent = '拉取模型';
            btn.disabled = false;
        }
    },

    // 辅助：图片上传绑定
    bindImageUpload(inputId, imgId, inputUrlId, callback) {
        const el = document.getElementById(inputId);
        if(!el) return;
        el.onchange = async (e) => {
            if(e.target.files[0]) {
                const base64 = await this.readFile(e.target.files[0]);
                document.getElementById(imgId).src = base64;
                if(inputUrlId) document.getElementById(inputUrlId).value = base64;
                if(callback) callback(base64);
            }
        };
    },
    
    // 辅助：角色弹窗
    openEditModal(id) {
        this.editingId = id;
        const modal = document.getElementById('modal-overlay');
        modal.classList.remove('hidden');
        const title = document.getElementById('modal-title');
        const iName = document.getElementById('edit-name');
        const iAvatar = document.getElementById('edit-avatar');
        const iPrompt = document.getElementById('edit-prompt');
        const preview = document.getElementById('edit-avatar-preview');
        const userPreview = document.getElementById('user-avatar-preview');
        userPreview.src = STATE.settings.USER_AVATAR || 'user.jpg';

        if (id) {
            const c = STATE.contacts.find(x => x.id === id);
            title.innerText = '编辑角色';
            iName.value = c.name;
            iAvatar.value = c.avatar;
            iPrompt.value = c.prompt;
            preview.src = (c.avatar.startsWith('data:') || c.avatar.startsWith('http')) ? c.avatar : '';
            document.getElementById('modal-delete').style.display = 'block';
            document.getElementById('modal-clear-history').style.display = 'block';
        } else {
            title.innerText = '新建角色';
            iName.value = '';
            iAvatar.value = '🙂';
            iPrompt.value = '你是一个...';
            preview.src = '';
            document.getElementById('modal-delete').style.display = 'none';
            document.getElementById('modal-clear-history').style.display = 'none';
        }
    },

    saveContactFromModal() {
        const name = document.getElementById('edit-name').value.trim() || '未命名';
        let avatar = document.getElementById('edit-avatar').value.trim();
        const prompt = document.getElementById('edit-prompt').value.trim();
        const previewSrc = document.getElementById('edit-avatar-preview').src;
        if(previewSrc.startsWith('data:')) avatar = previewSrc;

        if (this.editingId) {
            const c = STATE.contacts.find(x => x.id === this.editingId);
            if (c) { c.name = name; c.avatar = avatar; c.prompt = prompt; }
        } else {
            STATE.contacts.push({ id: Date.now().toString(), name, avatar, prompt, history: [] });
        }
        Storage.saveContacts();
        UI.renderContacts();
        if (STATE.currentContactId === this.editingId) {
            document.getElementById('chat-title').innerText = name;
            const c = STATE.contacts.find(x => x.id === this.editingId);
            UI.renderChatHistory(c);
        }
    }
};

// =========================================
// 7. UTILS & EXPORTS (工具与启动)
// =========================================
function formatTimestamp() {
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[now.getMonth()]}.${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// 供HTML按钮直接调用的文件导入导出（保留全局暴露）
window.exportData = () => {
    const data = JSON.stringify(Storage.exportAllForBackup(), null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    a.download = `TeleWindy-Backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url); 
};

window.importData = (input) => {
    if (!input.files || !input.files[0]) return;
    if (!confirm('导入将覆盖当前所有设置，确定吗？')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            Storage.importFromBackup(data);
            alert('导入成功，页面将刷新');
            location.reload();
        } catch(err) { alert('文件格式错误'); }
    };
    reader.readAsText(input.files[0]);
};

// 启动应用
window.onload = () => App.init();


// 小工具
// 便签

// 设置中心左侧目录切换
document.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', () => {
        const target = item.dataset.target;

        // 切换 active 类
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(target).classList.add('active');
    });
});


