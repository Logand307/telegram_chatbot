// index.js — Telegram bot + RAG (Azure AI Search) + Azure OpenAI (Option B full URL)
require('dotenv/config');
const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const express = require('express');
const { createServer } = require('http');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/* ==== Env validation ==== */
const {
  TELEGRAM_BOT_TOKEN,
  // Chat model (full request URL to chat completions)
  AZURE_OPENAI_URL,
  AZURE_OPENAI_API_KEY,
  // Embeddings model (full request URL to embeddings)
  AZURE_OPENAI_EMBEDDINGS_URL,
  // Azure AI Search
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_API_KEY,
  AZURE_SEARCH_INDEX,
  // Pipeline/Deployment configuration
  PORT = 3000,
  WEBHOOK_URL,
  WEBHOOK_PATH = '/webhook',
  NODE_ENV = 'development'
} = process.env;

function ensure(name, val) {
  if (!val) throw new Error(`Missing ${name} in .env`);
}
ensure('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN);
ensure('AZURE_OPENAI_URL', AZURE_OPENAI_URL);
ensure('AZURE_OPENAI_API_KEY', AZURE_OPENAI_API_KEY);
ensure('AZURE_OPENAI_EMBEDDINGS_URL', AZURE_OPENAI_EMBEDDINGS_URL);
ensure('AZURE_SEARCH_ENDPOINT', AZURE_SEARCH_ENDPOINT);
ensure('AZURE_SEARCH_API_KEY', AZURE_SEARCH_API_KEY);
ensure('AZURE_SEARCH_INDEX', AZURE_SEARCH_INDEX);

/* ==== File Upload & Storage Setup ==== */
const uploadsDir = path.join(__dirname, 'uploads');
const documentsDir = path.join(__dirname, 'documents');

// Ensure directories exist
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(documentsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are allowed'));
    }
  }
});

// In-memory storage for uploaded documents (in production, use a database)
const uploadedDocuments = new Map();

// Cache for embeddings to avoid regenerating them
const embeddingCache = new Map();

// Batch size for parallel processing
const BATCH_SIZE = 5;

// Cache management
const MAX_CACHE_SIZE = 1000; // Maximum number of cached embeddings

function manageCache() {
  if (embeddingCache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (simple LRU-like behavior)
    const entries = Array.from(embeddingCache.entries());
    const toRemove = entries.slice(0, Math.floor(MAX_CACHE_SIZE * 0.2)); // Remove 20%
    
    toRemove.forEach(([key]) => {
      embeddingCache.delete(key);
    });
    
    console.log(`Cache cleaned: removed ${toRemove.length} entries`);
  }
}

// Clean cache every 5 minutes
setInterval(manageCache, 5 * 60 * 1000);

