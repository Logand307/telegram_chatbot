// index.js — Telegram bot + RAG (Azure AI Search) + Azure OpenAI (Option B full URL)
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

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
  AZURE_SEARCH_INDEX
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

/* ==== Clients ==== */
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

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
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    'Hi! I’m connected to Azure GPT-4 with RAG. Send me a message and I’ll try to answer using your indexed sources.'
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

console.log('Telegram RAG bot is running (long polling)…');
