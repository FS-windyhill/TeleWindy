// --- 配置区 ---
const API_KEY = 'sk-zjrwnikmirbgzteakyyrqtlwmkglwpapqcgpmgjbyupxhwzd';
const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL = "zai-org/GLM-4.6"; 

// ★★★ 新增：全局系统提示词 (后台隐藏指令) ★★★
const GLOBAL_SYSTEM_PROMPT = `
请完全代入用户给你的角色，以该角色的语气和思考方式，与用户交流。
人类说话是不会带括号和动作描写的。所以你应该的输出应该贴合人类的说话方式，直接输出说话的内容，而不带动作描写。
你想说啥就说啥，不必拘束。
每次输出3~9句话左右，每两句话中间空一行。
`; 
// <--- 这里你可以随意修改你的后台指令

const STORAGE_KEY = 'fs_multi_char_data_v1';
const OLD_STORAGE_KEY = 'octopus_coach_chat_history'; 

// --- 全局变量 ---
let contacts = [];           
let currentContactId = null; 

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

const modalOverlay = document.getElementById('modal-overlay');
const inputName = document.getElementById('edit-name');
const inputAvatar = document.getElementById('edit-avatar');
const inputPrompt = document.getElementById('edit-prompt');
let editingId = null; 

// ===========================
// 1. 初始化与数据迁移 (保持不变)
// ===========================
function init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        contacts = JSON.parse(raw);
    } else {
        const oldData = localStorage.getItem(OLD_STORAGE_KEY);
        if (oldData) {
            console.log('检测到旧版数据，正在迁移...');
            try {
                const history = JSON.parse(oldData);
                contacts.push({
                    id: 'legacy_' + Date.now(),
                    name: '小真蛸 (旧版)',
                    avatar: '🦑',
                    prompt: '你是一个温柔可爱的助手小真蛸，说话请带上“🦑”。',
                    history: history
                });
                localStorage.removeItem(OLD_STORAGE_KEY); 
            } catch (e) { console.error('迁移失败', e); }
        }
    }

    if (contacts.length === 0) {
        contacts.push({
            id: Date.now().toString(),
            name: '小真蛸',
            avatar: '🦑',
            prompt: '你是一个温柔可爱的助手小真蛸，说话请带上“🦑”及颜文字。',
            history: [] 
        });
    }

    saveData();
    renderContactList();
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

