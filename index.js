// index.js
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

// ---- Env validation ----
const {
  TELEGRAM_BOT_TOKEN,
  AZURE_OPENAI_URL,
  AZURE_OPENAI_API_KEY
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
if (!AZURE_OPENAI_URL) throw new Error('Missing AZURE_OPENAI_URL in .env');
if (!AZURE_OPENAI_API_KEY) throw new Error('Missing AZURE_OPENAI_API_KEY in .env');

// ---- Telegram bot (long polling) ----
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Simple in-memory conversation history per chat
// Keep it small to avoid hitting token limits & latency.
const history = new Map(); // chatId -> [{role, content}, ...]

const SYSTEM_PROMPT = 'You are a helpful, concise assistant chatting on Telegram.';

// Call Azure OpenAI (Chat Completions) using the full URL from .env
async function callAzureOpenAI(chatId, userText) {
  const prior = history.get(chatId) || [];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...prior.slice(-6), // keep the last few turns only
    { role: 'user', content: userText }
  ];

  try {
    const r = await axios.post(
      AZURE_OPENAI_URL, // full URL, e.g. https://.../chat/completions?api-version=...
      { messages, temperature: 0.7 },
      {
        headers: {
          'api-key': AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const reply = r.data?.choices?.[0]?.message?.content?.trim() || '…';
    // Update memory
    history.set(chatId, [
      ...prior,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply }
    ]);
    return reply;
  } catch (e) {
    // Surface helpful Azure errors in the console
    const status = e?.response?.status;
    const data = e?.response?.data;
    console.error('Azure OpenAI error:', status, data || e.message);
    throw e;
  }
}

// /start handler
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    'Hi! I’m connected to Azure GPT-4. Send me a message and I’ll reply.'
  );
});

// Main text handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Ignore non-text or commands other than /start
  if (!text || text.startsWith('/')) return;

  // Typing indicator while processing
  bot.sendChatAction(chatId, 'typing');

  try {
    const reply = await callAzureOpenAI(chatId, text);

    // Telegram max message length is ~4096. Keep margin.
    const chunks = reply.match(/[\s\S]{1,3800}/g) || [reply];
    for (const c of chunks) {
      await bot.sendMessage(chatId, c, { parse_mode: 'Markdown' }).catch(async () => {
        // Fallback without Markdown if formatting fails
        await bot.sendMessage(chatId, c);
      });
    }
  } catch {
    await bot.sendMessage(
      chatId,
      'Sorry, I hit an error reaching the AI. Please try again.'
    );
  }
});

console.log('Telegram bot is running (long polling)…');
