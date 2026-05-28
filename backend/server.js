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

// --- PYTHON AI IPC ---
let brainProcess = null;

function startBrain() {
  if (brainProcess) return;
  // Use a python command, default to 'python' (or 'python3' based on OS, user uses Windows so 'python')
  brainProcess = spawn('python', ['-u', path.join(AI_CORE_DIR, 'brain.py')], {
    cwd: AI_CORE_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  let stdoutBuffer = '';
  brainProcess.stdout.on('data', (data) => {
    stdoutBuffer += data.toString('utf8');
    let lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // Keep incomplete chunk
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'token') {
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'AI_TOKEN', data: msg.token, sessionId: msg.sessionId }));
            }
          });
        } else if (msg.event === 'done') {
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'AI_DONE', fullText: msg.full_text, sessionId: msg.sessionId }));
            }
          });
        } else if (msg.event === 'title') {
          ChatSession.findByIdAndUpdate(msg.sessionId, { title: msg.title }).then(() => {
            wss.clients.forEach(client => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'AI_TITLE', title: msg.title, sessionId: msg.sessionId }));
              }
            });
          });
        }
      } catch (e) {
        console.log(`AI Log: ${line}`);
      }
    }
  });

  brainProcess.stderr.on('data', (data) => {
    console.error(`AI Core Error: ${data}`);
  });

  brainProcess.on('close', (code) => {
    console.log(`Brain process exited with code ${code}`);
    brainProcess = null;
  });
}

// Start brain automatically
startBrain();

app.post('/api/chat', async (req, res) => {
  const { sessionId, role, username, message, history, generateTitle } = req.body;
  if (!brainProcess) startBrain();
  
  if (brainProcess) {
    // Send message via stdin as JSON
    const payload = JSON.stringify({
      sessionId,
      role,
      username,
      query: message,
      history: history || [],
      generateTitle: !!generateTitle
    });
    brainProcess.stdin.write(payload + '\n');
    res.json({ success: true, status: 'processing' });
  } else {
    res.status(500).json({ error: 'AI Core not running' });
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
