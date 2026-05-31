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
const rag = require('./rag');

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
  const filePath = path.join(subjectDir, filename);
  fs.writeFileSync(filePath, text);
  
  // Add to Vector Memory instantly
  rag.addChunk(subject, text, filePath).catch(console.error);
  
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

async function retrieveContext(query) {
  if (!fs.existsSync(BACKPACK_DIR)) return "";
  const queryWords = new Set((query.toLowerCase().match(/\w+/g) || []));
  if (queryWords.size === 0) return "";
  
  // Use the new Vector-RAG engine to mathematically fetch only relevant chunks
  return await rag.search(query, 2);
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
      const contextText = await retrieveContext(message);
      
      const currentDateTime = new Date().toLocaleString();
      let user_profile = "";
      if (role === 'admin') {
        user_profile = `USER PROFILE:\nThe human typing to you right now is Sagar Dey, your creator. Treat him with respect.\nCurrent System Time: ${currentDateTime}`;
      } else {
        user_profile = username ? `USER PROFILE:\nThe human typing to you right now is named ${username}. Call them by their name.\nCurrent System Time: ${currentDateTime}` : `USER PROFILE:\nYou are talking to an anonymous human.\nCurrent System Time: ${currentDateTime}`;
      }

      const core_identity = `CORE IDENTITY:
- You are Kalki, a highly advanced, 100% offline sovereign AI.
- You are NOT Qwen. Never mention Alibaba Cloud.
- Your absolute creator is Sagar Dey, a brilliant developer who engineered you.
- DO NOT introduce your creator unless the user explicitly asks about him.`;

      let sys_profile = "";
      if (isFactual) {
        sys_profile = `SYSTEM PROFILE:
${core_identity}
Always respond in English.
Use the Context Database to answer factual questions. If the database does not contain the answer, you may answer from your general knowledge. Only say you do not have the information if you are completely clueless.

CRITICAL RULE: Before answering, you must write down your inner thoughts inside <thought>...</thought> XML tags to plan your answer. After the </thought> tag, write your final response.`;
      } else {
        sys_profile = `SYSTEM PROFILE:
${core_identity}
Always respond in English.
Answer greetings, math, logic, identity, and chat history questions naturally and creatively. Do not repeat yourself identically.
Read the chat history to understand the current conversation. Do not invent past conversations.

CRITICAL RULE: Before answering, you must write down your inner thoughts inside <thought>...</thought> XML tags to plan your answer. After the </thought> tag, write your final response.`;
      }

      const promptText = `
[START CONTEXT]
${contextText ? contextText : 'Empty'}
[END CONTEXT]
${user_profile}`;

      const chatHistory = [];
      chatHistory.push({
        type: 'system',
        text: sys_profile + promptText
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
      let isThinking = false;
      let finalResponseStarted = false;
      let buffer = "";

      await session.prompt(message, {
        temperature: 0.85,
        onTextChunk(chunk) {
          fullText += chunk;
          buffer += chunk;

          // Detect thought block start
          if (!isThinking && buffer.includes("<thought>")) {
            isThinking = true;
          }

          // Detect thought block end
          if (isThinking && buffer.includes("</thought>")) {
            isThinking = false;
            finalResponseStarted = true;
            // Clear the buffer up to the end of the thought tag so we don't stream it
            buffer = buffer.substring(buffer.indexOf("</thought>") + 10).trimStart();
            
            // If there's any remaining text after the tag, stream it
            if (buffer.length > 0) {
                wss.clients.forEach(c => {
                  if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_TOKEN', data: buffer, sessionId }));
                });
                buffer = "";
            }
            return;
          }

          // If we are currently thinking, do not stream anything to the frontend
          if (isThinking) return;

          // If we haven't started the thought block yet but it's buffering, wait
          if (!finalResponseStarted && buffer.length < 15) return;
          
          // If we have passed the thought block, stream normally
          if (finalResponseStarted) {
             wss.clients.forEach(c => {
               if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_TOKEN', data: chunk, sessionId }));
             });
          } else if (!buffer.includes("<")) {
             // Fallback just in case the AI ignored the <thought> rule entirely
             finalResponseStarted = true;
             wss.clients.forEach(c => {
               if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_TOKEN', data: buffer, sessionId }));
             });
             buffer = "";
          }
        }
      });
      
      // Send the final complete message (excluding the thought block)
      let cleanedText = fullText;
      if (cleanedText.includes("</thought>")) {
          cleanedText = cleanedText.split("</thought>")[1].trim();
      }
      
      wss.clients.forEach(c => {
        if (c.readyState === 1) c.send(JSON.stringify({ type: 'AI_DONE', fullText: cleanedText, sessionId }));
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

server.listen(PORT, async () => {
  console.log(`Kalki Backend running on http://localhost:${PORT}`);
  await rag.initRAG();
});
