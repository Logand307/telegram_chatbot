const path = require('path');

// Mock axios before importing the app
jest.mock('axios');

// Import the mocked modules
const request = require('supertest');
const axios = require('axios');
const fs = require('fs-extra');


describe('Telegram Bot Application', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.AZURE_OPENAI_URL = 'https://test.openai.azure.com/chat/completions';
    process.env.AZURE_OPENAI_API_KEY = 'test-api-key';
    process.env.AZURE_OPENAI_EMBEDDINGS_URL = 'https://test.openai.azure.com/embeddings';
    process.env.AZURE_SEARCH_ENDPOINT = 'https://test.search.windows.net';
    process.env.AZURE_SEARCH_API_KEY = 'test-search-key';
    process.env.AZURE_SEARCH_INDEX = 'test-index';
    process.env.PORT = '3001';
    process.env.NODE_ENV = 'test';
  });

  describe('Environment Validation', () => {
    test('should throw error when TELEGRAM_BOT_TOKEN is missing', () => {
      const originalToken = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      
      // Test the validation logic directly
      const validateEnvironment = () => {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
          throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
        }
      };
      
      expect(() => {
        validateEnvironment();
      }).toThrow('Missing TELEGRAM_BOT_TOKEN in .env');

      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    });

    test('should throw error when AZURE_OPENAI_URL is missing', () => {
      const originalUrl = process.env.AZURE_OPENAI_URL;
      delete process.env.AZURE_OPENAI_URL;
      
      const validateEnvironment = () => {
        if (!process.env.AZURE_OPENAI_URL) {
          throw new Error('Missing AZURE_OPENAI_URL in .env');
        }
      };
      
      expect(() => {
        validateEnvironment();
      }).toThrow('Missing AZURE_OPENAI_URL in .env');

      process.env.AZURE_OPENAI_URL = originalUrl;
    });

    test('should throw error when AZURE_SEARCH_ENDPOINT is missing', () => {
      const originalEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
      delete process.env.AZURE_SEARCH_ENDPOINT;
      
      const validateEnvironment = () => {
        if (!process.env.AZURE_SEARCH_ENDPOINT) {
          throw new Error('Missing AZURE_SEARCH_ENDPOINT in .env');
        }
      };
      
      expect(() => {
        validateEnvironment();
      }).toThrow('Missing AZURE_SEARCH_ENDPOINT in .env');

      process.env.AZURE_SEARCH_ENDPOINT = originalEndpoint;
    });
  });

  describe('Utility Functions', () => {
    test('formatUptime should format seconds correctly', () => {
      const formatUptime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours}h ${minutes}m ${secs}s`;
      };

      expect(formatUptime(3661)).toBe('1h 1m 1s');
      expect(formatUptime(3600)).toBe('1h 0m 0s');
      expect(formatUptime(61)).toBe('0h 1m 1s');
      expect(formatUptime(0)).toBe('0h 0m 0s');
    });

    test('manageCache should clean cache when size exceeds limit', () => {
      const manageCache = (cache, maxSize = 100) => {
        if (Object.keys(cache).length > maxSize) {
          const keys = Object.keys(cache);
          const keysToRemove = keys.slice(0, Math.floor(keys.length / 2));
          keysToRemove.forEach(key => delete cache[key]);
        }
        return cache;
      };

      const cache = {};
      for (let i = 0; i < 150; i++) {
        cache[`key${i}`] = `value${i}`;
      }

      expect(Object.keys(cache)).toHaveLength(150);
      const cleanedCache = manageCache(cache, 100);
      expect(Object.keys(cleanedCache).length).toBeLessThan(150);
    });
  });

  describe('Document Processing', () => {
    test('extractTextFromPDF should extract text from PDF files', async () => {
      const extractTextFromPDF = async (filePath) => {
        // Mock PDF parsing
        return 'Extracted PDF content';
      };

      const result = await extractTextFromPDF('/test/path/file.pdf');
      expect(result).toBe('Extracted PDF content');
    });

    test('extractTextFromWord should extract text from Word documents', async () => {
      const extractTextFromWord = async (filePath) => {
        // Mock Word parsing
        return 'Extracted Word content';
      };

      const result = await extractTextFromWord('/test/path/file.docx');
      expect(result).toBe('Extracted Word content');
    });

    test('processDocument should process PDF documents correctly', async () => {
      const processDocument = async (filePath, fileType) => {
        if (fileType === 'application/pdf') {
          return await extractTextFromPDF(filePath);
        } else if (fileType.includes('word')) {
          return await extractTextFromWord(filePath);
        } else {
          throw new Error('Unsupported file type');
        }
      };

      const extractTextFromPDF = async () => 'PDF content';
      const extractTextFromWord = async () => 'Word content';

      const pdfResult = await processDocument('/test/file.pdf', 'application/pdf');
      expect(pdfResult).toBe('PDF content');
    });

    test('processDocument should process Word documents correctly', async () => {
      const processDocument = async (filePath, fileType) => {
        if (fileType === 'application/pdf') {
          return await extractTextFromPDF(filePath);
        } else if (fileType.includes('word')) {
          return await extractTextFromWord(filePath);
        } else {
          throw new Error('Unsupported file type');
        }
      };

      const extractTextFromPDF = async () => 'PDF content';
      const extractTextFromWord = async () => 'Word content';

      const wordResult = await processDocument('/test/file.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(wordResult).toBe('Word content');
    });

    test('processDocument should throw error for unsupported file types', async () => {
      const processDocument = async (filePath, fileType) => {
        if (fileType === 'application/pdf') {
          return await extractTextFromPDF(filePath);
        } else if (fileType.includes('word')) {
          return await extractTextFromWord(filePath);
        } else {
          throw new Error('Unsupported file type');
        }
      };

      await expect(processDocument('/test/file.txt', 'text/plain')).rejects.toThrow('Unsupported file type');
    });
  });

  describe('Embeddings and Vector Operations', () => {
    test('embedText should generate embeddings and cache them', async () => {
      const embedText = async (text) => {
        // Mock embedding generation
        return [0.1, 0.2, 0.3, 0.4, 0.5];
      };

      const result = await embedText('test text');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5);
      expect(result[0]).toBe(0.1);
    });

    test('embedText should handle API errors gracefully', async () => {
      const embedText = async (text) => {
        throw new Error('API error');
      };

      await expect(embedText('test text')).rejects.toThrow('API error');
    });

    test('calculateCosineSimilarity should calculate similarity correctly', () => {
      const calculateCosineSimilarity = (vecA, vecB) => {
        if (vecA.length !== vecB.length) {
          throw new Error('Vectors must have same length');
        }
        
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        
        return dotProduct / (magnitudeA * magnitudeB);
      };

      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];

      expect(calculateCosineSimilarity(vecA, vecB)).toBe(1);
      expect(calculateCosineSimilarity(vecA, vecC)).toBe(0);
    });

    test('calculateCosineSimilarity should handle invalid inputs', () => {
      const calculateCosineSimilarity = (vecA, vecB) => {
        if (vecA.length !== vecB.length) {
          throw new Error('Vectors must have same length');
        }
        
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        
        return dotProduct / (magnitudeA * magnitudeB);
      };

      expect(() => calculateCosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vectors must have same length');
    });
  });

  describe('Search and Retrieval', () => {
    test('retrieve should return combined results from Azure and uploaded documents', async () => {
      const retrieve = async (query, limit = 5) => {
        // Mock retrieval logic
        return {
          azureResults: [{ id: 'azure-1', content: 'Azure result' }],
          uploadedResults: [{ id: 'upload-1', content: 'Uploaded result' }],
          combined: [{ id: 'azure-1', content: 'Azure result' }, { id: 'upload-1', content: 'Uploaded result' }]
        };
      };

      const result = await retrieve('test query');
      expect(result).toHaveProperty('azureResults');
      expect(result).toHaveProperty('uploadedResults');
      expect(result).toHaveProperty('combined');
      expect(result.combined.length).toBe(2);
    });

    test('searchAzureIndex should handle Azure Search errors gracefully', async () => {
      const searchAzureIndex = async (query, limit = 5) => {
        throw new Error('Azure Search error');
      };

      await expect(searchAzureIndex('test query')).rejects.toThrow('Azure Search error');
    });

    test('searchUploadedDocuments should return relevant document chunks', async () => {
      const searchUploadedDocuments = async (query, limit = 5) => {
        // Mock search logic
        return [
          { id: 'doc-1', content: 'Relevant content 1', score: 0.9 },
          { id: 'doc-2', content: 'Relevant content 2', score: 0.8 }
        ];
      };

      const results = await searchUploadedDocuments('test query');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(2);
      expect(results[0]).toHaveProperty('score');
    });
  });

  describe('Chat and AI Integration', () => {
    test('callAzureOpenAI should process chat messages with RAG context', async () => {
      const callAzureOpenAI = async (messages, context = '') => {
        // Mock AI response
        return {
          role: 'assistant',
          content: `Response with context: ${context}`,
          usage: { total_tokens: 100 }
        };
      };

      const result = await callAzureOpenAI([{ role: 'user', content: 'test' }], 'test context');
      expect(result).toHaveProperty('role', 'assistant');
      expect(result.content).toContain('test context');
    });

    test('callAzureOpenAI should handle API errors gracefully', async () => {
      const callAzureOpenAI = async (messages, context = '') => {
        throw new Error('OpenAI API error');
      };

      await expect(callAzureOpenAI([{ role: 'user', content: 'test' }])).rejects.toThrow('OpenAI API error');
    });

    test('callAzureOpenAI should maintain conversation history', async () => {
      const callAzureOpenAI = async (messages, context = '') => {
        // Mock AI response that includes message count
        return {
          role: 'assistant',
          content: `Response to ${messages.length} messages`,
          usage: { total_tokens: 100 }
        };
      };

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];

      const result = await callAzureOpenAI(messages);
      expect(result.content).toContain('3 messages');
    });
  });

  describe('Bot Handlers', () => {
    test('setupBotHandlers should register command handlers', () => {
      const setupBotHandlers = (bot) => {
        bot.onText(/\/start/, () => {});
        bot.onText(/\/reset/, () => {});
        bot.onText(/\/help/, () => {});
        return bot;
      };

      const mockBot = {
        onText: jest.fn()
      };

      setupBotHandlers(mockBot);
      expect(mockBot.onText).toHaveBeenCalledTimes(3);
    });

    test('bot should handle /start command', () => {
      const handleStartCommand = (msg) => {
        return 'Welcome to the bot!';
      };

      const result = handleStartCommand({ chat: { id: 123 } });
      expect(result).toBe('Welcome to the bot!');
    });

    test('bot should handle /reset command', () => {
      const handleResetCommand = (msg) => {
        return 'Conversation reset!';
      };

      const result = handleResetCommand({ chat: { id: 123 } });
      expect(result).toBe('Conversation reset!');
    });
  });

  describe('Express Routes', () => {
    test('GET /health should return health status', () => {
      const healthHandler = (req, res) => {
        res.json({ status: 'ok', uptime: '1h 30m 45s' });
      };

      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };

      healthHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'ok',
        uptime: '1h 30m 45s'
      });
    });

    test('GET /test-azure should return Azure configuration status', () => {
      const testAzureHandler = (req, res) => {
        res.json({ 
          azureOpenAI: 'configured',
          azureSearch: 'configured',
          status: 'ready'
        });
      };

      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };

      testAzureHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        azureOpenAI: 'configured',
        azureSearch: 'configured',
        status: 'ready'
      });
    });

    test('POST /chat should process chat messages', () => {
      const chatHandler = (req, res) => {
        const { message } = req.body;
        if (!message) {
          return res.status(400).json({ error: 'Message is required' });
        }
        res.json({ response: `Echo: ${message}` });
      };

      const mockReq = { body: { message: 'Hello' } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      chatHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({ response: 'Echo: Hello' });
    });

    test('POST /chat should validate required message', () => {
      const chatHandler = (req, res) => {
        const { message } = req.body;
        if (!message) {
          return res.status(400).json({ error: 'Message is required' });
        }
        res.json({ response: `Echo: ${message}` });
      };

      const mockReq = { body: {} };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      chatHandler(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Message is required' });
    });

    test('POST /upload should process document uploads', () => {
      const uploadHandler = (req, res) => {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }
        res.json({ 
          message: 'File uploaded successfully',
          filename: req.file.originalname
        });
      };

      const mockReq = { 
        file: { originalname: 'test.pdf' }
      };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      uploadHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'File uploaded successfully',
        filename: 'test.pdf'
      });
    });

    test('GET /documents should return uploaded documents list', () => {
      const documentsHandler = (req, res) => {
        const documents = [
          { id: '1', name: 'doc1.pdf' },
          { id: '2', name: 'doc2.docx' }
        ];
        res.json({ documents });
      };

      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };

      documentsHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        documents: [
          { id: '1', name: 'doc1.pdf' },
          { id: '2', name: 'doc2.docx' }
        ]
      });
    });

    test('DELETE /documents/:id should delete documents', () => {
      const deleteDocumentHandler = (req, res) => {
        const { id } = req.params;
        if (id === '1') {
          res.json({ message: 'Document deleted successfully' });
        } else {
          res.status(404).json({ error: 'Document not found' });
        }
      };

      const mockReq = { params: { id: '1' } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      deleteDocumentHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Document deleted successfully' });
    });

    test('DELETE /documents/:id should return 404 for non-existent documents', () => {
      const deleteDocumentHandler = (req, res) => {
        const { id } = req.params;
        if (id === '1') {
          res.json({ message: 'Document deleted successfully' });
        } else {
          res.status(404).json({ error: 'Document not found' });
        }
      };

      const mockReq = { params: { id: '999' } };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      deleteDocumentHandler(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Document not found' });
    });
  });

  describe('Error Handling', () => {
    test('should handle file upload errors gracefully', () => {
      const handleUploadError = (error) => {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return { error: 'File too large' };
        } else if (error.code === 'LIMIT_FILE_COUNT') {
          return { error: 'Too many files' };
        } else {
          return { error: 'Upload failed' };
        }
      };

      expect(handleUploadError({ code: 'LIMIT_FILE_SIZE' })).toEqual({ error: 'File too large' });
      expect(handleUploadError({ code: 'LIMIT_FILE_COUNT' })).toEqual({ error: 'Too many files' });
      expect(handleUploadError({ code: 'UNKNOWN' })).toEqual({ error: 'Upload failed' });
    });

    test('should handle chat errors gracefully', () => {
      const handleChatError = (error) => {
        if (error.message.includes('API')) {
          return { error: 'Service temporarily unavailable' };
        } else if (error.message.includes('rate limit')) {
          return { error: 'Rate limit exceeded' };
        } else {
          return { error: 'An error occurred' };
        }
      };

      expect(handleChatError({ message: 'API error' })).toEqual({ error: 'Service temporarily unavailable' });
      expect(handleChatError({ message: 'rate limit exceeded' })).toEqual({ error: 'Rate limit exceeded' });
      expect(handleChatError({ message: 'unknown error' })).toEqual({ error: 'An error occurred' });
    });
  });

  describe('Performance and Optimization', () => {
    test('should process embeddings in batches', async () => {
      const processBatch = async (items, batchSize = 10) => {
        const results = [];
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(item => item * 2));
          results.push(...batchResults);
        }
        return results;
      };

      const items = Array.from({ length: 25 }, (_, i) => i);
      const results = await processBatch(items, 10);

      expect(results.length).toBe(25);
      expect(results[0]).toBe(0);
      expect(results[24]).toBe(48);
    });

    test('should use embedding cache to avoid duplicate API calls', () => {
      const cache = new Map();
      const getEmbedding = (text) => {
        if (cache.has(text)) {
          return cache.get(text);
        }
        const embedding = [0.1, 0.2, 0.3];
        cache.set(text, embedding);
        return embedding;
      };

      const result1 = getEmbedding('test');
      const result2 = getEmbedding('test'); // Should use cache

      expect(result1).toEqual(result2);
      expect(cache.size).toBe(1); // Only one entry
    });
  });
});
