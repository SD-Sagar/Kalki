import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const BACKEND_URL = 'http://localhost:5000';

const MarkdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    return !inline && match ? (
      <div className="relative group mt-4 mb-4 rounded-xl overflow-hidden border border-gray-700/50">
        <div className="flex justify-between items-center px-4 py-2 bg-gray-800 text-gray-400 text-xs font-mono border-b border-gray-700/50">
          <span>{match[1]}</span>
          <button
            onClick={() => navigator.clipboard.writeText(codeString)}
            className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            Copy
          </button>
        </div>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, padding: '1rem', background: '#1e1e1e', overflowX: 'auto' }}
          {...props}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    ) : (
      <code className={`${className} bg-gray-800/50 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-sm`} {...props}>
        {children}
      </code>
    );
  },
  p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6 text-indigo-400">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold mb-3 mt-5 text-indigo-300">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-bold mb-2 mt-4 text-indigo-200">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noreferrer">{children}</a>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-indigo-500 pl-4 py-1 italic bg-gray-800/30 rounded-r-lg my-4">{children}</blockquote>
};

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-indigo-500 selection:text-white">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/admin-gate" element={<AdminGate />} />
          <Route path="/chat" element={<UserSandbox />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </div>
    </Router>
  );
}

// --- LOGIN & AUTHENTICATION ---
function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (isRegistering) {
        if (data.success) {
          alert('Registration successful! Please sign in.');
          setIsRegistering(false);
        } else {
          alert(data.error);
        }
      } else {
        if (data.token) {
          localStorage.setItem('userToken', data.token);
          localStorage.setItem('userId', data.user._id);
          localStorage.setItem('username', data.user.username);
          navigate('/chat', { replace: true });
        } else {
          alert(data.error);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 to-black">
      <div className="p-8 bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl shadow-2xl w-96">
        <h1 className="text-3xl font-bold text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">Kalki</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input className="px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors" type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition-all hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]" type="submit">
            {isRegistering ? 'Register' : 'Sign In'}
          </button>
        </form>
        <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-sm text-gray-400 hover:text-white w-full text-center">
          {isRegistering ? 'Already have an account? Sign In' : 'Need an account? Register'}
        </button>
      </div>
    </div>
  );
}

