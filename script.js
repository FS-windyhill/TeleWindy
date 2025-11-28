// --- 配置区 ---
const API_KEY = 'sk-zjrwnikmirbgzteakyyrqtlwmkglwpapqcgpmgjbyupxhwzd';
const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL = "zai-org/GLM-4.6"; 

const STORAGE_KEY = 'fs_multi_char_data_v1';
const OLD_STORAGE_KEY = 'octopus_coach_chat_history'; // 用来读取你旧版的数据

// --- 全局变量 ---
let contacts = [];           // 存放所有角色
let currentContactId = null; // 当前正在聊天的 ID

// --- DOM 元素 ---
const viewList = document.getElementById('view-contact-list');
const viewChat = document.getElementById('view-chat');
const contactListContainer = document.getElementById('contact-list-container');
const chatWindow = document.getElementById('chat-window');
const chatMessages = document.getElementById('chat-messages');
const chatTitle = document.getElementById('chat-title');
const taskInput = document.getElementById('task-input');
const sendButton = document.getElementById('send-button');
const rerollBtn = document.getElementById('reroll-footer-btn');

// 弹窗元素
const modalOverlay = document.getElementById('modal-overlay');
const inputName = document.getElementById('edit-name');
const inputAvatar = document.getElementById('edit-avatar');
const inputPrompt = document.getElementById('edit-prompt');
let editingId = null; // null 表示新建模式

// ===========================
// 1. 初始化与数据迁移
// ===========================
function init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        contacts = JSON.parse(raw);
    } else {
        // --- 核心：迁移旧数据 ---
        const oldData = localStorage.getItem(OLD_STORAGE_KEY);
        if (oldData) {
            console.log('检测到旧版数据，正在迁移...');
            try {
                const history = JSON.parse(oldData);
                // 提取旧的历史作为第一个联系人
                contacts.push({
                    id: 'legacy_' + Date.now(),
                    name: '小真蛸 (旧版)',
                    avatar: '🦑',
                    prompt: '你是一个温柔可爱的助手小真蛸，说话请带上“🦑”。',
                    history: history
                });
                localStorage.removeItem(OLD_STORAGE_KEY); // 迁移完删除旧key
            } catch (e) { console.error('迁移失败', e); }
        }
    }

    // 如果完全是空的（新用户），给一个默认角色
    if (contacts.length === 0) {
        contacts.push({
            id: Date.now().toString(),
            name: '小真蛸',
            avatar: '🦑',
            prompt: '你是一个温柔可爱的助手小真蛸，说话请带上“🦑”及颜文字。',
            history: [] // 初始历史为空，发送时会自动拼装 system prompt
        });
    }

    saveData();
    renderContactList();
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

// ===========================
// 2. 视图渲染
// ===========================

// 渲染通讯录
function renderContactList() {
    contactListContainer.innerHTML = '';
    
    // 按最后聊天时间排序（可选），这里暂时按创建顺序
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'contact-item';
        
        // 处理头像显示
        let avatarHtml = '';
        if (contact.avatar.startsWith('http')) {
            avatarHtml = `<img src="${contact.avatar}" class="contact-avatar">`;
        } else {
            avatarHtml = `<div class="contact-avatar">${contact.avatar}</div>`;
        }

        // 获取最后一条消息预览
        let lastMsg = "暂无消息";
        const realMsgs = contact.history.filter(m => m.role !== 'system');
        if (realMsgs.length > 0) {
            lastMsg = realMsgs[realMsgs.length - 1].content;
        } else {
            lastMsg = contact.prompt; // 没聊天时显示人设预览
        }

        item.innerHTML = `
            ${avatarHtml}
            <div class="contact-info">
                <h3>${contact.name}</h3>
                <p>${lastMsg}</p>
            </div>
        `;

        item.onclick = () => enterChat(contact.id);
        contactListContainer.appendChild(item);
    });
}