/* ==== Express app setup ==== */
const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for pipeline monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// Test Azure connections endpoint
app.get('/test-azure', async (req, res) => {
  try {
    const results = {
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      azure_openai: {
        url: AZURE_OPENAI_URL ? 'Configured' : 'Missing',
        api_key: AZURE_OPENAI_API_KEY ? 'Configured' : 'Missing'
      },
      azure_search: {
        endpoint: AZURE_SEARCH_ENDPOINT ? 'Configured' : 'Missing',
        api_key: AZURE_SEARCH_API_KEY ? 'Configured' : 'Missing',
        index: AZURE_SEARCH_INDEX ? 'Configured' : 'Missing'
      }
    };
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Root endpoint - Beautiful Dashboard
app.get('/', (req, res) => {
  const uptime = process.uptime();
  const uptimeFormatted = formatUptime(uptime);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram RAG Bot Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0d1117;
            min-height: 100vh;
            color: #e6edf3;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            color: #e6edf3;
        }
        
        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #58a6ff 0%, #1f6feb 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 700;
        }
        
        .header p {
            font-size: 1.2rem;
            opacity: 0.8;
            color: #8b949e;
        }
        
        .chat-interface {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 30px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        
        .chat-interface h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .chat-container {
            border: 1px solid #30363d;
            border-radius: 8px;
            overflow: hidden;
            background: #0d1117;
        }
        
        .chat-messages {
            height: 400px;
            overflow-y: auto;
            padding: 20px;
            background: #0d1117;
        }
        
        .message {
            margin-bottom: 16px;
            display: flex;
        }
        
        .user-message {
            justify-content: flex-end;
        }
        
        .bot-message {
            justify-content: flex-start;
        }
        
        .message-content {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 18px;
            position: relative;
        }
        
        .user-message .message-content {
            background: #1f6feb;
            color: white;
            border-bottom-right-radius: 6px;
        }
        
        .bot-message .message-content {
            background: #21262d;
            color: #e6edf3;
            border: 1px solid #30363d;
            border-bottom-left-radius: 6px;
        }
        
        .message-text {
            margin-bottom: 6px;
            line-height: 1.4;
        }
        
        .message-timestamp {
            font-size: 0.75rem;
            opacity: 0.7;
            text-align: right;
        }
        
        .chat-input-container {
            padding: 20px;
            background: #161b22;
            border-top: 1px solid #30363d;
        }
        
        .chat-form {
            display: flex;
            gap: 12px;
        }
        
        .chat-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #30363d;
            border-radius: 8px;
            font-size: 1rem;
            outline: none;
            background: #0d1117;
            color: #e6edf3;
            transition: border-color 0.2s;
        }
        
        .chat-input:focus {
            border-color: #58a6ff;
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
        }
        
        .chat-send-btn {
            background: #1f6feb;
            color: white;
            border: none;
            border-radius: 8px;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .chat-send-btn:hover {
            background: #1f6feb;
            opacity: 0.9;
        }
        
        .chat-send-btn:disabled {
            background: #30363d;
            cursor: not-allowed;
        }
        
        .chat-and-features {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 24px;
            margin-bottom: 30px;
        }
        
        .features {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            height: fit-content;
            position: sticky;
            top: 20px;
        }
        
        .features h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .feature-list {
            list-style: none;
        }
        
        .feature-list li {
            padding: 12px 0;
            border-bottom: 1px solid #30363d;
            display: flex;
            align-items: center;
        }
        
        .feature-list li:last-child {
            border-bottom: none;
        }
        
        .feature-icon {
            color: #238636;
            margin-right: 12px;
            font-size: 1.2rem;
        }
        
        .documents-section {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 30px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        
        .documents-section h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .upload-container {
            background: #0d1117;
            border: 2px dashed #30363d;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin-bottom: 30px;
            transition: border-color 0.2s;
        }
        
        .upload-container:hover {
            border-color: #58a6ff;
        }
        
        .upload-form {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
        }
        
        .file-input-wrapper {
            position: relative;
            width: 100%;
            max-width: 400px;
        }
        
        .file-input {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        
        .file-input-label {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 24px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 12px;
            color: #58a6ff;
            cursor: pointer;
            transition: all 0.2s;
            min-height: 120px;
            justify-content: center;
        }
        
        .file-input-label:hover {
            background: #30363d;
            border-color: #58a6ff;
        }
        
        .file-input-label svg {
            width: 48px;
            height: 48px;
            color: #58a6ff;
        }
        
        .selected-file-name {
            font-size: 0.9rem;
            color: #8b949e;
            margin-top: 8px;
            word-break: break-all;
        }
        
        .upload-btn {
            background: #1f6feb;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 14px 28px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: background-color 0.2s;
            font-size: 1rem;
            font-weight: 500;
        }
        
        .upload-btn:hover {
            background: #1f6feb;
            opacity: 0.9;
        }
        
        .upload-btn:disabled {
            background: #30363d;
            cursor: not-allowed;
        }
        
        .upload-status {
            margin-top: 20px;
            padding: 16px;
            border-radius: 8px;
            font-weight: 500;
            text-align: center;
        }
        
        .upload-status.success {
            background: #0c532a;
            border: 1px solid #238636;
            color: #7ee787;
        }
        
        .upload-status.error {
            background: #5a1f1a;
            border: 1px solid #da3633;
            color: #f85149;
        }
        
        .documents-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
            margin-top: 20px;
        }
        
        .document-item {
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 16px;
            transition: all 0.2s;
        }
        
        .document-item:hover {
            border-color: #58a6ff;
            transform: translateY(-2px);
        }
        
        .document-info {
            margin-bottom: 12px;
        }
        
        .document-item .name {
            font-weight: 600;
            color: #e6edf3;
            margin-bottom: 8px;
            font-size: 1rem;
        }
        
        .document-item .type {
            font-size: 0.8rem;
            color: #8b949e;
            padding: 4px 8px;
            border-radius: 4px;
            background: #30363d;
            display: inline-block;
            margin-bottom: 8px;
        }
        
        .document-item .upload-date,
        .document-item .text-length {
            font-size: 0.8rem;
            color: #8b949e;
            margin-bottom: 4px;
        }
        
        .document-item .actions {
            display: flex;
            gap: 8px;
        }
        
        .document-item .delete-btn {
            background: #da3633;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.9rem;
            transition: background-color 0.2s;
        }
        
        .document-item .delete-btn:hover {
            background: #f85149;
        }
        
        .loading, .no-documents, .error {
            text-align: center;
            padding: 40px;
            color: #8b949e;
            font-size: 1.1rem;
        }
        
        .error {
            color: #f85149;
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            transition: transform 0.2s, border-color 0.2s;
        }
        
        .card:hover {
            transform: translateY(-2px);
            border-color: #58a6ff;
        }
        
        .card h3 {
            color: #58a6ff;
            margin-bottom: 16px;
            font-size: 1.3rem;
            font-weight: 600;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            background: #238636;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .metric {
            font-size: 2rem;
            font-weight: bold;
            color: #58a6ff;
            margin-bottom: 8px;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-top: 16px;
        }
        
        .info-item {
            text-align: center;
        }
        
        .info-label {
            font-size: 0.9rem;
            color: #8b949e;
            margin-bottom: 4px;
        }
        
        .info-value {
            font-weight: bold;
            color: #e6edf3;
        }
        
        .info-value a {
            color: #58a6ff;
            text-decoration: none;
        }
        
        .info-value a:hover {
            text-decoration: underline;
        }
        
        .features {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        
        .features h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
        }
        
        .feature-list {
            list-style: none;
        }
        
        .feature-list li {
            padding: 12px 0;
            border-bottom: 1px solid #30363d;
            display: flex;
            align-items: center;
        }
        
        .feature-list li:last-child {
            border-bottom: none;
        }
        
        .feature-icon {
            color: #238636;
            margin-right: 12px;
            font-size: 1.2rem;
        }
        
        .footer {
            text-align: center;
            margin-top: 40px;
            color: #8b949e;
            opacity: 0.8;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .chat-and-features {
                grid-template-columns: 1fr;
                gap: 16px;
            }
            
            .dashboard {
                grid-template-columns: 1fr;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .documents-grid {
                grid-template-columns: 1fr;
            }
            
            .upload-container {
                padding: 20px;
            }
            
            .file-input-label {
                min-height: 100px;
                padding: 20px;
            }
            
            .chat-interface {
                padding: 16px;
            }
            
            .chat-messages {
                height: 300px;
            }
            
            .container {
                padding: 16px;
            }
            
            .features {
                position: static;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RecallAI</h1>
            <p>Intelligent answers, powered by GPT-4 and retrieval-augmented search.</p>
        </div>
        
        <div class="chat-and-features">
            <div class="chat-interface">
                <h3>💬 Chat with Your Bot</h3>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="message bot-message">
                            <div class="message-content">
                                <div class="message-text">Hello! I'm your RAG bot. Ask me anything and I'll search my knowledge base to help you. You can also chat with me on Telegram!</div>
                                <div class="message-timestamp">Just now</div>
                            </div>
                        </div>
                    </div>
                    <div class="chat-input-container">
                        <form id="chatForm" class="chat-form">
                            <input 
                                type="text" 
                                id="messageInput" 
                                placeholder="Type your message here..." 
                                class="chat-input"
                                autocomplete="off"
                            >
                            <button type="submit" class="chat-send-btn">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
            
            <div class="features">
                <h3>🚀 Bot Features</h3>
                <ul class="feature-list">
                    <li><span class="feature-icon">✅</span> Natural language conversations with GPT-4</li>
                    <li><span class="feature-icon">✅</span> RAG-powered responses using your knowledge base</li>
                    <li><span class="feature-icon">✅</span> Vector search for semantic understanding</li>
                    <li><span class="feature-icon">✅</span> Conversation memory and context</li>
                    <li><span class="feature-icon">✅</span> Cloud-deployed and always available</li>
                    <li><span class="feature-icon">✅</span> Health monitoring and status checks</li>
                    <li><span class="feature-icon">✅</span> Web chat interface for testing</li>
                    <li><span class="feature-icon">✅</span> Document upload and processing</li>
                    <li><span class="feature-icon">✅</span> Enhanced RAG with multiple sources</li>
                </ul>
            </div>
        </div>
        
        <div class="documents-section">
            <h3>📄 Upload Documents</h3>
            <p>Upload PDF or Word documents to enhance your bot's knowledge base</p>
            
            <div class="upload-container">
                <form id="uploadForm" class="upload-form">
                    <div class="file-input-wrapper">
                        <input 
                            type="file" 
                            id="documentInput" 
                            accept=".pdf,.doc,.docx"
                            class="file-input"
                        >
                        <label for="documentInput" class="file-input-label">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Choose File
                        </label>
                        <span id="selectedFileName" class="selected-file-name"></span>
                    </div>
                    <button type="submit" class="upload-btn" id="uploadBtn" disabled>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Upload Document
                    </button>
                </form>
            </div>
            
            <div class="upload-status" id="uploadStatus"></div>
        </div>
        
        <div class="documents-section">
            <h3>📚 Your Documents</h3>
            <div id="documentsList" class="documents-grid">
                <div class="loading">Loading documents...</div>
            </div>
        </div>
        
        <div class="dashboard">
            <div class="card">
                <h3><span class="status-indicator"></span>Bot Status</h3>
                <div class="metric">Online</div>
                <p>Your bot is running smoothly on Railway</p>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Environment</div>
                        <div class="info-value">${NODE_ENV}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Mode</div>
                        <div class="info-value">${isWebhookMode ? 'Webhook' : 'Polling'}</div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h3>📊 Performance</h3>
                <div class="metric">${uptimeFormatted}</div>
                <p>Uptime since last restart</p>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Port</div>
                        <div class="info-value">${PORT}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Health Check</div>
                        <div class="info-value"><a href="/health">/health</a></div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h3>🔗 Services</h3>
                <div class="metric">Azure</div>
                <p>Connected to OpenAI & AI Search</p>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">AI Model</div>
                        <div class="info-value">GPT-4</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Search</div>
                        <div class="info-value">Vector + Keyword</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Deployed on Railway • Built with Node.js & Express</p>
        </div>
    </div>
    
    <script>
        // Add some interactivity
        document.addEventListener('DOMContentLoaded', function() {
            // Update uptime every second
            setInterval(function() {
                fetch('/health')
                    .then(response => response.json())
                    .then(data => {
                        const uptimeElement = document.querySelector('.metric');
                        if (uptimeElement && uptimeElement.textContent.includes(':')) {
                            const uptime = data.uptime;
                            uptimeElement.textContent = formatUptime(uptime);
                        }
                    })
                    .catch(console.error);
            }, 1000);
            
            // Chat functionality
            setupChat();
            
            // File upload functionality
            setupFileUpload();
            
            // Load documents
            loadDocuments();
        });
        
        function setupChat() {
            const chatForm = document.getElementById('chatForm');
            const messageInput = document.getElementById('messageInput');
            const chatMessages = document.getElementById('chatMessages');
            
            chatForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const message = messageInput.value.trim();
                if (!message) return;
                
                // Add user message
                addMessage(message, 'user');
                messageInput.value = '';
                
                // Disable input while processing
                messageInput.disabled = true;
                document.querySelector('.chat-send-btn').disabled = true;
                
                // Show loading indicator
                const loadingMessage = addMessage('Thinking...', 'bot');
                
                try {
                    // Send to backend
                    const response = await fetch('/chat', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ message: message })
                    });
                    
                    const data = await response.json();
                    console.log('Web chat response data:', data);
                    
                    // Remove loading message
                    if (loadingMessage && loadingMessage.remove) {
                        loadingMessage.remove();
                    }
                    
                    if (data.success) {
                        console.log('Response success, adding message:', data.response);
                        // Add bot response
                        addMessage(data.response, 'bot');
                        
                        // If there are sources, show them
                        if (data.sources && data.sources.length > 0) {
                            console.log('Adding sources:', data.sources);
                            const sourcesText = 'Sources:\\n' + data.sources.map((s, i) => 
                                '[' + (i+1) + '] ' + (s.title || 'Untitled') + ' - ' + (s.url || 'No URL')
                            ).join('\\n');
                            addMessage(sourcesText, 'bot');
                        }
                    } else {
                        console.log('Response not successful:', data);
                        addMessage('Sorry, I encountered an error. Please try again.', 'bot');
                    }
                } catch (error) {
                    console.error('Chat error:', error);
                    // Remove loading message on error too
                    if (loadingMessage && loadingMessage.remove) {
                        loadingMessage.remove();
                    }
                    addMessage('Sorry, I encountered an error. Please try again.', 'bot');
                } finally {
                    // Re-enable input
                    messageInput.disabled = false;
                    document.querySelector('.chat-send-btn').disabled = false;
                    messageInput.focus();
                }
            });
            
            // Allow Enter key to send
            messageInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    chatForm.dispatchEvent(new Event('submit'));
                }
            });
        }
        
        function addMessage(text, sender) {
            const chatMessages = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender + '-message';
            
            const timestamp = new Date().toLocaleTimeString();
            
            messageDiv.innerHTML = 
                '<div class="message-content">' +
                    '<div class="message-text">' + text + '</div>' +
                    '<div class="message-timestamp">' + timestamp + '</div>' +
                '</div>';
            
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            return hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
        }

        function setupFileUpload() {
            const uploadForm = document.getElementById('uploadForm');
            const documentInput = document.getElementById('documentInput');
            const uploadBtn = document.getElementById('uploadBtn');
            const selectedFileName = document.getElementById('selectedFileName');
            const uploadStatus = document.getElementById('uploadStatus');
            
            // Handle file selection
            documentInput.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    selectedFileName.textContent = file.name;
                    uploadBtn.disabled = false;
                    uploadStatus.innerHTML = '';
                } else {
                    selectedFileName.textContent = '';
                    uploadBtn.disabled = true;
                }
            });
            
            // Handle form submission
            uploadForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const file = documentInput.files[0];
                if (!file) return;
                
                // Show uploading status
                uploadBtn.disabled = true;
                uploadBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Processing...';
                
                const formData = new FormData();
                formData.append('document', file);
                
                try {
                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        uploadStatus.innerHTML = \`✅ \${data.message}<br><strong>\${data.document.originalName}</strong> processed successfully!<br>Text length: \${data.document.textLength} characters, \${data.document.chunks} chunks created.\`;
                        uploadStatus.className = 'upload-status success';
                        
                        // Reset form
                        uploadForm.reset();
                        selectedFileName.textContent = '';
                        uploadBtn.disabled = true;
                        
                        // Reload documents list
                        loadDocuments();
                    } else {
                        throw new Error(data.error || 'Upload failed');
                    }
                } catch (error) {
                    console.error('Upload error:', error);
                    uploadStatus.innerHTML = \`❌ Upload failed: \${error.message}\`;
                    uploadStatus.className = 'upload-status error';
                } finally {
                    uploadBtn.disabled = false;
                    uploadBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Upload Document';
                }
            });
        }
        
        async function loadDocuments() {
            const documentsList = document.getElementById('documentsList');
            
            try {
                const response = await fetch('/documents');
                const data = await response.json();
                
                if (data.success) {
                    if (data.documents.length === 0) {
                        documentsList.innerHTML = '<div class="no-documents">No documents uploaded yet. Upload your first document to get started!</div>';
                    } else {
                        documentsList.innerHTML = data.documents.map(doc => \`
                            <div class="document-item">
                                <div class="document-info">
                                    <div class="name" title="\${doc.name}">\${doc.name}</div>
                                    <div class="type">\${doc.type.includes('pdf') ? 'PDF' : 'Word'}</div>
                                    <div class="upload-date">\${new Date(doc.uploadDate).toLocaleDateString()}</div>
                                    <div class="text-length">\${doc.textLength.toLocaleString()} chars</div>
                                </div>
                                <div class="actions">
                                    <button class="delete-btn" onclick="deleteDocument('\${doc.id}')">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                            <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        \`).join('');
                    }
                } else {
                    documentsList.innerHTML = '<div class="error">Failed to load documents</div>';
                }
            } catch (error) {
                console.error('Error loading documents:', error);
                documentsList.innerHTML = '<div class="error">Error loading documents</div>';
            }
        }
        
        async function deleteDocument(documentId) {
            if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
                return;
            }
            
            try {
                const response = await fetch(\`/documents/\${documentId}\`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Reload documents list
                    loadDocuments();
                } else {
                    alert('Failed to delete document: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Error deleting document:', error);
                alert('Error deleting document: ' + error.message);
            }
        }
    </script>
</body>
</html>`;
  
  res.send(html);
});

