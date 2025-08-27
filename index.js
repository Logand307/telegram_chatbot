// index.js — Telegram bot + RAG (Azure AI Search) + Azure OpenAI (Option B full URL)
require('dotenv/config');
const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const axios = require('axios');
const { SearchClient, AzureKeyCredential, SearchIndexClient } = require('@azure/search-documents');
const express = require('express');
const { createServer } = require('http');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/* ==== Warm-up and Health Check Functions ==== */
async function testAzureOpenAI() {
  console.log('🔍 Testing Azure OpenAI connection...');
  try {
    // Test embeddings endpoint
    const testText = 'test';
    const response = await axios.post(
      AZURE_OPENAI_EMBEDDINGS_URL,
      { input: testText },
      {
        headers: {
          'api-key': AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    if (response.data?.data?.[0]?.embedding) {
      console.log('✅ Azure OpenAI embeddings: OK');
      return true;
    } else {
      console.log('❌ Azure OpenAI embeddings: Invalid response format');
      return false;
    }
  } catch (error) {
    // Handle specific network errors more gracefully
    if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
      console.warn('⚠️ Azure OpenAI network error (DNS/connectivity issue):', error.message);
      console.warn('💡 This may be a temporary network issue or incorrect URL configuration');
    } else if (error.code === 'ECONNREFUSED') {
      console.warn('⚠️ Azure OpenAI connection refused - service may be down or URL incorrect');
    } else if (error.response?.status === 401) {
      console.warn('⚠️ Azure OpenAI authentication failed - check API key');
    } else if (error.response?.status === 404) {
      console.warn('⚠️ Azure OpenAI endpoint not found - check URL configuration');
    } else {
      console.error('❌ Azure OpenAI embeddings test failed:', error.message);
    }
    return false;
  }
}

async function testAzureSearch() {
  console.log('🔍 Testing Azure Search connection...');
  try {
    // Test search client
    const searchClient = new SearchClient(
      AZURE_SEARCH_ENDPOINT,
      AZURE_SEARCH_INDEX,
      new AzureKeyCredential(AZURE_SEARCH_API_KEY)
    );
    
    // Test basic search operation with timeout
    const results = await Promise.race([
      searchClient.search('test', { top: 1 }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Azure Search timeout')), 15000)
      )
    ]);
    
    console.log('✅ Azure Search: OK');
    return true;
  } catch (error) {
    // Handle specific network errors more gracefully
    if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
      console.warn('⚠️ Azure Search network error (DNS/connectivity issue):', error.message);
      console.warn('💡 This may be a temporary network issue or incorrect endpoint configuration');
    } else if (error.message.includes('timeout')) {
      console.warn('⚠️ Azure Search timeout - service may be slow to respond');
    } else {
      console.error('❌ Azure Search test failed:', error.message);
    }
    return false;
  }
}

async function ensureSearchIndex() {
  console.log('🔍 Ensuring Azure Search index exists...');
  try {
    const indexClient = new SearchIndexClient(
      AZURE_SEARCH_ENDPOINT,
      new AzureKeyCredential(AZURE_SEARCH_API_KEY)
    );
    
    // Check if index exists
    try {
      await indexClient.getIndex(AZURE_SEARCH_INDEX);
      console.log('✅ Azure Search index exists');
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        console.log('⚠️ Azure Search index not found, creating...');
        const indexDefinition = {
          name: AZURE_SEARCH_INDEX,
          fields: [
            { name: 'id', type: 'Edm.String', key: true },
            { name: 'title', type: 'Edm.String', searchable: true },
            { name: 'url', type: 'Edm.String', filterable: true, searchable: true },
            { name: 'content', type: 'Edm.String', searchable: true },
            {
              name: 'contentVector',
              type: 'Collection(Edm.Single)',
              searchable: true,
              vectorSearchDimensions: 1536,
              vectorSearchProfileName: 'myHnswProfile'
            }
          ],
          vectorSearch: {
            algorithms: [
              { name: 'myHnsw', kind: 'hnsw' }
            ],
            profiles: [
              { name: 'myHnswProfile', algorithmConfigurationName: 'myHnsw' }
            ]
          }
        };
        
        await indexClient.createIndex(indexDefinition);
        console.log('✅ Azure Search index created successfully');
        return true;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Failed to ensure Azure Search index:', error.message);
    return false;
  }
}

async function warmUpServices() {
  console.log('🚀 Starting service warm-up routine...');
  const startTime = Date.now();
  
  const results = {
    azureOpenAI: false,
    azureSearch: false,
    searchIndex: false,
    localSearch: false
  };
  
  // Test Azure OpenAI
  results.azureOpenAI = await testAzureOpenAI();
  
  // Test Azure Search
  results.azureSearch = await testAzureSearch();
  
  // Ensure search index exists
  results.searchIndex = await ensureSearchIndex();
  
  // Test local document search functionality
  results.localSearch = await testLocalSearch();
  
  const warmUpTime = Date.now() - startTime;
  console.log(`⏱️ Warm-up completed in ${warmUpTime}ms`);
  console.log('📊 Warm-up results:', results);
  
  return results;
}

async function testLocalSearch() {
  console.log('🔍 Testing local document search functionality...');
  try {
    // Test if we can access the documents directory
    if (!await fs.pathExists(documentsDir)) {
      console.log('✅ Documents directory exists');
      return true;
    }
    
    // Test if we can read from the documents directory
    const files = await fs.readdir(documentsDir);
    console.log(`✅ Local search test: Found ${files.length} document files`);
    
    // Test a simple search operation if there are documents
    if (files.length > 0 && uploadedDocuments.size > 0) {
      try {
        // Create a simple test vector (all zeros for testing)
        const testVector = new Array(1536).fill(0);
        
        // Test search with a simple query
        const testResults = await searchUploadedDocuments('test', testVector, 1);
        console.log(`✅ Local search test: Search operation successful, found ${testResults.length} results`);
      } catch (searchError) {
        console.warn('⚠️ Local search test: Search operation failed, but directory access is working:', searchError.message);
        // Don't fail the test if search fails, just directory access is enough
      }
    }
    
    return true;
  } catch (error) {
    console.warn('⚠️ Local search test failed:', error.message);
    return false;
  }
}

/* ==== Retry Logic with Exponential Backoff ==== */
async function retryWithBackoff(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`⚠️ Operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt === maxRetries) {
        console.error(`❌ Operation failed after ${maxRetries} attempts`);
        throw lastError;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.log(`⏳ Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/* ==== Comprehensive Upload Process Logging ==== */
function logUploadProcess(phase, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    phase,
    ...details
  };
  
  console.log(`📋 [UPLOAD] ${phase}:`, JSON.stringify(logEntry, null, 2));
  
  // Store in memory for debugging (keep last 100 entries)
  if (!global.uploadLogs) {
    global.uploadLogs = [];
  }
  
  global.uploadLogs.push(logEntry);
  if (global.uploadLogs.length > 100) {
    global.uploadLogs.shift();
  }
}

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

// Periodic health check for failed services (every 2 minutes)
let healthCheckInterval;
function startHealthCheck() {
  healthCheckInterval = setInterval(async () => {
    try {
      const results = await warmUpServices();
      const allReady = results.azureOpenAI && results.azureSearch && results.searchIndex;
      
      if (allReady) {
        console.log('✅ All services are now healthy!');
        // Stop health checks if all services are ready
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }
      } else {
        console.log('⚠️ Some services still unhealthy:', results);
      }
    } catch (error) {
      console.warn('⚠️ Health check failed:', error.message);
    }
  }, 2 * 60 * 1000); // Check every 2 minutes
}

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
    uptime: process.uptime(),
    search_ready: uploadedDocuments.size > 0 ? 'ready' : 'no_documents',
    documents_count: uploadedDocuments.size
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

// Manual warm-up trigger endpoint
app.post('/warmup', async (req, res) => {
  try {
    console.log('🔥 Manual warm-up triggered via API');
    const results = await warmUpServices();
    
    res.json({
      success: true,
      message: 'Warm-up completed',
      timestamp: new Date().toISOString(),
      results: results,
      allServicesReady: results.azureOpenAI && results.azureSearch && results.searchIndex
    });
  } catch (error) {
    console.error('❌ Manual warm-up failed:', error);
    res.status(500).json({
      success: false,
      error: 'Warm-up failed',
      details: error.message
    });
  }
});

// Service status endpoint
app.get('/status', async (req, res) => {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: NODE_ENV,
      services: {
        azure_openai: {
          configured: !!(AZURE_OPENAI_URL && AZURE_OPENAI_API_KEY),
          url: AZURE_OPENAI_URL ? 'Configured' : 'Missing',
          api_key: AZURE_OPENAI_API_KEY ? 'Configured' : 'Missing'
        },
        azure_search: {
          configured: !!(AZURE_SEARCH_ENDPOINT && AZURE_SEARCH_API_KEY && AZURE_SEARCH_INDEX),
          endpoint: AZURE_SEARCH_ENDPOINT ? 'Configured' : 'Missing',
          api_key: AZURE_SEARCH_API_KEY ? 'Configured' : 'Missing',
            index: AZURE_SEARCH_INDEX ? 'Configured' : 'Missing'
        }
      },
      documents: {
        uploaded: uploadedDocuments.size,
        cache_size: embeddingCache.size
      }
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to view upload logs for debugging
app.get('/upload-logs', (req, res) => {
  try {
    const logs = global.uploadLogs || [];
    res.json({
      success: true,
      logs: logs,
      count: logs.length,
      timestamp: new Date().toISOString()
    });
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
    <title>RecallAI</title>
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
             box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
             display: flex;
             flex-direction: column;
             height: 800px;
             max-height: 800px;
             position: relative;
         }
        
        .chat-interface h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
            flex-shrink: 0;
        }
        
        .chat-container {
            border: 1px solid #30363d;
            border-radius: 8px;
            overflow: hidden;
            background: #0d1117;
            flex: 1;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        
                 .chat-messages {
             flex: 1;
             overflow-y: auto;
             padding: 20px;
             background: #0d1117;
             max-height: 700px;
             height: 700px;
         }
         
         .chat-messages::-webkit-scrollbar {
             width: 8px;
         }
         
         .chat-messages::-webkit-scrollbar-track {
             background: #0d1117;
             border-radius: 4px;
         }
         
         .chat-messages::-webkit-scrollbar-thumb {
             background: #30363d;
             border-radius: 4px;
         }
         
         .chat-messages::-webkit-scrollbar-thumb:hover {
             background: #58a6ff;
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
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
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
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
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
            display: flex;
            flex-direction: column;
            min-height: 600px;
        }
        
        .features h3 {
            color: #58a6ff;
            margin-bottom: 20px;
            font-size: 1.4rem;
            font-weight: 600;
            flex-shrink: 0;
        }
        
        .feature-list {
            list-style: none;
            margin-bottom: 20px;
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
        
                 .upload-section {
             margin-bottom: 30px;
         }
         
         .upload-section h4 {
             color: #e6edf3;
             margin-bottom: 16px;
             font-size: 1.1rem;
             font-weight: 600;
         }
         
         .documents-section-separate {
             background: #161b22;
             border: 1px solid #30363d;
             border-radius: 12px;
             padding: 24px;
             box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
         }
         
         .documents-section-separate h4 {
             color: #e6edf3;
             margin-bottom: 16px;
             font-size: 1.1rem;
             font-weight: 600;
         }
         
         .documents-header {
             display: flex;
             justify-content: space-between;
             align-items: center;
             margin-bottom: 16px;
             padding: 12px 16px;
             background: #0d1117;
             border: 1px solid #30363d;
             border-radius: 8px;
         }
         
         .documents-count {
             color: #8b949e;
             font-size: 0.9rem;
             font-weight: 500;
         }
         
         .refresh-btn {
             background: #30363d;
             color: #e6edf3;
             border: 1px solid #58a6ff;
             border-radius: 6px;
             width: 32px;
             height: 32px;
             display: flex;
             align-items: center;
             justify-content: center;
             cursor: pointer;
             transition: all 0.2s ease;
         }
         
         .refresh-btn:hover {
             background: #58a6ff;
             color: white;
             transform: scale(1.1);
         }
        
                 .upload-section p {
             margin-bottom: 20px;
             color: #8b949e;
             font-size: 0.9rem;
             line-height: 1.5;
         }
        

         
         .upload-container {
             background: #0d1117;
             border: 2px dashed #30363d;
             border-radius: 12px;
             padding: 24px;
             text-align: center;
             margin-bottom: 20px;
             transition: all 0.3s ease;
             position: relative;
             overflow: hidden;
         }
         
         .upload-container:hover {
             border-color: #58a6ff;
             box-shadow: 0 4px 16px rgba(88, 166, 255, 0.1);
         }
         
         .upload-container.drag-over {
             border-color: #238636;
             background: #0c532a;
             transform: scale(1.02);
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
             max-width: 100%;
         }
         
                   .file-input {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              opacity: 0;
              cursor: pointer;
              z-index: 1;
          }
         
                   .file-input-label {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 12px;
              padding: 24px 20px;
              background: #21262d;
              border: 2px dashed #30363d;
              border-radius: 12px;
              color: #58a6ff;
              cursor: pointer;
              transition: all 0.3s ease;
              min-height: 120px;
              justify-content: center;
              width: 100%;
              position: relative;
              z-index: 5;
          }
         
         .file-input-label:hover {
             background: #30363d;
             border-color: #58a6ff;
             transform: translateY(-2px);
         }
         
         .file-input-label svg {
             width: 40px;
             height: 40px;
             color: #58a6ff;
             transition: all 0.3s ease;
         }
         
         .file-input-label:hover svg {
             transform: scale(1.1);
         }
         
         .upload-text {
             font-size: 1.1rem;
             font-weight: 600;
             color: #58a6ff;
         }
         
         .upload-hint {
             font-size: 0.9rem;
             color: #8b949e;
             opacity: 0.8;
         }
         
                   .selected-file-info {
              display: flex;
              align-items: center;
              gap: 16px;
              background: #0c532a;
              border: 1px solid #238636;
              border-radius: 8px;
              padding: 16px 20px;
              margin-top: 16px;
              width: 100%;
              max-width: 400px;
              position: relative;
              z-index: 15;
          }
         
         .file-icon {
             font-size: 2rem;
             flex-shrink: 0;
         }
         
         .file-details {
             flex: 1;
             min-width: 0;
         }
         
         .file-name {
             font-weight: 600;
             color: #e6edf3;
             margin-bottom: 4px;
             word-break: break-all;
         }
         
         .file-size {
             font-size: 0.85rem;
             color: #8b949e;
         }
         
                   .remove-file-btn {
              background: #da3633;
              color: white;
              border: none;
              border-radius: 6px;
              width: 32px;
              height: 32px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.2s ease;
              flex-shrink: 0;
              position: relative;
              z-index: 20;
          }
         
         .remove-file-btn:hover {
             background: #f85149;
             transform: scale(1.1);
         }
        
                 .upload-btn {
             background: #1f6feb;
             color: white;
             border: none;
             border-radius: 8px;
             padding: 16px 24px;
             cursor: pointer;
             display: flex;
             align-items: center;
             gap: 12px;
             transition: all 0.3s ease;
             font-size: 1rem;
             font-weight: 600;
             width: 100%;
             justify-content: center;
             position: relative;
             overflow: hidden;
         }
         
         .upload-btn:hover {
             background: #1f6feb;
             opacity: 0.9;
             transform: translateY(-2px);
             box-shadow: 0 4px 12px rgba(31, 111, 235, 0.3);
         }
         
         .upload-btn:active {
             transform: translateY(0);
         }
         
         .upload-btn:disabled {
             background: #30363d;
             cursor: not-allowed;
             transform: none;
             box-shadow: none;
         }
         
                 .upload-btn-text {
            transition: all 0.3s ease;
        }
        
        .upload-btn:disabled .upload-btn-text {
            opacity: 0.6;
        }
        
        /* Processing animation styles */
        .processing-text {
            display: inline-block;
        }
        
        .processing-dots {
            display: inline-block;
            animation: processingDots 1.5s infinite;
        }
        
        @keyframes processingDots {
            0%, 20% { content: "Processing"; }
            40% { content: "Processing."; }
            60% { content: "Processing.."; }
            80%, 100% { content: "Processing..."; }
        }
        
        .processing-icon {
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .upload-btn.processing {
            animation: processingPulse 2s ease-in-out infinite;
        }
        
        @keyframes processingPulse {
            0%, 100% { 
                box-shadow: 0 4px 12px rgba(88, 166, 255, 0.3);
                transform: translateY(0);
            }
            50% { 
                box-shadow: 0 6px 20px rgba(88, 166, 255, 0.5);
                transform: translateY(-1px);
            }
        }
        
        /* Pulsing ellipsis animation for chat thinking state */
        .thinking-ellipsis {
            display: inline-block;
            animation: thinkingPulse 1.5s ease-in-out infinite;
        }
        
        @keyframes thinkingPulse {
            0%, 100% { 
                opacity: 0.4;
                transform: scale(1);
            }
            50% { 
                opacity: 1;
                transform: scale(1.1);
            }
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
        
        .documents-list {
            max-height: 400px;
            overflow-y: auto;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 16px;
        }
        
        .documents-list::-webkit-scrollbar {
            width: 8px;
        }
        
        .documents-list::-webkit-scrollbar-track {
            background: #0d1117;
            border-radius: 4px;
        }
        
        .documents-list::-webkit-scrollbar-thumb {
            background: #30363d;
            border-radius: 4px;
        }
        
        .documents-list::-webkit-scrollbar-thumb:hover {
            background: #58a6ff;
        }
        
        .document-item {
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 16px;
            transition: all 0.2s;
            margin-bottom: 12px;
        }
        
        .document-item:last-child {
            margin-bottom: 0;
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
            padding: 16px 0;
            border-bottom: 1px solid #30363d;
            display: flex;
            align-items: flex-start;
            gap: 16px;
        }
        
        .feature-list li:last-child {
            border-bottom: none;
        }
        
        .feature-icon {
            color: #58a6ff;
            font-size: 1.5rem;
            flex-shrink: 0;
            margin-top: 2px;
        }
        
        .feature-content {
            flex: 1;
            min-width: 0;
        }
        
        .feature-title {
            font-weight: 600;
            color: #e6edf3;
            margin-bottom: 4px;
            font-size: 0.95rem;
        }
        
        .feature-description {
            color: #8b949e;
            font-size: 0.85rem;
            line-height: 1.4;
        }
        
        .tech-stack {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #30363d;
        }
        
        .tech-stack h4 {
            color: #58a6ff;
            margin-bottom: 16px;
            font-size: 1.1rem;
            font-weight: 600;
        }
        
        .tech-grid {
            display: grid;
            gap: 12px;
        }
        
        .tech-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            transition: border-color 0.2s;
        }
        
        .tech-item:hover {
            border-color: #58a6ff;
        }
        
        .tech-name {
            font-weight: 600;
            color: #e6edf3;
            font-size: 0.9rem;
        }
        
                 .tech-desc {
             color: #8b949e;
             font-size: 0.8rem;
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
            
            .chat-interface {
                height: auto;
                max-height: none;
                min-height: 600px;
            }
            
            .features {
                height: auto;
                min-height: 500px;
            }
            
            .documents-list {
                max-height: 300px;
            }
            
            .dashboard {
                grid-template-columns: 1fr;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .upload-container {
                padding: 20px;
            }
            
            .file-input-label {
                min-height: 100px;
                padding: 20px 16px;
            }
            
            .file-input-wrapper {
                max-width: 100%;
            }
            
            .service-status-bar {
                flex-direction: column;
                gap: 16px;
                text-align: center;
            }
            
            .selected-file-info {
                flex-direction: column;
                text-align: center;
                gap: 12px;
            }
            
            .chat-interface {
                padding: 16px;
            }
            
            .chat-messages {
                height: 500px;
                max-height: 500px;
                min-height: 500px;
            }
            
            .chat-input-container {
                position: sticky;
                bottom: 0;
                background: #161b22;
                border-top: 1px solid #30363d;
                z-index: 10;
            }
            
            .container {
                padding: 16px;
            }
            
            .features {
                position: static;
            }
            
            .upload-btn {
                padding: 14px 20px;
                font-size: 0.95rem;
            }
            
            /* Mobile scrollbar fixes */
            .chat-messages::-webkit-scrollbar {
                width: 6px; /* Thinner scrollbar for mobile */
            }
            
            .documents-list::-webkit-scrollbar {
                width: 6px; /* Thinner scrollbar for mobile */
            }
            

         }
         
         @media (max-width: 480px) {
             .upload-container {
                 padding: 16px;
             }
             
             .file-input-label {
                 min-height: 80px;
                 padding: 16px 12px;
             }
             
             .upload-text {
                 font-size: 1rem;
             }
             
             .upload-hint {
                 font-size: 0.8rem;
             }
             
             .chat-input-container {
                 padding: 16px;
             }
             
             .chat-input {
                 font-size: 16px; /* Prevents zoom on iOS */
                 padding: 14px 16px;
             }
             
                         .chat-send-btn {
                width: 44px;
                height: 44px;
                min-width: 44px; /* Ensures button doesn't shrink */
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            
            .chat-form {
                gap: 8px;
            }
            
            /* Mobile scrollbar fixes */
            .chat-messages::-webkit-scrollbar {
                width: 6px; /* Thinner scrollbar for mobile */
            }
            
            .documents-list::-webkit-scrollbar {
                width: 6px; /* Thinner scrollbar for mobile */
            }
            

         }
    </style>
</head>
<body>
    <div class="container">
                    <div class="header">
                <h1>RecallAI</h1>
                <p>Intelligent answers, powered by GPT-4 and retrieval-augmented generation.</p>
            </div>
        
        <div class="chat-and-features">
            <div class="chat-interface">
                <h3>💬 Chat with Your Bot</h3>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="message bot-message">
                            <div class="message-content">
                                <div class="message-text">Hi! I'm your AI assistant. Ask me anything, and I'll combine reasoning with retrieval from my knowledge base. You can even upload your documents to expand what I know.</div>
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
                    <li>
                        <span class="feature-icon">🤖</span>
                        <div class="feature-content">
                            <div class="feature-title">GPT-4 + RAG</div>
                            <div class="feature-description">Advanced AI with knowledge retrieval</div>
                        </div>
                    </li>
                    <li>
                        <span class="feature-icon">🔍</span>
                        <div class="feature-content">
                            <div class="feature-title">Azure AI Search</div>
                            <div class="feature-description">Vector + keyword search</div>
                        </div>
                    </li>
                    <li>
                        <span class="feature-icon">📄</span>
                        <div class="feature-content">
                            <div class="feature-title">Document Processing</div>
                            <div class="feature-description">PDF & Word upload & chunking</div>
                        </div>
                    </li>
                    <li>
                        <span class="feature-icon">🧠</span>
                        <div class="feature-content">
                            <div class="feature-title">Conversation Memory</div>
                            <div class="feature-description">Context across sessions</div>
                        </div>
                    </li>
                                                               <li>
                          <span class="feature-icon">⚡</span>
                          <div class="feature-content">
                              <div class="feature-title">Performance Optimized</div>
                              <div class="feature-description">Parallel processing & caching</div>
                          </div>
                      </li>
                 </ul>
                 

                 
                 <div class="tech-stack">
                    <h4>🛠️ Built With</h4>
                    <div class="tech-grid">
                        <div class="tech-item">
                            <span class="tech-name">GPT-4</span>
                            <span class="tech-desc">Advanced AI Model</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-name">Azure AI Foundry</span>
                            <span class="tech-desc">AI Infrastructure</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-name">Azure AI Search</span>
                            <span class="tech-desc">Vector Search Engine</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="documents-section">
            <h3>📄 Document Management</h3>
            

            
            <div class="upload-section">
                    <h4>📤 Upload New Documents</h4>
                    <p>Upload PDF or Word documents to enhance your bot's knowledge base</p>
                    
                    <div class="upload-container" id="uploadContainer">
                        <form id="uploadForm" class="upload-form">
                            <div class="file-input-wrapper">
                                <input 
                                    type="file" 
                                    id="documentInput" 
                                    accept=".pdf,.doc,.docx"
                                    class="file-input"
                                >
                                <label for="documentInput" class="file-input-label" id="fileInputLabel">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                    <span class="upload-text">Choose File</span>
                                    <span class="upload-hint">or drag and drop here</span>
                                </label>
                                <div class="selected-file-info" id="selectedFileInfo" style="display: none;">
                                    <div class="file-icon">📄</div>
                                    <div class="file-details">
                                        <div class="file-name" id="selectedFileName"></div>
                                        <div class="file-size" id="selectedFileSize"></div>
                                    </div>
                                    <button type="button" class="remove-file-btn" onclick="removeSelectedFile(event)" title="Remove file">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                            <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            
                            <button type="submit" class="upload-btn" id="uploadBtn" disabled>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <span class="upload-btn-text">Upload Document</span>
                            </button>
                        </form>
                    </div>
                    
                    <div class="upload-status" id="uploadStatus"></div>
            </div>
            
            <div class="documents-section-separate">
                    <h4>📚 Your Documents</h4>
                    <div class="documents-header">
                        <span class="documents-count" id="documentsCount">0 documents</span>
                        <button class="refresh-btn" onclick="loadDocuments()" title="Refresh documents">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 4V10H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M3.51 15A9 9 0 1 0 6 5L1 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div id="documentsList" class="documents-list">
                        <div class="loading">Loading documents...</div>
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
                
                // Show loading indicator with animated ellipsis
                const loadingMessage = addMessage('Thinking...', 'bot', true);
                
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
        
        function addMessage(text, sender, isThinking = false) {
            const chatMessages = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender + '-message';
            
            const timestamp = new Date().toLocaleTimeString();
            
            let messageContent = text;
            if (isThinking && text === 'Thinking...') {
                messageContent = 'Thinking<span class="thinking-ellipsis">...</span>';
            }
            
            messageDiv.innerHTML = 
                '<div class="message-content">' +
                    '<div class="message-text">' + messageContent + '</div>' +
                    '<div class="message-timestamp">' + timestamp + '</div>' +
                '</div>';
            
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            return messageDiv;
        }
        
        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            return hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
        }

                          // Global state for service readiness

         


         
                   function setupFileUpload() {
              const uploadForm = document.getElementById('uploadForm');
              const documentInput = document.getElementById('documentInput');
              const uploadBtn = document.getElementById('uploadBtn');
              const selectedFileName = document.getElementById('selectedFileName');
              const selectedFileSize = document.getElementById('selectedFileSize');
              const selectedFileInfo = document.getElementById('selectedFileInfo');
              const fileInputLabel = document.getElementById('fileInputLabel');
              const uploadContainer = document.getElementById('uploadContainer');
              const uploadStatus = document.getElementById('uploadStatus');
              
              // Handle file selection
              documentInput.addEventListener('change', function(e) {
                  const file = e.target.files[0];
                  if (file) {
                      selectedFileName.textContent = file.name;
                      selectedFileSize.textContent = formatFileSize(file.size);
                      selectedFileInfo.style.display = 'flex';
                      fileInputLabel.style.display = 'none';
                      
                      // Enable button when file is selected
                      uploadBtn.disabled = false;
                      uploadStatus.innerHTML = '';
                  } else {
                      selectedFileName.textContent = '';
                      selectedFileSize.textContent = '';
                      selectedFileInfo.style.display = 'none';
                      fileInputLabel.style.display = 'flex';
                      uploadBtn.disabled = true;
                  }
              });
              
              // Drag and drop functionality
              uploadContainer.addEventListener('dragover', function(e) {
                  e.preventDefault();
                  uploadContainer.classList.add('drag-over');
              });
              
              uploadContainer.addEventListener('dragleave', function(e) {
                  e.preventDefault();
                  uploadContainer.classList.remove('drag-over');
              });
              
              uploadContainer.addEventListener('drop', function(e) {
                  e.preventDefault();
                  uploadContainer.classList.remove('drag-over');
                  
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                      const file = files[0];
                      if (isValidFileType(file)) {
                          documentInput.files = files;
                          documentInput.dispatchEvent(new Event('change'));
                      } else {
                          uploadStatus.innerHTML = '<div style="color: #f85149;">❌ Invalid file type. Please select a PDF or Word document.</div>';
                          uploadStatus.className = 'upload-status error';
                      }
                  }
              });
              
              // File type validation
              function isValidFileType(file) {
                  const allowedTypes = [
                      'application/pdf',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/msword'
                  ];
                  return allowedTypes.includes(file.type);
              }
              
              // File size formatting
              function formatFileSize(bytes) {
                  if (bytes === 0) return '0 Bytes';
                  const k = 1024;
                  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                  const i = Math.floor(Math.log(bytes) / Math.log(k));
                  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
              }
            
                                                   // Handle form submission
                          uploadForm.addEventListener('submit', async function(e) {
                              e.preventDefault();
                              
                              const file = documentInput.files[0];
                              if (!file) return;
                              

                              
                              // Show uploading status
                              uploadBtn.disabled = true;
                              uploadBtn.classList.add('processing');
                              uploadBtn.innerHTML = '<svg class="processing-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="upload-btn-text"><span class="processing-text">Processing</span><span class="processing-dots" id="processingDots">...</span></span>';
                              
                              // Start animated processing dots
                              const processingDots = document.getElementById('processingDots');
                              const processingStates = ['', '.', '..', '...'];
                              let dotIndex = 0;
                              const dotsInterval = setInterval(() => {
                                  if (processingDots) {
                                      processingDots.textContent = processingStates[dotIndex];
                                      dotIndex = (dotIndex + 1) % processingStates.length;
                                  }
                              }, 500);
                              
                              const formData = new FormData();
                              formData.append('document', file);
                              
                              try {
                                  const response = await fetch('/upload', {
                                      method: 'POST',
                                      body: formData
                                  });
                                  
                                  const data = await response.json();
                                  
                                  if (data.success) {
                                      uploadStatus.innerHTML = '✅ ' + data.message + '<br><strong>' + data.document.originalName + '</strong> processed successfully!<br>Text length: ' + data.document.textLength + ' characters, ' + data.document.chunks + ' chunks created.';
                                      uploadStatus.className = 'upload-status success';
                                      
                                      // Reset form
                                      uploadForm.reset();
                                      selectedFileInfo.style.display = 'none';
                                      fileInputLabel.style.display = 'flex';
                                      uploadBtn.disabled = true;
                                      
                                      // Reload documents list
                                      loadDocuments();
                                  } else {
                                      throw new Error(data.error || 'Upload failed');
                                  }
                              } catch (error) {
                                  console.error('Upload error:', error);
                                  uploadStatus.innerHTML = '❌ Upload failed: ' + error.message;
                                  uploadStatus.className = 'upload-status error';
                              } finally {
                                  // Clear the processing dots interval
                                  if (typeof dotsInterval !== 'undefined') {
                                      clearInterval(dotsInterval);
                                  }
                                  
                                  // Remove processing class and reset button
                                  uploadBtn.classList.remove('processing');
                                  
                                  // Re-enable button based on current state
                                  if (documentInput.files[0]) {
                                      uploadBtn.disabled = false;
                                  }
                                  uploadBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="upload-btn-text">Upload Document</span>';
                              }
                          });
        }
        
                 async function loadDocuments() {
             const documentsList = document.getElementById('documentsList');
             const documentsCount = document.getElementById('documentsCount');
             
             try {
                 const response = await fetch('/documents');
                 const data = await response.json();
                 
                 if (data.success) {
                     const count = data.documents.length;
                     documentsCount.textContent = count === 1 ? '1 document' : count + ' documents';
                     
                     if (count === 0) {
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
                     documentsCount.textContent = '0 documents';
                 }
             } catch (error) {
                 console.error('Error loading documents:', error);
                 documentsList.innerHTML = '<div class="error">Error loading documents</div>';
                 documentsCount.textContent = '0 documents';
             }
         }
         
         function removeSelectedFile(event) {
             // Prevent event bubbling to avoid triggering file input
             if (event) {
                 event.preventDefault();
                 event.stopPropagation();
             }
             
             const documentInput = document.getElementById('documentInput');
             const selectedFileInfo = document.getElementById('selectedFileInfo');
             const fileInputLabel = document.getElementById('fileInputLabel');
             const uploadBtn = document.getElementById('uploadBtn');
             const uploadStatus = document.getElementById('uploadStatus');
             const uploadContainer = document.getElementById('uploadContainer');
             
             // Reset file input
             documentInput.value = '';
             
             // Reset drag-and-drop state
             uploadContainer.classList.remove('drag-over');
             
             // Hide file info and show upload label
             selectedFileInfo.style.display = 'none';
             fileInputLabel.style.display = 'flex';
             
             // Disable upload button
             uploadBtn.disabled = true;
             
             // Clear status
             uploadStatus.innerHTML = '';
             uploadStatus.className = 'upload-status';
         }
        
                 async function deleteDocument(documentId) {
             if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
                 return;
             }
             
                          try {
                 const response = await fetch('/documents/' + documentId, {
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
    const response = await retryWithBackoff(async () => {
      return await callAzureOpenAI(chatId, message);
    }, 3, 2000);
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
  const uploadStartTime = Date.now();
  const uploadId = uuidv4();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    logUploadProcess('STARTED', {
      uploadId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      timestamp: uploadStartTime
    });
    
    console.log(`📤 File upload started: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);
    
    // Process the document with retry logic
    logUploadProcess('PROCESSING', { uploadId, phase: 'document_processing' });
    
    const documentInfo = await retryWithBackoff(async () => {
      return await processDocument(
        req.file.path,
        req.file.originalname,
        req.file.mimetype
      );
    }, 3, 2000);
    
    logUploadProcess('PROCESSING_COMPLETE', { 
      uploadId, 
      documentId: documentInfo.id,
      chunks: documentInfo.chunks,
      embeddings: documentInfo.embeddings 
    });
    
    // Clean up uploaded file
    logUploadProcess('CLEANUP', { uploadId, phase: 'file_cleanup' });
    await fs.remove(req.file.path);
    
    const uploadTime = Date.now() - uploadStartTime;
    logUploadProcess('COMPLETED', { 
      uploadId, 
      processingTime: uploadTime,
      documentId: documentInfo.id 
    });
    
    console.log(`🎉 File upload completed successfully in ${uploadTime}ms`);
    
    res.json({
      success: true,
      message: 'Document processed successfully',
      document: documentInfo,
      processingTime: uploadTime,
      uploadId
    });
    
  } catch (error) {
    const uploadTime = Date.now() - uploadStartTime;
    
    logUploadProcess('FAILED', { 
      uploadId, 
      error: error.message,
      processingTime: uploadTime,
      stack: error.stack
    });
    
    console.error(`❌ File upload failed after ${uploadTime}ms:`, error);
    
    // Clean up uploaded file on error
    if (req.file) {
      await fs.remove(req.file.path).catch(console.error);
    }
    
    res.status(500).json({
      error: 'Failed to process document',
      details: error.message,
      processingTime: uploadTime,
      uploadId
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

  console.log(`🔍 Generating embedding for text (${text.length} chars)...`);
  
  const embedding = await retryWithBackoff(async () => {
    const r = await axios.post(
      AZURE_OPENAI_EMBEDDINGS_URL,
      { input: text },
      {
        headers: {
          'api-key': AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const result = r.data?.data?.[0]?.embedding;
    if (!result || !Array.isArray(result)) {
      throw new Error('Invalid embedding response format');
    }
    
    console.log(`✅ Embedding generated successfully (${result.length} dimensions)`);
    return result;
  }, 3, 2000);
  
  embeddingCache.set(text, embedding);
  return embedding;
}

/* ==== Document Processing Functions ==== */
async function extractTextFromPDF(filePath) {
  try {
    console.log('📖 Reading PDF file...');
    const dataBuffer = await retryWithBackoff(async () => {
      return await fs.readFile(filePath);
    }, 2, 1000);
    
    console.log('🔍 Parsing PDF content...');
    const data = await retryWithBackoff(async () => {
      return await pdfParse(dataBuffer);
    }, 2, 1000);
    
    console.log(`✅ PDF text extracted: ${data.text.length} characters`);
    return data.text;
  } catch (error) {
    console.error('❌ Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

async function extractTextFromWord(filePath) {
  try {
    console.log('📝 Reading Word document...');
    const result = await retryWithBackoff(async () => {
      return await mammoth.extractRawText({ path: filePath });
    }, 2, 1000);
    
    console.log(`✅ Word document text extracted: ${result.value.length} characters`);
    return result.value;
  } catch (error) {
    console.error('❌ Error extracting text from Word document:', error);
    throw new Error('Failed to extract text from Word document');
  }
}

async function processDocument(filePath, originalName, mimeType) {
  console.log(`📄 Processing document: ${originalName} (${mimeType})`);
  const startTime = Date.now();
  
  try {
    let text;
    
    if (mimeType === 'application/pdf') {
      console.log('📖 Extracting text from PDF...');
      text = await extractTextFromPDF(filePath);
    } else if (mimeType.includes('word')) {
      console.log('📝 Extracting text from Word document...');
      text = await extractTextFromWord(filePath);
    } else {
      throw new Error('Unsupported file type');
    }
    
    console.log(`📊 Extracted ${text.length} characters of text`);
    
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
    
    console.log(`✂️ Split text into ${chunks.length} chunks`);
    
    // Process embeddings in parallel batches for better performance
    console.log('🧠 Generating embeddings for chunks...');
    const embeddings = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} chunks)`);
      
      const batchStartTime = Date.now();
      const batchPromises = batch.map(async (chunk, index) => {
        try {
          const chunkStartTime = Date.now();
          const embedding = await embedText(chunk);
          const chunkTime = Date.now() - chunkStartTime;
          
          if (embedding) {
            console.log(`✅ Chunk ${i + index + 1} embedded in ${chunkTime}ms`);
            return { content: chunk, contentVector: embedding };
          } else {
            console.warn(`⚠️ Chunk ${i + index + 1} returned null embedding`);
            return null;
          }
        } catch (error) {
          console.error(`❌ Failed to generate embedding for chunk ${i + index + 1}:`, error.message);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(Boolean);
      embeddings.push(...validResults);
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`📊 Batch ${batchNumber}/${totalBatches} completed in ${batchTime}ms: ${validResults.length}/${batch.length} successful`);
      
      if (validResults.length !== batch.length) {
        console.warn(`⚠️ Only ${validResults.length}/${batch.length} embeddings generated successfully for batch ${batchNumber}`);
      }
    }
    
    console.log(`✅ Successfully generated ${embeddings.length}/${chunks.length} embeddings`);
    
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
    
    // Add stabilization delay to ensure file system operations complete
    console.log('⏳ Adding stabilization delay for file system operations...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    
    // Verify the document is accessible for search
    console.log('🔍 Verifying document accessibility for search...');
    try {
      const verifyData = await fs.readJson(chunksPath);
      if (verifyData.documentInfo && verifyData.chunks && verifyData.chunks.length > 0) {
        console.log('✅ Document verified and ready for search');
      } else {
        console.warn('⚠️ Document verification incomplete, but continuing...');
      }
    } catch (verifyError) {
      console.warn('⚠️ Document verification failed, but continuing:', verifyError.message);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`🎉 Document processed successfully in ${processingTime}ms`);
    console.log(`📊 Final stats: ${embeddings.length} embeddings, ${chunks.length} chunks, ${cleanedText.length} characters`);
    
    return documentInfo;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Document processing failed after ${processingTime}ms:`, error.message);
    throw error;
  }
}

/**
 * Hybrid vector + keyword search (vector query + text query)
 * Returns top K docs with title, url, content
 */
async function retrieve(question, k = 4) {
  const vector = await embedText(question);
  if (!Array.isArray(vector)) return [];

  // Add a small stabilization delay to ensure search services are ready
  console.log('⏳ Adding search stabilization delay...');
  await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

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
    console.log(`🔍 Searching Azure Search index for: "${question}"`);
    
    const searchResults = await retryWithBackoff(async () => {
      return await searchClient.search(question, {
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
    }, 3, 1000);

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
    
    console.log(`✅ Azure Search returned ${results.length} results`);
    return results;
  } catch (error) {
    console.error('❌ Azure Search error:', error);
    return [];
  }
}

async function searchUploadedDocuments(question, vector, k) {
  const results = [];
  const similarityThreshold = 0.1; // Only consider results above this threshold
  
  // Process documents in parallel for better performance with retry logic
  const documentPromises = Array.from(uploadedDocuments.entries()).map(async ([documentId, documentInfo]) => {
    try {
      const chunksPath = path.join(documentsDir, `${documentId}.json`);
      
      // Add retry logic for file access
      let documentData;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          if (await fs.pathExists(chunksPath)) {
            documentData = await fs.readJson(chunksPath);
            break; // Success, exit retry loop
          } else {
            console.warn(`Document file not found: ${chunksPath}, retry ${retryCount + 1}/${maxRetries}`);
            retryCount++;
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
            }
          }
        } catch (readError) {
          console.warn(`Error reading document ${documentId}, retry ${retryCount + 1}/${maxRetries}:`, readError.message);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          }
        }
      }
      
      if (!documentData) {
        console.error(`Failed to read document ${documentId} after ${maxRetries} retries`);
        return [];
      }
      
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
    console.log('🔍 Calling retrieve function...');
    console.log(`📊 Current uploaded documents count: ${uploadedDocuments.size}`);
    
    const passages = await retrieve(userText, 4);
    console.log(`✅ Retrieved ${passages.length} passages`);
    
    if (passages.length) {
      console.log(`📝 Passage sources: ${passages.map(p => p.source).join(', ')}`);
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
    } else {
      console.log('⚠️ No passages retrieved - this might indicate a search readiness issue');
    }
  } catch (e) {
    console.error('❌ Search/Retrieval error:', e?.response?.data || e.message);
    console.error('🔍 Search error details:', e);
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
    
    const r = await retryWithBackoff(async () => {
      return await axios.post(
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
    }, 3, 2000);

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
    console.error('❌ Azure OpenAI error:', e?.response?.status, e?.response?.data || e.message);
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
    console.log('🚀 Starting server initialization...');
    
    // Run warm-up routine before starting services (non-blocking)
    console.log('🔥 Running service warm-up routine...');
    let warmUpResults;
    try {
      warmUpResults = await warmUpServices();
      console.log('📊 Initial warm-up results:', warmUpResults);
    } catch (warmUpError) {
      console.warn('⚠️ Initial warm-up failed, continuing with server startup:', warmUpError.message);
      warmUpResults = { azureOpenAI: false, azureSearch: false, searchIndex: false };
    }
    
    // Check service readiness but don't block startup
    const allServicesReady = warmUpResults.azureOpenAI && warmUpResults.azureSearch && warmUpResults.searchIndex && warmUpResults.localSearch;
    
    if (allServicesReady) {
      console.log('✅ All services are ready! Adding startup delay to ensure full readiness...');
      
      // Add a startup delay to ensure all services are fully ready
      const startupDelay = 5000; // 5 seconds
      console.log(`⏳ Waiting ${startupDelay}ms for services to fully stabilize...`);
      await new Promise(resolve => setTimeout(resolve, startupDelay));
      
      console.log('🚀 Services stabilized! Proceeding with bot initialization...');
    } else {
      console.warn('⚠️ Some services are not ready, but continuing with server startup');
      console.warn('📊 Service status:', warmUpResults);
      console.warn('💡 Services will be retried in the background');
      
      // Start background retry for failed services
      setTimeout(async () => {
        console.log('🔄 Retrying failed services in background...');
        try {
          const retryResults = await warmUpServices();
          console.log('📊 Background retry results:', retryResults);
        } catch (error) {
          console.warn('⚠️ Background retry failed:', error.message);
        }
      }, 10000); // Retry after 10 seconds
      
      // Start periodic health checks
      startHealthCheck();
    }
    
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
      console.log(`🔥 Services warmed up and ready for document processing`);
      if (isWebhookMode) {
        const cleanWebhookUrl = WEBHOOK_URL.endsWith('/') 
          ? `${WEBHOOK_URL}${WEBHOOK_PATH.slice(1)}` 
          : `${WEBHOOK_URL}${WEBHOOK_PATH}`;
        console.log(`🔗 Webhook URL: ${cleanWebhookUrl}`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  // Stop health check interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    console.log('Health check interval stopped');
  }
  
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
  
  // Stop health check interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    console.log('Health check interval stopped');
  }
  
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
