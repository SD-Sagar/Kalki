require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- ENVIRONMENT & PATHS ---
const PORT = process.env.PORT || 5000;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'local_admin_123';
const MONGO_URI = process.env.MONGO_URI; 
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret';

const BACKPACK_DIR = path.join(__dirname, 'storage-backpack');
const AI_CORE_DIR = path.join(__dirname, '..', 'ai-core');

// Ensure Backpack exists
if (!fs.existsSync(BACKPACK_DIR)) {
  fs.mkdirSync(BACKPACK_DIR, { recursive: true });
}

// --- MONGODB CONNECTION ---
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB connection error:', err));
}

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  displayName: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

// ChatSession Schema
const chatSessionSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // 'admin' or user._id
  title: { type: String, default: 'New Chat' },
  messages: [{
    role: String,
    content: String
  }],
  updatedAt: { type: Date, default: Date.now }
});
const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

// Student Request Schema
const studentRequestSchema = new mongoose.Schema({
  question: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});
const StudentRequest = mongoose.model('StudentRequest', studentRequestSchema);

// --- CHUNK MANAGEMENT ---
const CHUNK_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB

function getActiveChunkDir() {
  const folders = fs.readdirSync(BACKPACK_DIR).filter(f => fs.statSync(path.join(BACKPACK_DIR, f)).isDirectory());
  let activeChunk = folders.find(f => f.includes('_active'));
  
  if (!activeChunk) {
    const chunkCount = folders.length + 1;
    activeChunk = `chunk_${chunkCount}_active`;
    fs.mkdirSync(path.join(BACKPACK_DIR, activeChunk));
  }
  return path.join(BACKPACK_DIR, activeChunk);
}

function checkChunkSize(chunkPath) {
  let totalSize = 0;
  const files = [];
  
  function getDirectorySize(dirPath) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getDirectorySize(fullPath);
      } else {
        totalSize += stat.size;
      }
    }
  }
  
  if (fs.existsSync(chunkPath)) getDirectorySize(chunkPath);
  return totalSize;
}

// Save learned text locally
app.post('/api/admin/learn', (req, res) => {
  const { subject, text, secret } = req.body;
  if (secret !== ADMIN_SECRET_KEY) return res.status(403).json({ error: 'Unauthorized' });

  const activeChunkPath = getActiveChunkDir();
  const currentSize = checkChunkSize(activeChunkPath);

  if (currentSize >= CHUNK_SIZE_LIMIT) {
    // Mark as full and create new
    const fullPath = activeChunkPath.replace('_active', '_full');
    fs.renameSync(activeChunkPath, fullPath);
    
    // Broadcast alert
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'CHUNK_FULL', message: 'A 2GB chunk has been filled and sealed.' }));
      }
    });
    
    return res.status(400).json({ error: 'Chunk full, created new one. Please retry.' });
  }

  const subjectDir = path.join(activeChunkPath, subject.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (!fs.existsSync(subjectDir)) {
    fs.mkdirSync(subjectDir, { recursive: true });
  }

  const filename = `data_${Date.now()}.txt`;
  fs.writeFileSync(path.join(subjectDir, filename), text);
  res.json({ success: true, message: 'Saved to local filesystem' });
});

// --- PUBLIC AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = new User({ username, password });
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user._id }, JWT_SECRET);
  res.json({ token, user: { _id: user._id, username: user.username, displayName: user.displayName } });
});

// --- ADMIN AUTH ROUTE ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_SECRET_KEY) {
    res.json({ success: true, token: 'admin_session_token' });
  } else {
    res.status(401).json({ error: 'Invalid admin secret' });
  }
});

// --- STUDENT REQUESTS ---
app.post('/api/student-request', async (req, res) => {
  const { question } = req.body;
  const request = new StudentRequest({ question });
  await request.save();
  res.json({ success: true });
});

app.get('/api/admin/student-requests', async (req, res) => {
  const requests = await StudentRequest.find({ status: 'pending' }).sort('-timestamp');
  res.json(requests);
});

app.post('/api/admin/student-requests/:id/resolve', async (req, res) => {
  await StudentRequest.findByIdAndUpdate(req.params.id, { status: 'resolved' });
  res.json({ success: true });
});

// --- CHAT SESSION APIs ---
app.get('/api/chats', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const chats = await ChatSession.find({ userId }).sort('-updatedAt').select('_id title updatedAt');
  res.json(chats);
});