// Chat endpoint for web interface
app.post('/chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`Web chat request: ${message}`);
    
    // Use the same conversation ID system as Telegram
    const chatId = conversationId || 'web-user';
    console.log(`Using chatId: ${chatId}`);
    
    // Call the exact same function that Telegram uses
    console.log('Calling callAzureOpenAI...');
    const response = await callAzureOpenAI(chatId, message);
    console.log('callAzureOpenAI completed, response:', response);
    
    // Get sources from the conversation history
    const sources = [];
    const conversationHistory = history.get(chatId);
    console.log('Conversation history:', conversationHistory);
    
    if (conversationHistory && conversationHistory.length > 0) {
      // Look for the last system message that contains sources
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role === 'system' && msg.content.includes('SOURCES:')) {
          // Extract sources from the content
          const sourcesMatch = msg.content.match(/\[#(\d+)\]\s*(.*?)\n(.*?)\nSource:\s*(.*?)(?=\n\n|$)/gs);
          if (sourcesMatch) {
            sourcesMatch.forEach(match => {
              const [, num, title, content, url] = match.match(/\[#(\d+)\]\s*(.*?)\n(.*?)\nSource:\s*(.*?)(?=\n\n|$)/s);
              sources.push({
                title: title.trim(),
                content: content.trim(),
                url: url.trim()
              });
            });
          }
          break;
        }
      }
    }
    
    console.log('Sources found:', sources);
    
    res.json({
      success: true,
      response: response,
      sources: sources,
      timestamp: new Date().toISOString(),
      conversationId: chatId
    });
    
  } catch (error) {
    console.error('Web chat error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to process message',
      details: error.message 
    });
  }
});

