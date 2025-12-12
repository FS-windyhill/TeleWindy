const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000; // 对应 1Panel 反向代理的端口
const DATA_FILE = path.join(__dirname, 'telewindy-data.json');

// 【重要】这里填你自己设定的密码，防止别人乱存！
// 以后你在前端输入 Token 的地方，就填这个密码
const MY_SECRET_KEY = "szlszz0304"; 

// 允许你的 GitHub Pages 域名访问 (CORS 设置)
app.use(cors({
    origin: '*', // 为了方便先允许所有，如果想严格点，把 * 改成 'https://你的github用户名.github.io'
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 增加上传限制，由 5MB 改成 50MB，够你存几百万字了
app.use(bodyParser.json({ limit: '100mb' }));

// 验证密码的中间件
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // 前端发过来的通常是 "Bearer 你的密码"
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token === MY_SECRET_KEY) {
        next();
    } else {
        res.status(403).json({ error: '密码错误' });
    }
};

// 1. 获取数据 (GET)
app.get('/api/data', authenticate, (req, res) => {
    if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.json(JSON.parse(data));
    } else {
        res.status(404).json({ error: '还没存过数据呢' });
    }
});

// 2. 保存数据 (POST)
app.post('/api/data', authenticate, (req, res) => {
    try {
        const dataToSave = req.body;
        // 格式化一下 JSON，方便你在服务器上直接看（如果不嫌占空间）
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
        res.json({ success: true, message: '保存成功！' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '服务器写入出错' });
    }
});

app.listen(PORT, () => {
    console.log(`后端服务已启动：http://localhost:${PORT}`);
});