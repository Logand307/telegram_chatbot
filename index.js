// index.js — Telegram bot + RAG (Azure AI Search) + Azure OpenAI (Option B full URL)
require('dotenv/config');
const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const express = require('express');
const { createServer } = require('http');

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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            color: white;
        }
        
        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
        }
        
        .card h3 {
            color: #667eea;
            margin-bottom: 16px;
            font-size: 1.3rem;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            background: #10b981;
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
            color: #667eea;
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
            color: #666;
            margin-bottom: 4px;
        }
        
        .info-value {
            font-weight: bold;
            color: #333;
        }
        
        .features {
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .features h3 {
            color: #667eea;
            margin-bottom: 20px;
            font-size: 1.3rem;
        }
        
        .feature-list {
            list-style: none;
        }
        
        .feature-list li {
            padding: 12px 0;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
        }
        
        .feature-list li:last-child {
            border-bottom: none;
        }
        
        .feature-icon {
            color: #10b981;
            margin-right: 12px;
            font-size: 1.2rem;
        }
        
        .chat-interface {
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        .chat-interface h3 {
            color: #667eea;
            margin-bottom: 20px;
            font-size: 1.3rem;
        }
        
        .chat-container {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            overflow: hidden;
        }
        
        .chat-messages {
            height: 400px;
            overflow-y: auto;
            padding: 20px;
            background: #f9fafb;
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
            background: #667eea;
            color: white;
            border-bottom-right-radius: 6px;
        }
        
        .bot-message .message-content {
            background: white;
            color: #333;
            border: 1px solid #e5e7eb;
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
            background: white;
            border-top: 1px solid #e5e7eb;
        }
        
        .chat-form {
            display: flex;
            gap: 12px;
        }
        
        .chat-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #d1d5db;
            border-radius: 24px;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.2s;
        }
        
        .chat-input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .chat-send-btn {
            background: #667eea;
            color: white;
            border: none;
            border-radius: 50%;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .chat-send-btn:hover {
            background: #5a67d8;
        }
        
        .chat-send-btn:disabled {
            background: #9ca3af;
            cursor: not-allowed;
        }
        
        .footer {
            text-align: center;
            margin-top: 40px;
            color: white;
            opacity: 0.8;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .dashboard {
                grid-template-columns: 1fr;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Telegram RAG Bot</h1>
            <p>AI-Powered Knowledge Assistant with Azure OpenAI & Search</p>
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
                        <div class="info-value"><a href="/health" style="color: #667eea;">/health</a></div>
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
            </ul>
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
  return r.data?.data?.[0]?.embedding;
}

/**
 * Hybrid vector + keyword search (vector query + text query)
 * Returns top K docs with title, url, content
 */
async function retrieve(question, k = 4) {
  const vector = await embedText(question);
  if (!Array.isArray(vector)) return [];

  const results = await searchClient.search(question, {
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
    // You can add semantic options later if you configure them on the index
    // semanticSearchOptions: { queryCaption: 'extractive', queryAnswer: 'extractive', semanticConfigurationName: '<name>' }
  });

  const hits = [];
  for await (const r of results.results) {
    const d = r.document;
    hits.push({
      title: d.title,
      url: d.url,
      content: d.content
    });
  }
  return hits;
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
          (p, i) =>
            `[#${i + 1}] ${p.title ?? 'Untitled'}\n${p.content ?? ''}\nSource: ${p.url ?? ''}`
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