// File upload endpoint
app.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log('File uploaded:', req.file.originalname, 'Size:', req.file.size);
    
    // Process the document
    const documentInfo = await processDocument(
      req.file.path,
      req.file.originalname,
      req.file.mimetype
    );
    
    // Clean up uploaded file
    await fs.remove(req.file.path);
    
    res.json({
      success: true,
      message: 'Document processed successfully',
      document: documentInfo
    });
    
  } catch (error) {
    console.error('File upload error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      await fs.remove(req.file.path).catch(console.error);
    }
    
    res.status(500).json({
      error: 'Failed to process document',
      details: error.message
    });
  }
});

// Get uploaded documents list
app.get('/documents', (req, res) => {
  try {
    const documents = Array.from(uploadedDocuments.values()).map(doc => ({
      id: doc.id,
      name: doc.originalName,
      type: doc.mimeType,
      uploadDate: doc.uploadDate,
      textLength: doc.textLength,
      chunks: doc.chunks,
      embeddings: doc.embeddings
    }));
    
    res.json({
      success: true,
      documents: documents
    });
  } catch (error) {
    console.error('Error getting documents:', error);
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

// Delete uploaded document
app.delete('/documents/:id', async (req, res) => {
  try {
    const documentId = req.params.id;
    const documentInfo = uploadedDocuments.get(documentId);
    
    if (!documentInfo) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Remove from memory
    uploadedDocuments.delete(documentId);
    
    // Remove from disk
    const chunksPath = path.join(documentsDir, `${documentId}.json`);
    if (await fs.pathExists(chunksPath)) {
      await fs.remove(chunksPath);
    }
    
    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// This function is no longer needed - web chat now uses callAzureOpenAI directly

// Helper function for uptime formatting
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/* ==== Bot initialization ==== */
let bot;
let isWebhookMode = false;

async function initializeBot() {
  console.log('Starting bot initialization...');
  console.log('WEBHOOK_URL:', WEBHOOK_URL);
  console.log('NODE_ENV:', NODE_ENV);
  console.log('TELEGRAM_BOT_TOKEN exists:', !!TELEGRAM_BOT_TOKEN);
  
  if (WEBHOOK_URL && NODE_ENV === 'production') {
    // Webhook mode for production/pipeline
    console.log('Creating bot in webhook mode...');
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('Bot created, type:', typeof bot);
    console.log('Bot constructor:', TelegramBot);
    console.log('Bot prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(bot)));
    console.log('Bot own properties:', Object.getOwnPropertyNames(bot));
    console.log('Bot setWebhook method:', typeof bot.setWebhook);
    console.log('Bot handleUpdate method:', typeof bot.handleUpdate);
    
    // Check if it's a different method name
    console.log('Available methods containing "webhook":', 
      Object.getOwnPropertyNames(Object.getPrototypeOf(bot)).filter(m => m.toLowerCase().includes('webhook')));
    console.log('Available methods containing "update":', 
      Object.getOwnPropertyNames(Object.getPrototypeOf(bot)).filter(m => m.toLowerCase().includes('update')));
    
    isWebhookMode = true;
    
    // Set up bot handlers FIRST
    console.log('Setting up bot handlers...');
    setupBotHandlers(bot);
    
    // Try different webhook methods
    try {
      console.log('Setting webhook...');
      // Ensure proper URL construction - don't remove protocol slashes
      const webhookUrl = WEBHOOK_URL.endsWith('/') 
        ? `${WEBHOOK_URL}${WEBHOOK_PATH.slice(1)}` 
        : `${WEBHOOK_URL}${WEBHOOK_PATH}`;
      console.log('Constructed webhook URL:', webhookUrl);
      
      if (typeof bot.setWebHook === 'function') {
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
      } else if (typeof bot.setWebhook === 'function') {
        await bot.setWebhook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
      } else if (typeof bot.setWebhookUrl === 'function') {
        await bot.setWebhookUrl(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
      } else {
        // Try to find the correct method
        const webhookMethod = Object.getOwnPropertyNames(Object.getPrototypeOf(bot)).find(m => 
          m.toLowerCase().includes('webhook') && typeof bot[m] === 'function'
        );
        if (webhookMethod) {
          console.log(`Found webhook method: ${webhookMethod}`);
          await bot[webhookMethod](webhookUrl);
          console.log(`Webhook set to: ${webhookUrl}`);
        } else {
          throw new Error('No webhook method found on bot object');
        }
      }
    } catch (error) {
      console.error('Failed to set webhook:', error);
      throw error;
    }
    
    console.log('Bot running in webhook mode');
  } else {
    // Polling mode for development
    console.log('Creating bot in polling mode...');
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('Bot created, type:', typeof bot);
    console.log('Bot constructor:', TelegramBot);
    console.log('Bot prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(bot)));
    console.log('Bot own properties:', Object.getOwnPropertyNames(bot));
    console.log('Bot setWebhook method:', typeof bot.setWebhook);
    console.log('Bot handleUpdate method:', typeof bot.handleUpdate);
    
    // Set up bot handlers for polling mode
    console.log('Setting up bot handlers...');
    setupBotHandlers(bot);
    
    console.log('Bot running in polling mode');
  }
}

/* ==== Clients ==== */
const searchClient = new SearchClient(
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_INDEX,
  new AzureKeyCredential(AZURE_SEARCH_API_KEY)
);

/* ==== Simple in-memory chat history ==== */
const history = new Map(); // chatId -> [{role, content}, ...]
const SYSTEM_PROMPT =
  'You are a helpful, concise assistant on Telegram. Prefer short, clear answers. Cite sources when provided.';

/* ==== Embeddings + Retrieval ==== */
async function embedText(text) {
  const cachedEmbedding = embeddingCache.get(text);
  if (cachedEmbedding) {
    return cachedEmbedding;
  }

  const r = await axios.post(
    AZURE_OPENAI_EMBEDDINGS_URL,
    { input: text },
    {
      headers: {
        'api-key': AZURE_OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );
  const embedding = r.data?.data?.[0]?.embedding;
  embeddingCache.set(text, embedding);
  return embedding;
}

/* ==== Document Processing Functions ==== */
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

async function extractTextFromWord(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error('Error extracting text from Word document:', error);
    throw new Error('Failed to extract text from Word document');
  }
}

async function processDocument(filePath, originalName, mimeType) {
  let text;
  
  if (mimeType === 'application/pdf') {
    text = await extractTextFromPDF(filePath);
  } else if (mimeType.includes('word')) {
    text = await extractTextFromWord(filePath);
  } else {
    throw new Error('Unsupported file type');
  }
  
  // Clean and chunk the text
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  
  // Split into chunks (roughly 1000 characters each)
  const chunks = [];
  const chunkSize = 1000;
  const overlap = 200;
  
  for (let i = 0; i < cleanedText.length; i += chunkSize - overlap) {
    const chunk = cleanedText.slice(i, i + chunkSize);
    if (chunk.trim().length > 50) { // Only add chunks with meaningful content
      chunks.push(chunk);
    }
  }
  
  // Process embeddings in parallel batches for better performance
  const embeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (chunk) => {
      const embedding = await embedText(chunk);
      return embedding ? { content: chunk, contentVector: embedding } : null;
    });
    
    const batchResults = await Promise.all(batchPromises);
    embeddings.push(...batchResults.filter(Boolean));
  }
  
  // Store document info
  const documentId = uuidv4();
  const documentInfo = {
    id: documentId,
    originalName,
    mimeType,
    uploadDate: new Date().toISOString(),
    textLength: cleanedText.length,
    chunks: chunks.length,
    embeddings: embeddings.length
  };
  
  uploadedDocuments.set(documentId, documentInfo);
  
  // Store processed chunks
  const chunksPath = path.join(documentsDir, `${documentId}.json`);
  await fs.writeJson(chunksPath, {
    documentInfo,
    chunks: embeddings
  });
  
  return documentInfo;
}

/**
 * Hybrid vector + keyword search (vector query + text query)
 * Returns top K docs with title, url, content
 */
async function retrieve(question, k = 4) {
  const vector = await embedText(question);
  if (!Array.isArray(vector)) return [];

  // Run both searches in parallel for better performance
  const [azureResults, uploadedResults] = await Promise.all([
    searchAzureIndex(question, vector, k),
    searchUploadedDocuments(question, vector, k)
  ]);
  
  // Combine and rank results
  const allResults = [...azureResults, ...uploadedResults];
  
  // Sort by relevance and return top k
  return allResults
    .sort((a, b) => {
      // Prioritize Azure Search results slightly
      const aScore = a.source === 'azure_search' ? (a.similarity || 0) + 0.01 : (a.similarity || 0);
      const bScore = b.source === 'azure_search' ? (b.similarity || 0) + 0.01 : (b.similarity || 0);
      return bScore - aScore;
    })
    .slice(0, k);
}

async function searchAzureIndex(question, vector, k) {
  try {
    const searchResults = await searchClient.search(question, {
      top: k,
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector',
            vector,
            fields: ['contentVector'],
            kNearestNeighborsCount: k
          }
        ]
      }
    });

    const results = [];
    for await (const r of searchResults.results) {
      const d = r.document;
      results.push({
        title: d.title,
        url: d.url,
        content: d.content,
        source: 'azure_search',
        similarity: 0.8 // Default similarity for Azure results
      });
    }
    return results;
  } catch (error) {
    console.error('Azure Search error:', error);
    return [];
  }
}

async function searchUploadedDocuments(question, vector, k) {
  const results = [];
  const similarityThreshold = 0.1; // Only consider results above this threshold
  
  // Process documents in parallel for better performance
  const documentPromises = Array.from(uploadedDocuments.entries()).map(async ([documentId, documentInfo]) => {
    try {
      const chunksPath = path.join(documentsDir, `${documentId}.json`);
      if (await fs.pathExists(chunksPath)) {
        const documentData = await fs.readJson(chunksPath);
        
        // Calculate similarity for each chunk
        const chunkResults = [];
        for (const chunk of documentData.chunks) {
          if (chunk.contentVector && Array.isArray(chunk.contentVector)) {
            const similarity = calculateCosineSimilarity(vector, chunk.contentVector);
            if (similarity > similarityThreshold) {
              chunkResults.push({
                title: documentInfo.originalName,
                url: `uploaded://${documentId}`,
                content: chunk.content,
                source: 'uploaded_document',
                similarity: similarity,
                documentId: documentId
              });
            }
          }
        }
        
        // Sort chunks by similarity and take top results
        return chunkResults
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, Math.ceil(k / 2)); // Limit per document
      }
      return [];
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      return [];
    }
  });
  
  // Wait for all documents to be processed
  const allResults = await Promise.all(documentPromises);
  
  // Flatten and sort all results by similarity
  const flattenedResults = allResults.flat();
  return flattenedResults
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

function calculateCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  // Early termination if vectors are too different
  let earlyTermination = false;
  
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
    
    // Early termination check - if norms are too different, similarity will be low
    if (i > 100 && Math.abs(normA - normB) > 10) {
      earlyTermination = true;
      break;
    }
  }
  
  if (earlyTermination || normA === 0 || normB === 0) return 0;
  
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  
  // Return 0 for very low similarities to improve performance
  return similarity > 0.05 ? similarity : 0;
}

/* ==== Chat call with RAG context ==== */
async function callAzureOpenAI(chatId, userText) {
  console.log(`callAzureOpenAI called with chatId: ${chatId}, userText: ${userText}`);
  
  const prior = history.get(chatId) || [];
  console.log(`Prior conversation history length: ${prior.length}`);

  // 1) Retrieve relevant passages
  let contextBlock = 'No relevant sources found.';
  try {
    console.log('Calling retrieve function...');
    const passages = await retrieve(userText, 4);
    console.log(`Retrieved ${passages.length} passages`);
    
    if (passages.length) {
      contextBlock = passages
        .map(
          (p, i) => {
            const sourceInfo = p.source === 'uploaded_document' 
              ? `Uploaded Document: ${p.title}`
              : p.url || 'Unknown Source';
            return `[#${i + 1}] ${p.title ?? 'Untitled'}\n${p.content ?? ''}\nSource: ${sourceInfo}`;
          }
        )
        .join('\n\n');
    }
  } catch (e) {
    console.error('Search/Retrieval error:', e?.response?.data || e.message);
  }

  // 2) Build messages (keep short history to control tokens)
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content:
        'SOURCES below are excerpts from your knowledge base. When answering, (a) rely primarily on SOURCES, (b) quote concisely if helpful, and (c) cite like [#1]. If insufficient, say you do not know.'
    },
    { role: 'system', content: `SOURCES:\n${contextBlock}` },
    ...prior.slice(-4),
    { role: 'user', content: userText }
  ];

  // 3) Call Azure OpenAI chat (using full URL from .env)
  try {
    console.log('Calling Azure OpenAI with URL:', AZURE_OPENAI_URL);
    console.log('Messages being sent:', JSON.stringify(messages, null, 2));
    
    const r = await axios.post(
      AZURE_OPENAI_URL,
      { messages, temperature: 0.2 },
      {
        headers: {
          'api-key': AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('Azure OpenAI response received');
    const reply = r.data?.choices?.[0]?.message?.content?.trim() || '…';
    console.log('Reply content:', reply);
    
    // Save to memory
    history.set(chatId, [
      ...prior,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ]);
    console.log('Conversation saved to history');
    return reply;
  } catch (e) {
    console.error('Azure OpenAI error:', e?.response?.status, e?.response?.data || e.message);
    console.error('Full error object:', e);
    throw e;
  }
}

/* ==== Telegram handlers ==== */
function setupBotHandlers(bot) {
  bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      'Hi! I\'m connected to Azure GPT-4 with RAG. Send me a message and I\'ll try to answer using your indexed sources.'
    );
  });

  bot.onText(/^\/reset/, async (msg) => {
    history.delete(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'Conversation memory cleared.');
  });

  // Main message handler
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Ignore non-text or commands (handled above)
    if (!text || text.startsWith('/')) return;

    // Typing indicator
    bot.sendChatAction(chatId, 'typing');

    try {
      const reply = await callAzureOpenAI(chatId, text);

      // Telegram max ~4096 chars; keep margin
      const chunks = reply.match(/[\s\S]{1,3800}/g) || [reply];
      for (const c of chunks) {
        await bot
          .sendMessage(chatId, c, { parse_mode: 'Markdown' })
          .catch(async () => await bot.sendMessage(chatId, c)); // fallback if Markdown fails
      }
    } catch {
      await bot.sendMessage(
        chatId,
        'Sorry, I hit an error reaching the AI. Please try again.'
      );
    }
  });
}

