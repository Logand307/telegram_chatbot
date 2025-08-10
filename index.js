// index.js — Telegram bot + RAG (Azure AI Search) + Azure OpenAI (Option B full URL)
import 'dotenv/config';
import axios from 'axios';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import express from 'express';
import { createServer } from 'http';

// Dynamic import for Telegram bot
let TelegramBot;

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

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Telegram RAG Bot',
    status: 'running',
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

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
    // Dynamically import TelegramBot
    try {
      TelegramBot = (await import('node-telegram-bot-api')).TelegramBot;
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
      console.log('Bot created, type:', typeof bot);
      console.log('Bot methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(bot)));
    } catch (error) {
      console.error('Failed to import node-telegram-bot-api or create bot:', error);
      throw error;
    }
    
    isWebhookMode = true;
    
    // Set webhook
    try {
      console.log('Setting webhook...');
      await bot.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
      console.log(`Webhook set to: ${WEBHOOK_URL}${WEBHOOK_PATH}`);
    } catch (error) {
      console.error('Failed to set webhook:', error);
      throw error;
    }
    
    // Webhook endpoint
    app.post(WEBHOOK_PATH, async (req, res) => {
      try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
      } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
      }
    });
    
    console.log('Bot running in webhook mode');
  } else {
    // Polling mode for development
    console.log('Creating bot in polling mode...');
    // Dynamically import TelegramBot
    try {
      TelegramBot = (await import('node-telegram-bot-api')).TelegramBot;
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
      console.log('Bot created, type:', typeof bot);
      console.log('Bot methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(bot)));
    } catch (error) {
      console.error('Failed to import node-telegram-bot-api or create bot:', error);
      throw error;
    }
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
  const prior = history.get(chatId) || [];

  // 1) Retrieve relevant passages
  let contextBlock = 'No relevant sources found.';
  try {
    const passages = await retrieve(userText, 4);
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

    const reply = r.data?.choices?.[0]?.message?.content?.trim() || '…';
    // Save to memory
    history.set(chatId, [
      ...prior,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ]);
    return reply;
  } catch (e) {
    console.error('Azure OpenAI error:', e?.response?.status, e?.response?.data || e.message);
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
    
    // Setup bot handlers after bot is initialized
    setupBotHandlers(bot);

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🤖 Bot mode: ${isWebhookMode ? 'Webhook' : 'Polling'}`);
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