function AdminGate() {
  const [secret, setSecret] = useState('');
  const navigate = useNavigate();

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    const res = await fetch(`${BACKEND_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secret })
    });
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('adminSecret', secret);
      navigate('/admin', { replace: true });
    } else {
      alert('Invalid Sequence');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-950/40 via-black to-black pointer-events-none"></div>

      <div className="z-10 flex flex-col items-center gap-12">
        <h1 className="text-7xl md:text-9xl font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-red-900 drop-shadow-[0_0_25px_rgba(239,68,68,0.6)] select-none">
          KALKI
        </h1>

        <form onSubmit={handleAdminLogin} className="relative group">
          <input
            className="bg-black/50 border-b-2 border-red-900/50 text-red-500 px-6 py-3 focus:outline-none focus:border-red-500 text-center tracking-[1em] font-mono transition-all w-96 backdrop-blur-sm"
            type="password"
            placeholder="ACCESS CODE"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            autoFocus
          />
          <div className="absolute inset-0 border border-red-500/0 group-hover:border-red-500/20 pointer-events-none transition-all rounded-sm shadow-[0_0_15px_rgba(239,68,68,0.1)]"></div>
        </form>
      </div>

      <div className="absolute bottom-8 text-red-900/40 font-mono text-xs tracking-[0.4em] select-none">MASTER OVERRIDE TERMINAL</div>
    </div>
  );
}

// --- SHARED CHAT HOOK ---
function useChat(role, userId, username) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  const ws = useRef(null);
  const activeSessionIdRef = useRef(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/chats?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        setSessions(data);
        if (data.length > 0) loadSession(data[0]._id);
        else createNewSession();
      });

    ws.current = new WebSocket('ws://localhost:5000');
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== activeSessionIdRef.current) return;

      if (msg.type === 'AI_TOKEN') {
        setChatLog(prev => {
          const newLog = [...prev];
          const lastMsg = newLog[newLog.length - 1];
          if (lastMsg && lastMsg.role === 'kalki') {
            lastMsg.content += msg.data;
          } else {
            newLog.push({ role: 'kalki', content: msg.data });
          }
          return newLog;
        });
      } else if (msg.type === 'AI_DONE') {
        // Save to db
        setChatLog(prev => {
          fetch(`${BACKEND_URL}/api/chats/${msg.sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: prev })
          });

          // Smart student request logic for users
          if (role === 'user' && msg.fullText.includes("I do not have that information")) {
            const lastUserQ = prev[prev.length - 2]?.content;
            if (lastUserQ) {
              fetch(`${BACKEND_URL}/api/student-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: lastUserQ })
              });
            }
          }

          // Trigger AI title generation if this is the first exchange
          if (prev.length === 2) {
            fetch(`${BACKEND_URL}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: msg.sessionId,
                role,
                username,
                history: prev,
                generateTitle: true
              })
            });
          }
          return prev;
        });
      } else if (msg.type === 'AI_TITLE') {
        setSessions(prev => prev.map(s => s._id === msg.sessionId ? { ...s, title: msg.title } : s));
      }
    };
    return () => ws.current.close();
  }, [userId, role, username]);

  const createNewSession = () => {
    setActiveSessionId(null);
    setChatLog([]);
  };

  const loadSession = async (id) => {
    const res = await fetch(`${BACKEND_URL}/api/chats/${id}`);
    const chat = await res.json();
    setActiveSessionId(chat._id);
    setChatLog(chat.messages || []);
  };

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this chat permanently?")) return;

    await fetch(`${BACKEND_URL}/api/chats/${id}`, { method: 'DELETE' });

    const newSessions = sessions.filter(s => s._id !== id);
    setSessions(newSessions);

    if (activeSessionId === id) {
      if (newSessions.length > 0) {
        loadSession(newSessions[0]._id);
      } else {
        createNewSession();
      }
    }
  };

  const sendQuery = async (query) => {
    if (!query.trim()) return;
    const newHistory = [...chatLog, { role: 'user', content: query }];
    setChatLog(newHistory);

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      // Lazy-create the DB session on first message
      const res = await fetch(`${BACKEND_URL}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const chat = await res.json();
      currentSessionId = chat._id;
      setActiveSessionId(currentSessionId);
      setSessions(prev => [chat, ...prev]);
    }

    await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        role,
        username,
        message: query,
        history: chatLog // Send old history so python gets full context
      })
    });
  };

  return { sessions, activeSessionId, chatLog, createNewSession, loadSession, deleteSession, sendQuery };
}

// --- SHARED SIDEBAR COMPONENT ---
function ChatSidebar({ sessions, activeSessionId, createNewSession, loadSession, deleteSession, isDark = false }) {
  return (
    <div className={`w-64 flex flex-col border-r ${isDark ? 'bg-gray-950 border-gray-800' : 'bg-gray-900 border-gray-800'}`}>
      <div className="p-4">
        <button
          onClick={createNewSession}
          className={`w-full py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${isDark ? 'bg-red-900/20 text-red-500 hover:bg-red-900/40 border border-red-900/50' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
        {sessions.map(s => (
          <div
            key={s._id}
            onClick={() => loadSession(s._id)}
            className={`group cursor-pointer px-3 py-3 rounded-lg flex items-center justify-between transition-all ${activeSessionId === s._id ? (isDark ? 'bg-red-900/20 text-red-400' : 'bg-indigo-600/20 text-indigo-400') : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
          >
            <div className="truncate text-sm pr-2 flex-1">{s.title.replace(/["']/g, '')}</div>
            <button
              onClick={(e) => deleteSession(e, s._id)}
              className="text-gray-500 hover:text-red-500 transition-all p-1 ml-2 flex-shrink-0"
              title="Delete Chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- USER SANDBOX ---
function UserSandbox() {
  const [query, setQuery] = useState('');
  const chatEndRef = useRef(null);
  const userId = localStorage.getItem('userId');
  const username = localStorage.getItem('username');
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) navigate('/');
  }, [userId, navigate]);

  const { sessions, activeSessionId, chatLog, createNewSession, loadSession, deleteSession, sendQuery } = useChat('user', userId, username);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  return (
    <div className="flex h-screen bg-gray-950">
      <ChatSidebar sessions={sessions} activeSessionId={activeSessionId} createNewSession={createNewSession} loadSession={loadSession} deleteSession={deleteSession} />

      <div className="flex-1 flex flex-col max-w-5xl mx-auto p-4 relative">
        <div className="flex-1 overflow-y-auto mb-4 space-y-6 pr-4 mt-4">
          {chatLog.length === 0 && (
            <div className="h-full flex items-center justify-center text-gray-500 flex-col gap-4">
              <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-cyan-400">Kalki Local AI</div>
              <p>How can I assist you today?</p>
            </div>
          )}
          {chatLog.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-5 rounded-2xl max-w-[85%] shadow-sm overflow-hidden break-words ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-gray-800/80 text-gray-200 border border-gray-700/50 rounded-bl-sm'}`}>
                <div className="font-sans break-words text-base">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MarkdownComponents}
                  >
                    {msg.content.replace(/\[END_?OF_?RESPONSE\]/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<\/?thought>/gi, '').trim()}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} className="h-4" />
        </div>
        <div className="relative mt-2">
          <textarea
            rows={1}
            className="w-full px-6 py-4 bg-gray-900 border border-gray-700 rounded-2xl focus:outline-none focus:border-indigo-500 transition-all shadow-[0_0_20px_rgba(0,0,0,0.3)] pr-16 text-lg resize-none"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendQuery(query);
                setQuery('');
              }
            }}
            placeholder={`Ask Kalki...`}
          />
          <button
            onClick={() => { sendQuery(query); setQuery(''); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center hover:bg-indigo-500 transition-colors shadow-md"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// --- ADMIN DASHBOARD ---
function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('command center');
  const navigate = useNavigate();

  useEffect(() => {
    const secret = sessionStorage.getItem('adminSecret');
    if (!secret) navigate('/admin-gate', { replace: true });
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem('adminSecret');
    navigate('/admin-gate', { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <div className="w-64 bg-gray-900 border-r border-gray-800 p-4 flex flex-col gap-2 relative z-10 shadow-2xl shadow-black">
        <div className="text-2xl font-bold tracking-widest text-red-500 mb-8 px-4 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">MASTER DECK</div>
        {['command center', 'requests', 'chat'].map(tab => (
          <button
            key={tab}
            className={`text-left px-4 py-3 rounded-lg capitalize transition-all ${activeTab === tab ? 'bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]' : 'text-gray-400 hover:bg-gray-800'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}

        <button
          onClick={handleLogout}
          className="absolute bottom-8 left-4 right-4 py-3 bg-red-900/20 border border-red-900/50 text-red-500 rounded-lg hover:bg-red-900/40 hover:border-red-500 transition-all uppercase tracking-widest text-sm font-bold"
        >
          Lock Deck
        </button>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'command center' && <CommandCenter />}
        {activeTab === 'requests' && <div className="p-8 flex-1 overflow-y-auto"><RequestBoard /></div>}
        {activeTab === 'chat' && <AdminChat />}
      </div>
    </div>
  );
}

function CommandCenter() {
  return (
    <div className="flex-1 flex h-full overflow-hidden w-full">
      <div className="w-1/3 border-r border-gray-800 p-8 overflow-y-auto bg-gray-950 flex-shrink-0">
        <LiveIngestion />
        <BulkDocumentIngestion />
      </div>
      <div className="flex-1 p-8 overflow-y-auto bg-black">
        <TeacherQueue />
      </div>
    </div>
  );
}

function LiveIngestion() {
  const [keywords, setKeywords] = useState('');

  const toggleScraper = async (action) => {
    await fetch(`${BACKEND_URL}/api/admin/scraper/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords })
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-gray-100">Live Web Ingestion</h2>
      <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl space-y-4">
        <input
          className="w-full px-4 py-3 bg-gray-950 border border-gray-800 rounded-lg focus:border-red-500 focus:outline-none"
          placeholder="Keywords (e.g. quantum physics, history)"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
        />
        <div className="flex gap-4">
          <button onClick={() => toggleScraper('start')} className="px-6 py-3 bg-green-600/20 text-green-400 border border-green-600/50 rounded-lg hover:bg-green-600/30 transition-colors">Start Learning</button>
          <button onClick={() => toggleScraper('stop')} className="px-6 py-3 bg-red-600/20 text-red-400 border border-red-600/50 rounded-lg hover:bg-red-600/30 transition-colors">Stop Learning</button>
        </div>
      </div>
    </div>
  );
}

function BulkDocumentIngestion() {
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!subject) setSubject(file.name.split('.')[0]);

    const reader = new FileReader();
    reader.onload = (event) => {
      setText(event.target.result);
    };
    reader.readAsText(file);
  };

  const pushToBrain = async () => {
    if (!subject.trim() || !text.trim()) return;
    const secret = sessionStorage.getItem('adminSecret');
    await fetch(`${BACKEND_URL}/api/admin/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, text, secret })
    });
    setSubject('');
    setText('');
    alert("Document successfully ingested into Kalki's brain!");
  };

  return (
    <div className="space-y-6 mt-12">
      <h2 className="text-2xl font-semibold text-gray-100">Bulk Document Ingestion</h2>
      <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl space-y-4">
        <div className="flex gap-4">
          <input
            className="flex-1 px-4 py-3 bg-gray-950 border border-gray-800 rounded-lg focus:border-red-500 focus:outline-none"
            placeholder="Subject Name"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
          <label className="px-6 py-3 bg-gray-800 text-gray-300 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer flex items-center justify-center whitespace-nowrap">
            Upload File
            <input type="file" className="hidden" accept=".txt,.md,.js,.jsx,.json" onChange={handleFileUpload} />
          </label>
        </div>
        <textarea
          className="w-full h-64 p-4 bg-gray-950 border border-gray-800 rounded-lg focus:outline-none font-mono text-sm resize-none"
          placeholder="Paste bulk text or upload a file to review..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button
          onClick={pushToBrain}
          className="w-full px-6 py-3 bg-indigo-600/20 text-indigo-400 border border-indigo-600/50 rounded-lg hover:bg-indigo-600/30 transition-colors font-bold tracking-widest uppercase"
        >
          Push to Brain
        </button>
      </div>
    </div>
  );
}

function TeacherQueue() {
  const [queue, setQueue] = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    ws.current = new WebSocket('ws://localhost:5000');
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'SCRAPER_DATA') {
        try {
          const parsed = JSON.parse(msg.data);
          setQueue(prev => [...prev, parsed]);
        } catch (e) {
          console.log("Scraper Log:", msg.data);
        }
      }
    };
    return () => ws.current.close();
  }, []);

  const commitData = async (index) => {
    const item = queue[index];
    const secret = sessionStorage.getItem('adminSecret');
    await fetch(`${BACKEND_URL}/api/admin/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: item.subject, text: item.text, secret })
    });
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-gray-100">Teacher Approvals Queue</h2>
      {queue.map((item, i) => (
        <div key={i} className="p-6 bg-gray-900 border border-gray-800 rounded-xl space-y-4">
          <div className="text-sm font-mono text-indigo-400">Subject: {item.subject}</div>
          <textarea
            className="w-full h-32 p-4 bg-gray-950 border border-gray-800 rounded-lg focus:outline-none"
            defaultValue={item.text}
            onChange={(e) => {
              const newQueue = [...queue];
              newQueue[i].text = e.target.value;
              setQueue(newQueue);
            }}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setQueue(prev => prev.filter((_, idx) => idx !== i))} className="px-4 py-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700">Discard</button>
            <button onClick={() => commitData(i)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500">Commit to Chunk</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestBoard() {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = () => {
    fetch(`${BACKEND_URL}/api/admin/student-requests`)
      .then(res => res.json())
      .then(data => setRequests(data));
  };

  const ignoreRequest = async (id) => {
    await fetch(`${BACKEND_URL}/api/admin/student-requests/${id}/resolve`, { method: 'POST' });
    loadRequests();
  };

  const answerNow = async (id, question) => {
    // Inject the user's question directly into the backpack via direct learn
    const answer = prompt(`Write the answer to: "${question}". It will be added to Kalki's knowledge base.`);
    if (answer) {
      const secret = sessionStorage.getItem('adminSecret');
      await fetch(`${BACKEND_URL}/api/admin/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: `Answer to: ${question.substring(0, 20)}`, text: answer, secret })
      });
      await ignoreRequest(id);
      alert('Answer committed to Kalki\'s knowledge base.');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-gray-100">Student Request Board</h2>
      {requests.length === 0 && <div className="text-gray-500">No pending student requests.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {requests.map(req => (
          <div key={req._id} className="p-6 bg-gray-900 border border-yellow-900/30 rounded-xl space-y-4 flex flex-col hover:border-yellow-900/60 transition-all shadow-lg shadow-black/50">
            <div className="text-gray-300 flex-1 font-medium">"{req.question}"</div>
            <div className="text-xs text-gray-500">{new Date(req.timestamp).toLocaleString()}</div>
            <div className="flex gap-2">
              <button onClick={() => answerNow(req._id, req.question)} className="flex-1 py-2 bg-indigo-600/20 text-indigo-400 border border-indigo-600/50 rounded-lg hover:bg-indigo-600/30 text-sm font-semibold transition-all">Answer Now</button>
              <button onClick={() => ignoreRequest(req._id)} className="px-4 py-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700 text-sm transition-all hover:text-red-400 hover:bg-red-900/20">Ignore</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminChat() {
  const [query, setQuery] = useState('');
  const chatEndRef = useRef(null);
  const { sessions, activeSessionId, chatLog, createNewSession, loadSession, deleteSession, sendQuery } = useChat('admin', 'admin', 'Sagar Dey');

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  const sendCommand = async () => {
    if (!query.trim()) return;

    if (query.startsWith('[Learn:')) {
      const match = query.match(/\[Learn:\s*(.+?)\](.*)/i);
      if (match) {
        const subject = match[1].trim();
        const text = match[2].trim();
        const secret = sessionStorage.getItem('adminSecret');
        await fetch(`${BACKEND_URL}/api/admin/learn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, text, secret })
        });
        alert('Direct learning committed.');
        setQuery('');
        return;
      }
    }

    sendQuery(query);
    setQuery('');
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <ChatSidebar sessions={sessions} activeSessionId={activeSessionId} createNewSession={createNewSession} loadSession={loadSession} deleteSession={deleteSession} isDark={true} />

      <div className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full relative">
        <h2 className="text-xl font-bold text-red-500 mb-4 tracking-widest">ADMIN TERMINAL</h2>
        <div className="text-red-900/60 font-mono text-xs text-center absolute top-6 right-6">Use [Learn: Subject] Your Text</div>

        <div className="flex-1 bg-black/40 border border-red-900/30 rounded-2xl p-6 overflow-y-auto space-y-6 shadow-inner mb-4">
          {chatLog.length === 0 && (
            <div className="h-full flex items-center justify-center text-red-900/40 flex-col gap-2 font-mono">
              <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <div>SYSTEM ONLINE. AWAITING OVERRIDE.</div>
            </div>
          )}
          {chatLog.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-4 rounded-xl max-w-[80%] text-sm overflow-hidden break-words ${msg.role === 'user' ? 'bg-red-900/20 text-red-400 border border-red-900/50' : 'bg-gray-900 border border-gray-800 text-gray-300'}`}>
                <div className="break-words font-mono">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MarkdownComponents}
                  >
                    {msg.content.replace(/\[END_?OF_?RESPONSE\]/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<\/?thought>/gi, '').trim()}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} className="h-4" />
        </div>

        <div className="relative mt-2">
          <textarea
            rows={1}
            className="w-full px-6 py-4 bg-black border border-red-900/50 rounded-xl focus:outline-none focus:border-red-500 font-mono text-red-400 placeholder-red-900/50 transition-all shadow-[0_0_15px_rgba(239,68,68,0.1)] resize-none"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendCommand();
              }
            }}
            placeholder="root@kalki:~# "
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

export default App;