/* ==== Server startup and graceful shutdown ==== */
async function startServer() {
  try {
    await initializeBot();
    
    // Set up webhook endpoint AFTER bot is initialized (for webhook mode)
    if (isWebhookMode) {
      console.log('Setting up webhook endpoint...');
      app.post(WEBHOOK_PATH, async (req, res) => {
        console.log('Webhook received!');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('Request headers:', req.headers);
        
        try {
          if (typeof bot.processUpdate === 'function') {
            console.log('Using processUpdate method');
            await bot.processUpdate(req.body);
          } else if (typeof bot.handleUpdate === 'function') {
            console.log('Using handleUpdate method');
            await bot.handleUpdate(req.body);
          } else {
            // Try to find the correct method
            const updateMethod = Object.getOwnPropertyNames(Object.getPrototypeOf(bot)).find(m => 
              (m.toLowerCase().includes('update') || m.toLowerCase().includes('process')) && typeof bot[m] === 'function'
            );
            if (updateMethod) {
              console.log(`Found update method: ${updateMethod}`);
              await bot[updateMethod](req.body);
            } else {
              throw new Error('No update handling method found on bot object');
            }
          }
          console.log('Webhook processed successfully');
          res.sendStatus(200);
        } catch (error) {
          console.error('Webhook error:', error);
          res.sendStatus(500);
        }
      });
      console.log(`Webhook endpoint set up at ${WEBHOOK_PATH}`);
    }

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🤖 Bot mode: ${isWebhookMode ? 'Webhook' : 'Polling'}`);
      if (isWebhookMode) {
        const cleanWebhookUrl = WEBHOOK_URL.endsWith('/') 
          ? `${WEBHOOK_URL}${WEBHOOK_PATH.slice(1)}` 
          : `${WEBHOOK_URL}${WEBHOOK_PATH}`;
        console.log(`🔗 Webhook URL: ${cleanWebhookUrl}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (bot && isWebhookMode) {
    try {
      await bot.deleteWebhook();
      console.log('Webhook deleted');
    } catch (error) {
      console.error('Error deleting webhook:', error);
    }
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (bot && isWebhookMode) {
    try {
      await bot.deleteWebhook();
      console.log('Webhook deleted');
    } catch (error) {
      console.error('Error deleting webhook:', error);
    }
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