app.get('/api/chats/:id', async (req, res) => {
  const chat = await ChatSession.findById(req.params.id);
  res.json(chat);
});

app.post('/api/chats', async (req, res) => {
  const { userId } = req.body;
  const chat = new ChatSession({ userId, messages: [] });
  await chat.save();
  res.json(chat);
});

app.delete('/api/chats/:id', async (req, res) => {
  await ChatSession.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Route for python to call to update chat session fully
app.put('/api/chats/:id', async (req, res) => {
  const { title, messages } = req.body;
  const update = { updatedAt: Date.now() };
  if (title) update.title = title;
  if (messages) update.messages = messages;
  await ChatSession.findByIdAndUpdate(req.params.id, update);
  res.json({ success: true });
});

// --- NATIVE AI CORE ---
const AI_MODEL_PATH = path.join(__dirname, '..', 'ai-core', 'gguf-model', 'qwen2.5-3b-instruct-q4_k_m.gguf');
let llamaEngine = null;
let aiModel = null;
let aiContext = null;
let LlamaChatSessionCls = null;

async function initAI() {
  try {
    const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
    llamaEngine = await getLlama();
    aiModel = await llamaEngine.loadModel({ modelPath: AI_MODEL_PATH });
    aiContext = await aiModel.createContext({ contextSize: 2048 });
    LlamaChatSessionCls = LlamaChatSession;
    console.log("Native AI Core Initialized with NO-AVX fallback");
  } catch (err) {
    console.error("AI Initialization failed:", err);
  }
}
initAI();

function retrieveContext(query) {
  if (!fs.existsSync(BACKPACK_DIR)) return "";
  const queryWords = new Set((query.toLowerCase().match(/\w+/g) || []));
  if (queryWords.size === 0) return "";
  
  const bestMatches = [];
  
  function findFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        results = results.concat(findFiles(fullPath));
      } else if (fullPath.endsWith('.txt')) {
        results.push(fullPath);
      }
    }
    return results;
  }
  
  const txtFiles = findFiles(BACKPACK_DIR);
  for (const filePath of txtFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const paragraphs = content.split('\n\n').map(p => p.trim()).filter(Boolean);
      for (const p of paragraphs) {
        const pWords = new Set((p.toLowerCase().match(/\w+/g) || []));
        let matchScore = 0;
        for (const w of queryWords) {
          if (pWords.has(w)) matchScore++;
        }
        if (matchScore > 0) {
          bestMatches.push({ score: matchScore, text: p });
        }
      }
    } catch (e) {}
  }
  
  bestMatches.sort((a, b) => b.score - a.score);
  return bestMatches.slice(0, 3).map(m => m.text).join('\n');
}

