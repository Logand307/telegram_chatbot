// Jest setup file for Telegram bot tests
const path = require('path');

// Set up environment variables for testing
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.AZURE_OPENAI_URL = 'https://test.openai.azure.com/chat/completions';
process.env.AZURE_OPENAI_API_KEY = 'test-api-key';
process.env.AZURE_OPENAI_EMBEDDINGS_URL = 'https://test.openai.azure.com/embeddings';
process.env.AZURE_SEARCH_ENDPOINT = 'https://test.search.windows.net';
process.env.AZURE_SEARCH_API_KEY = 'test-search-key';
process.env.AZURE_SEARCH_INDEX = 'test-index';
process.env.PORT = '3001';
process.env.WEBHOOK_URL = 'https://test-webhook.com';
process.env.WEBHOOK_PATH = '/webhook';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock fs-extra to avoid file system operations during tests
jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
  readFile: jest.fn(),
  writeJson: jest.fn(),
  remove: jest.fn(),
  pathExists: jest.fn(),
  readJson: jest.fn(),
}));

// Mock uuid to return predictable values
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-12345'),
}));

// Mock Telegram bot
jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    onText: jest.fn(),
    on: jest.fn(),
    sendMessage: jest.fn(),
    sendChatAction: jest.fn(),
    setWebhook: jest.fn(),
    setWebHook: jest.fn(),
    setWebhookUrl: jest.fn(),
    deleteWebhook: jest.fn(),
    processUpdate: jest.fn(),
    handleUpdate: jest.fn(),
  }));
});

// Mock Azure Search client
jest.mock('@azure/search-documents', () => ({
  SearchClient: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
  })),
  AzureKeyCredential: jest.fn().mockImplementation(() => ({})),
}));

// Mock multer
jest.mock('multer', () => {
  return jest.fn().mockReturnValue({
    single: jest.fn().mockReturnValue((req, res, next) => {
      req.file = {
        path: '/test/path/file.pdf',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      };
      next();
    }),
    diskStorage: jest.fn().mockReturnValue({
      destination: jest.fn(),
      filename: jest.fn(),
    }),
  });
});

// Mock pdf-parse
jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'Test PDF content' }));

// Mock mammoth
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'Test Word content' }),
}));

// Global test utilities
global.createMockRequest = (body = {}, params = {}, file = null) => ({
  body,
  params,
  file,
  headers: { 'content-type': 'application/json' },
});

global.createMockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  return res;
};

global.createMockNext = () => jest.fn();