// ===========================
// 2. 视图渲染 (保持不变)
// ===========================
function renderContactList() {
    contactListContainer.innerHTML = '';
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'contact-item';
        
        let avatarHtml = '';
        if (contact.avatar.startsWith('http')) {
            avatarHtml = `<img src="${contact.avatar}" class="contact-avatar">`;
        } else {
            avatarHtml = `<div class="contact-avatar">${contact.avatar}</div>`;
        }

        let lastMsg = "暂无消息";
        const realMsgs = contact.history.filter(m => m.role !== 'system');
        if (realMsgs.length > 0) {
            lastMsg = realMsgs[realMsgs.length - 1].content;
        } else {
            lastMsg = contact.prompt; 
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
        if (msg.role === 'system') return; // 跳过系统提示
        
        const sender = msg.role === 'assistant' ? 'ai' : 'user';
        
        // ★★★ 修复核心：这里加了分割逻辑 ★★★
        // 如果内容里有空行（\n\n），就拆分成多个气泡显示，和生成时保持一致
        const paragraphs = msg.content.split(/\n\s*\n/).filter(p => p.trim());
        
        if (paragraphs.length > 0) {
            paragraphs.forEach(p => addMessageToUI(p, sender, contact.avatar));
        } else {
            // 防止极端情况（比如全是空行），至少显示原本的内容
            addMessageToUI(msg.content, sender, contact.avatar);
        }
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
    updateRerollButton();
}

document.getElementById('back-btn').addEventListener('click', () => {
    viewChat.classList.add('hidden');
    viewList.classList.remove('hidden');
    currentContactId = null;
    renderContactList(); 
});

// ===========================
// 3. 聊天核心逻辑 (★ 重点修改区域 ★)
// ===========================

function addMessageToUI(text, sender, avatarUrl) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${sender}`;

    let avatarHtml;
    if (sender === 'user') {
        avatarHtml = `<img class="avatar" src="user.jpg" alt="User">`; 
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

    // 1. 维护历史 (只存纯人设，不存指令，保持数据干净)
    const sysMsg = { role: 'system', content: contact.prompt };
    if (contact.history.length === 0 || contact.history[0].role !== 'system') {
        contact.history.unshift(sysMsg);
    } else {
        contact.history[0] = sysMsg;
    }

    // 2. 重发逻辑 (Reroll)
    if (isReroll) {
        const lastUserMsg = [...contact.history].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return; 
        userText = lastUserMsg.content;
        
        if (chatMessages.lastElementChild?.classList.contains('ai')) {
            chatMessages.removeChild(chatMessages.lastElementChild);
        }
        while(contact.history.length > 0 && contact.history[contact.history.length-1].role === 'assistant') {
            contact.history.pop();
        }
        console.log('✨ 重roll模式启动');
    } else {
        if (!userText) return;
        addMessageToUI(userText, 'user', null); 
        contact.history.push({ role: 'user', content: userText }); 
        taskInput.value = '';
    }
    
    saveData();

    // 3. 准备发送
    sendButton.disabled = true;
    const statusEl = document.getElementById('typing-status');
    statusEl.innerText = '对方正在输入';
    statusEl.classList.add('typing');

    try {
        // ==========================================
        // ★★★ 核心修改：拆分为两条 System 消息 ★★★
        // ==========================================
        
        // 1. 提取聊天记录 (去掉旧的 system，只取最近对话)
        const recentChatHistory = contact.history
            .filter(m => m.role !== 'system') 
            .slice(-20); 

        // 2. 组装最终数组
        // 这里我们把 "全局指令" 和 "角色人设" 作为两条独立的消息发送
        const messagesToSend = [
            // 第一条：系统强制指令 (System Prompt)
            { 
                role: 'system', 
                content: GLOBAL_SYSTEM_PROMPT 
            },
            // 第二条：角色设定 (Character Description)
            // 虽然role还是叫system，但在AI眼里这就是独立的第二段输入
            { 
                role: 'system', 
                content: `=== 角色设定 ===\n${contact.prompt}` 
            },
            // 第三部分：对话历史
            ...recentChatHistory
        ];

        // 打印日志：你会看到现在是一个清晰的数组列表
        console.log('👇👇👇 === 真实发送给AI的完整Prompt (Raw Data) === 👇👇👇');
        console.log(JSON.stringify(messagesToSend, null, 2)); 
        console.log('👆👆👆 ========================================== 👆👆👆');

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
            body: JSON.stringify({
                model: MODEL,
                messages: messagesToSend, 
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
// 4. 弹窗与角色管理 (保持不变)
// ===========================

function openModal(contactId) {
    editingId = contactId;
    modalOverlay.classList.remove('hidden');
    
    const delBtn = document.getElementById('modal-delete');
    const clearBtn = document.getElementById('modal-clear-history');

    if (contactId) {
        const c = contacts.find(x => x.id === contactId);
        document.getElementById('modal-title').innerText = '设置角色';
        inputName.value = c.name;
        inputAvatar.value = c.avatar;
        inputPrompt.value = c.prompt;
        
        delBtn.style.display = 'block';
        clearBtn.style.display = 'block';
    } else {
        document.getElementById('modal-title').innerText = '新建角色';
        inputName.value = '';
        inputAvatar.value = '🙂'; 
        inputPrompt.value = '你是一个乐于助人的助手。';
        
        delBtn.style.display = 'none';
        clearBtn.style.display = 'none';
    }
}

document.getElementById('modal-save').addEventListener('click', () => {
    const name = inputName.value.trim() || '未命名';
    const avatar = inputAvatar.value.trim() || '🙂';
    const prompt = inputPrompt.value.trim();

    if (editingId) {
        const c = contacts.find(x => x.id === editingId);
        if (c) {
            c.name = name;
            c.avatar = avatar;
            c.prompt = prompt;
            if (currentContactId === editingId) chatTitle.innerText = name;
        }
    } else {
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
    if (!editingId) renderContactList(); 
});

document.getElementById('modal-delete').addEventListener('click', () => {
    if (confirm('确定要删除这个角色吗？聊天记录也会消失。')) {
        contacts = contacts.filter(c => c.id !== editingId);
        saveData();
        modalOverlay.classList.add('hidden');
        
        if (currentContactId === editingId) {
            document.getElementById('back-btn').click();
        } else {
            renderContactList();
        }
    }
});

document.getElementById('modal-clear-history').addEventListener('click', () => {
    if (confirm('确定要清空与该角色的聊天记录吗？')) {
        const c = contacts.find(x => x.id === editingId);
        if (c) {
            c.history = []; 
            saveData();
            modalOverlay.classList.add('hidden');
            if (currentContactId === editingId) {
                chatMessages.innerHTML = ''; 
            }
        }
    }
});

document.getElementById('modal-cancel').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
});

document.getElementById('add-contact-btn').addEventListener('click', () => openModal(null));
document.getElementById('chat-settings-btn').addEventListener('click', () => openModal(currentContactId));

sendButton.addEventListener('click', () => handleSend(false));
taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend(false);
});
rerollBtn.addEventListener('click', () => handleSend(true));

window.addEventListener('load', init);