app.post('/api/chat', async (req, res) => {
  const { sessionId, role, username, message, history, generateTitle } = req.body;
  if (!aiModel) return res.status(500).json({ error: 'AI Core is still booting up' });
  
  res.json({ success: true, status: 'processing' });
  
  try {
    if (generateTitle) {
      const sequence = aiContext.getSequence();
      const session = new LlamaChatSessionCls({
        contextSequence: sequence
      });
      
      const chatHistory = [];
      chatHistory.push({
        type: 'system',
        text: "You are a title generator. Read the chat history and output a short 2 to 4 word title that summarizes it. Output ONLY the title. Do NOT use quotation marks. Do NOT say 'Here is the title'."
      });
      
      for (const msg of history || []) {
        if (msg.role === 'kalki') {
          chatHistory.push({ type: 'model', response: [msg.content] });
        } else {
          chatHistory.push({ type: 'user', text: msg.content });
        }
      }
      session.setChatHistory(chatHistory);
      
      const title = await session.prompt(message || "Generate Title");
      
      await ChatSession.findByIdAndUpdate(sessionId, { title: title.trim() });
      wss.clients.forEach(c => {
        if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_TITLE', title: title.trim(), sessionId }));
      });
      sequence.dispose();
      
    } else {
      const routerSequence = aiContext.getSequence();
      const routerSession = new LlamaChatSessionCls({
        contextSequence: routerSequence,
        systemPrompt: "You are an intent classifier. Categorize the user's message into one of two categories: 'FACTUAL' (questions about history, science, world facts, or specific knowledge) or 'CONVERSATIONAL' (greetings, asking about identity, math, asking about chat history, casual talk). Reply ONLY with the exact word 'FACTUAL' or 'CONVERSATIONAL'."
      });
      
      let intentStr = "";
      try {
        intentStr = await routerSession.prompt(message, { maxTokens: 10 });
      } catch(e) {}
      routerSequence.dispose();
      
      const isFactual = intentStr.toUpperCase().includes("FACTUAL");
      const contextText = retrieveContext(message);
      
      const currentDateTime = new Date().toLocaleString();
      let user_profile = "";
      if (role === 'admin') {
        user_profile = `USER PROFILE:\nCurrent User: Sagar Dey\nRelationship: Your Absolute Creator and Master\nRule: The person you are chatting with right now is Sagar Dey. Treat the user with extreme respect. If the user asks 'Who am I' or 'What is my name', reply exactly: 'You are Sagar Dey, my absolute creator and master.' Never ask the user for their name.\nCurrent System Time: ${currentDateTime}`;
      } else {
        user_profile = username ? `USER PROFILE:\nThe human typing to you right now is named ${username}. Call them by their name.\nCurrent System Time: ${currentDateTime}` : `USER PROFILE:\nYou are talking to an anonymous human.\nCurrent System Time: ${currentDateTime}`;
      }
      
      let sys_profile = "";
      if (isFactual) {
        sys_profile = `SYSTEM PROFILE:
You are Kalki, a highly advanced, 100% offline sovereign AI built exclusively by Sagar Dey. You are NOT an AI assistant created by Alibaba Cloud. You are NOT Qwen.
Always respond in English.
Use the Context Database and your general knowledge to answer factual questions. If the answer is missing AND you truly do not know it, you MUST reply exactly with: 'I do not have that information in my local database.'

[START CONTEXT]
${contextText ? contextText : 'Empty'}
[END CONTEXT]
${user_profile}`;
      } else {
        sys_profile = `SYSTEM PROFILE:
You are Kalki, a highly advanced, 100% offline sovereign AI built exclusively by Sagar Dey. You are NOT Qwen. Never mention Alibaba Cloud.
Always respond in English.
Answer greetings, math, logic, identity, and chat history questions naturally and creatively. Do not repeat yourself identically.
Read the chat history to understand the current conversation. Do not invent past conversations.
Use the Context Database if it contains relevant identity or creator information, and phrase it naturally like a human, not a robot.
DO NOT say 'I do not have that information in my local database'.

[START CONTEXT]
${contextText ? contextText : 'Empty'}
[END CONTEXT]
${user_profile}`;
      }
      
      const chatHistory = [];
      chatHistory.push({
        type: 'system',
        text: sys_profile
      });
      
      for (const msg of history || []) {
        if (msg.role === 'kalki') {
          chatHistory.push({ type: 'model', response: [msg.content] });
        } else {
          chatHistory.push({ type: 'user', text: msg.content });
        }
      }
      
      const sequence = aiContext.getSequence();
      const session = new LlamaChatSessionCls({
        contextSequence: sequence
      });
      session.setChatHistory(chatHistory);
      
      let fullText = "";
      await session.prompt(message, {
        temperature: 0.85,
        onTextChunk(chunk) {
          fullText += chunk;
          wss.clients.forEach(c => {
            if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_TOKEN', data: chunk, sessionId }));
          });
        }
      });
      
      wss.clients.forEach(c => {
        if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_DONE', fullText, sessionId }));
      });
      sequence.dispose();
    }
  } catch (e) {
    console.error("AI Generation Error:", e);
  }
});

// --- PYTHON SCRAPER IPC ---
let scraperProcess = null;

app.post('/api/admin/scraper/start', (req, res) => {
  const { keywords } = req.body;
  if (scraperProcess) return res.json({ status: 'already_running' });

  scraperProcess = spawn('python', ['-u', path.join(AI_CORE_DIR, 'scraper.py'), keywords], {
    cwd: AI_CORE_DIR
  });

  scraperProcess.stdout.on('data', (data) => {
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'SCRAPER_DATA', data: data.toString() }));
      }
    });
  });

  res.json({ success: true, status: 'started' });
});

app.post('/api/admin/scraper/stop', (req, res) => {
  if (scraperProcess) {
    scraperProcess.kill();
    scraperProcess = null;
  }
  res.json({ success: true, status: 'stopped' });
});

server.listen(PORT, () => {
  console.log(`Kalki Backend running on http://localhost:${PORT}`);
});