// 进入聊天页面
function enterChat(id) {
    currentContactId = id;
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    // 切换视图
    viewList.classList.add('hidden');
    viewChat.classList.remove('hidden');

    // 设置 Header
    chatTitle.innerText = contact.name;
    document.getElementById('typing-status').innerText = '在线';
    document.getElementById('typing-status').classList.remove('typing');

    // 渲染历史记录
    chatMessages.innerHTML = '';
    contact.history.forEach(msg => {
        if (msg.role !== 'system') {
            addMessageToUI(msg.content, msg.role === 'assistant' ? 'ai' : 'user', contact.avatar);
        }
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
    updateRerollButton();
}

// 返回列表
document.getElementById('back-btn').addEventListener('click', () => {
    viewChat.classList.add('hidden');
    viewList.classList.remove('hidden');
    currentContactId = null;
    renderContactList(); // 刷新列表预览
});

// ===========================
// 3. 聊天核心逻辑
// ===========================

function addMessageToUI(text, sender, avatarUrl) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${sender}`;

    let avatarHtml;
    if (sender === 'user') {
        avatarHtml = `<img class="avatar" src="user.jpg" alt="User">`; // 你的头像
    } else {
        if (avatarUrl && avatarUrl.startsWith('http')) {
            avatarHtml = `<img class="avatar" src="${avatarUrl}">`;
        } else {
            avatarHtml = `<div class="avatar" style="background:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;">${avatarUrl}</div>`;
        }
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerText = text;

    content.appendChild(bubble);
    wrapper.innerHTML = avatarHtml;
    wrapper.appendChild(content);

    chatMessages.appendChild(wrapper);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function addAiWaterfallMessage(fullText, avatarUrl) {
    // 简单的打字机模拟，分段显示
    const paragraphs = fullText.split(/\n\s*\n/).filter(p => p.trim());
    for (let i = 0; i < paragraphs.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 400));
        addMessageToUI(paragraphs[i], 'ai', avatarUrl);
    }
}

async function handleSend(isReroll = false) {
    const contact = contacts.find(c => c.id === currentContactId);
    if (!contact) return;

    let userText = taskInput.value.trim();

    // 1. 构造 System Prompt (每次都确保它是历史的第一条)
    // 如果历史为空，或者第一条不是 system，就加进去。
    // 如果已经有 system，就更新它（防止用户修改了人设但没生效）
    const sysMsg = { role: 'system', content: contact.prompt };
    if (contact.history.length === 0 || contact.history[0].role !== 'system') {
        contact.history.unshift(sysMsg);
    } else {
        contact.history[0] = sysMsg;
    }

    // 2. 处理重发逻辑
    if (isReroll) {
        // 找到最后一条 User 消息
        const lastUserMsg = [...contact.history].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return; // 没说过话怎么重发
        userText = lastUserMsg.content;
        
        // 删除 UI 上最后一条 AI 回复
        if (chatMessages.lastElementChild?.classList.contains('ai')) {
            chatMessages.removeChild(chatMessages.lastElementChild);
        }
        // 删除数据里的最后一条 AI 回复
        while(contact.history.length > 0 && contact.history[contact.history.length-1].role === 'assistant') {
            contact.history.pop();
        }
        console.log('✨ 重roll模式启动');
    } else {
        if (!userText) return;
        addMessageToUI(userText, 'user', null); // UI显示
        contact.history.push({ role: 'user', content: userText }); // 存入历史
        taskInput.value = '';
    }
    
    saveData(); // 先存一下用户说的话

    // 3. 发起请求
    sendButton.disabled = true;
    const statusEl = document.getElementById('typing-status');
    statusEl.innerText = '对方正在输入';
    statusEl.classList.add('typing');

    try {
        console.log('📤 发送上下文:', contact.history.slice(-10));
        
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
            body: JSON.stringify({
                model: MODEL,
                messages: contact.history.slice(-20), // 只发最近20条省钱
                temperature: 0.8,
                max_tokens: 1024
            })
        });

        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        const aiText = data.choices[0].message.content.trim();

        contact.history.push({ role: 'assistant', content: aiText });
        saveData();
        
        statusEl.innerText = '在线';
        statusEl.classList.remove('typing');
        
        await addAiWaterfallMessage(aiText, contact.avatar);

    } catch (e) {
        console.error(e);
        statusEl.innerText = '连接中断';
        addMessageToUI('(发送失败，请检查网络或Key)', 'ai', contact.avatar);
    } finally {
        sendButton.disabled = false;
        taskInput.focus();
        updateRerollButton();
    }
}

function updateRerollButton() {
    const contact = contacts.find(c => c.id === currentContactId);
    if (!contact) return;
    const hasHistory = contact.history.some(m => m.role === 'assistant');
    rerollBtn.style.opacity = hasHistory ? '1' : '0.5';
    rerollBtn.disabled = !hasHistory;
}

// ===========================
// 4. 弹窗与角色管理
// ===========================

function openModal(contactId) {
    editingId = contactId;
    modalOverlay.classList.remove('hidden');
    
    const delBtn = document.getElementById('modal-delete');
    const clearBtn = document.getElementById('modal-clear-history');

    if (contactId) {
        // 编辑模式
        const c = contacts.find(x => x.id === contactId);
        document.getElementById('modal-title').innerText = '设置角色';
        inputName.value = c.name;
        inputAvatar.value = c.avatar;
        inputPrompt.value = c.prompt;
        
        delBtn.style.display = 'block';
        clearBtn.style.display = 'block';
    } else {
        // 新建模式
        document.getElementById('modal-title').innerText = '新建角色';
        inputName.value = '';
        inputAvatar.value = '🙂'; // 默认Emoji
        inputPrompt.value = '你是一个乐于助人的助手。';
        
        delBtn.style.display = 'none';
        clearBtn.style.display = 'none';
    }
}

// 保存按钮
document.getElementById('modal-save').addEventListener('click', () => {
    const name = inputName.value.trim() || '未命名';
    const avatar = inputAvatar.value.trim() || '🙂';
    const prompt = inputPrompt.value.trim();

    if (editingId) {
        // 更新现有
        const c = contacts.find(x => x.id === editingId);
        if (c) {
            c.name = name;
            c.avatar = avatar;
            c.prompt = prompt;
            // 实时更新当前聊天界面的标题
            if (currentContactId === editingId) chatTitle.innerText = name;
        }
    } else {
        // 创建新角色
        contacts.push({
            id: Date.now().toString(),
            name: name,
            avatar: avatar,
            prompt: prompt,
            history: []
        });
    }
    
    saveData();
    modalOverlay.classList.add('hidden');
    if (!editingId) renderContactList(); // 如果是新建，刷新列表
});

// 删除按钮
document.getElementById('modal-delete').addEventListener('click', () => {
    if (confirm('确定要删除这个角色吗？聊天记录也会消失。')) {
        contacts = contacts.filter(c => c.id !== editingId);
        saveData();
        modalOverlay.classList.add('hidden');
        
        // 如果删的是当前正在聊的人，退回列表
        if (currentContactId === editingId) {
            document.getElementById('back-btn').click();
        } else {
            renderContactList();
        }
    }
});

// 清空记录按钮
document.getElementById('modal-clear-history').addEventListener('click', () => {
    if (confirm('确定要清空与该角色的聊天记录吗？')) {
        const c = contacts.find(x => x.id === editingId);
        if (c) {
            c.history = []; // 清空
            saveData();
            modalOverlay.classList.add('hidden');
            if (currentContactId === editingId) {
                chatMessages.innerHTML = ''; // 实时清屏
            }
        }
    }
});

// 关闭弹窗
document.getElementById('modal-cancel').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
});

// 事件绑定
document.getElementById('add-contact-btn').addEventListener('click', () => openModal(null));
document.getElementById('chat-settings-btn').addEventListener('click', () => openModal(currentContactId));

sendButton.addEventListener('click', () => handleSend(false));
taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend(false);
});
rerollBtn.addEventListener('click', () => handleSend(true));

// 启动
window.addEventListener('load', init);