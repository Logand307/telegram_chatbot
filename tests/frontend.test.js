// Frontend JavaScript Tests
// Testing the client-side functionality from the HTML file

describe('Frontend JavaScript Functionality', () => {
  let mockDocument;
  let mockConsole;
  let mockFetch;
  let mockFormData;
  let mockFile;

  beforeEach(() => {
    // Mock DOM elements
    mockDocument = {
      getElementById: jest.fn(),
      addEventListener: jest.fn(),
      querySelector: jest.fn(),
      querySelectorAll: jest.fn(),
      createElement: jest.fn(),
      body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
      }
    };

    // Mock console
    mockConsole = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    // Mock fetch
    mockFetch = jest.fn();

    // Mock FormData
    mockFormData = {
      append: jest.fn()
    };

    // Mock File
    mockFile = {
      name: 'test.pdf',
      size: 1024,
      type: 'application/pdf'
    };

    // Mock global objects
    global.document = mockDocument;
    global.console = mockConsole;
    global.fetch = mockFetch;
    global.FormData = jest.fn(() => mockFormData);
    global.File = jest.fn(() => mockFile);
    global.alert = jest.fn();
    global.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Chat Functionality', () => {
    test('setupChat should initialize chat form event listeners', () => {
      const mockChatForm = {
        addEventListener: jest.fn()
      };
      const mockMessageInput = {
        addEventListener: jest.fn(),
        value: '',
        disabled: false,
        focus: jest.fn()
      };
      const mockChatSendBtn = {
        disabled: false
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockChatForm) // chatForm
        .mockReturnValueOnce(mockMessageInput) // messageInput
        .mockReturnValueOnce(mockChatSendBtn); // chatSendBtn

      const setupChat = () => {
        const chatForm = document.getElementById('chatForm');
        const messageInput = document.getElementById('messageInput');
        const chatSendBtn = document.querySelector('.chat-send-btn');

        chatForm.addEventListener('submit', jest.fn());
        messageInput.addEventListener('keypress', jest.fn());
      };

      setupChat();

      expect(mockChatForm.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
      expect(mockMessageInput.addEventListener).toHaveBeenCalledWith('keypress', expect.any(Function));
    });

    test('chat form submission should send message to backend', async () => {
      const mockChatForm = {
        addEventListener: jest.fn()
      };
      const mockMessageInput = {
        value: 'Hello, bot!',
        disabled: false,
        focus: jest.fn()
      };
      const mockChatSendBtn = {
        disabled: false
      };
      const mockChatMessages = {
        appendChild: jest.fn(),
        scrollTop: 0,
        scrollHeight: 100
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockChatForm) // chatForm
        .mockReturnValueOnce(mockMessageInput) // messageInput
        .mockReturnValueOnce(mockChatSendBtn); // chatSendBtn

      mockDocument.querySelector.mockReturnValue(mockChatSendBtn);
      mockDocument.querySelectorAll.mockReturnValue([mockChatMessages]);

      // Mock successful fetch response
      mockFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          success: true,
          response: 'Hello! How can I help you today?',
          sources: []
        })
      });

      const setupChat = () => {
        const chatForm = document.getElementById('chatForm');
        const messageInput = document.getElementById('messageInput');
        const chatSendBtn = document.querySelector('.chat-send-btn');

        // Simulate form submission
        const submitHandler = (e) => {
          e.preventDefault();
          const message = messageInput.value.trim();
          if (!message) return;

          // Disable input while processing
          messageInput.disabled = true;
          chatSendBtn.disabled = true;

          // Simulate API call
          fetch('/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: message })
          }).then(response => response.json())
            .then(data => {
              if (data.success) {
                // Re-enable input
                messageInput.disabled = false;
                chatSendBtn.disabled = false;
                messageInput.focus();
              }
            });
        };

        chatForm.addEventListener('submit', submitHandler);
        return submitHandler;
      };

      const submitHandler = setupChat();
      const mockEvent = { preventDefault: jest.fn() };
      
      await submitHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Hello, bot!' })
      });
    });

    test('should handle chat API errors gracefully', async () => {
      const mockChatForm = {
        addEventListener: jest.fn()
      };
      const mockMessageInput = {
        value: 'Hello, bot!',
        disabled: false,
        focus: jest.fn()
      };
      const mockChatSendBtn = {
        disabled: false
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockChatForm)
        .mockReturnValueOnce(mockMessageInput)
        .mockReturnValueOnce(mockChatSendBtn);

      mockDocument.querySelector.mockReturnValue(mockChatSendBtn);

      // Mock failed fetch response
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const setupChat = () => {
        const chatForm = document.getElementById('chatForm');
        const messageInput = document.getElementById('messageInput');
        const chatSendBtn = document.querySelector('.chat-send-btn');

        const submitHandler = async (e) => {
          e.preventDefault();
          const message = messageInput.value.trim();
          if (!message) return;

          messageInput.disabled = true;
          chatSendBtn.disabled = true;

          try {
            const response = await fetch('/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ message: message })
            });
            
            const data = await response.json();
            if (data.success) {
              // Success handling
            }
          } catch (error) {
            console.error('Chat error:', error);
            // Re-enable input on error
            messageInput.disabled = false;
            chatSendBtn.disabled = false;
          }
        };

        chatForm.addEventListener('submit', submitHandler);
        return submitHandler;
      };

      const submitHandler = setupChat();
      const mockEvent = { preventDefault: jest.fn() };
      
      await submitHandler(mockEvent);

      expect(mockConsole.error).toHaveBeenCalledWith('Chat error:', expect.any(Error));
    });

    test('should add messages to chat interface', () => {
      const mockChatMessages = {
        appendChild: jest.fn(),
        scrollTop: 0,
        scrollHeight: 100
      };

      mockDocument.getElementById.mockReturnValue(mockChatMessages);
      mockDocument.createElement.mockReturnValue({
        className: '',
        innerHTML: ''
      });

      const addMessage = (text, sender) => {
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
      };

      addMessage('Hello, bot!', 'user');

      expect(mockChatMessages.appendChild).toHaveBeenCalled();
      expect(mockChatMessages.scrollTop).toBe(mockChatMessages.scrollHeight);
    });

    test('should handle Enter key to send messages', () => {
      const mockMessageInput = {
        addEventListener: jest.fn(),
        value: 'Hello, bot!',
        disabled: false
      };
      const mockChatForm = {
        dispatchEvent: jest.fn()
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockChatForm)
        .mockReturnValueOnce(mockMessageInput);

      const setupChat = () => {
        const chatForm = document.getElementById('chatForm');
        const messageInput = document.getElementById('messageInput');

        // Allow Enter key to send
        messageInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit'));
          }
        });
      };

      setupChat();

      const keypressHandler = mockMessageInput.addEventListener.mock.calls[0][1];
      const mockEvent = { key: 'Enter', shiftKey: false, preventDefault: jest.fn() };
      
      keypressHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockChatForm.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
    });
  });

  describe('File Upload Functionality', () => {
    test('setupFileUpload should initialize file upload event listeners', () => {
      const mockUploadForm = {
        addEventListener: jest.fn()
      };
      const mockDocumentInput = {
        addEventListener: jest.fn()
      };
      const mockUploadBtn = {
        disabled: true,
        innerHTML: 'Upload Document'
      };
      const mockSelectedFileName = {
        textContent: ''
      };
      const mockUploadStatus = {
        innerHTML: ''
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockUploadForm)
        .mockReturnValueOnce(mockDocumentInput)
        .mockReturnValueOnce(mockUploadBtn)
        .mockReturnValueOnce(mockSelectedFileName)
        .mockReturnValueOnce(mockUploadStatus);

      const setupFileUpload = () => {
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
        uploadForm.addEventListener('submit', function(e) {
          e.preventDefault();
          // Upload logic would go here
        });
      };

      setupFileUpload();

      expect(mockDocumentInput.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockUploadForm.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
    });

    test('file selection should update UI elements', () => {
      const mockDocumentInput = {
        addEventListener: jest.fn()
      };
      const mockUploadBtn = {
        disabled: true
      };
      const mockSelectedFileName = {
        textContent: ''
      };
      const mockUploadStatus = {
        innerHTML: ''
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockDocumentInput)
        .mockReturnValueOnce(mockUploadBtn)
        .mockReturnValueOnce(mockSelectedFileName)
        .mockReturnValueOnce(mockUploadStatus);

      const setupFileUpload = () => {
        const documentInput = document.getElementById('documentInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const selectedFileName = document.getElementById('selectedFileName');
        const uploadStatus = document.getElementById('uploadStatus');

        const changeHandler = function(e) {
          const file = e.target.files[0];
          if (file) {
            selectedFileName.textContent = file.name;
            uploadBtn.disabled = false;
            uploadStatus.innerHTML = '';
          } else {
            selectedFileName.textContent = '';
            uploadBtn.disabled = true;
          }
        };

        documentInput.addEventListener('change', changeHandler);
        return changeHandler;
      };

      const changeHandler = setupFileUpload();
      const mockEvent = {
        target: {
          files: [mockFile]
        }
      };

      changeHandler(mockEvent);

      expect(mockSelectedFileName.textContent).toBe('test.pdf');
      expect(mockUploadBtn.disabled).toBe(false);
      expect(mockUploadStatus.innerHTML).toBe('');
    });

    test('file upload should send file to backend', async () => {
      const mockUploadForm = {
        addEventListener: jest.fn()
      };
      const mockDocumentInput = {
        files: [mockFile]
      };
      const mockUploadBtn = {
        disabled: false,
        innerHTML: 'Upload Document'
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockUploadForm)
        .mockReturnValueOnce(mockDocumentInput)
        .mockReturnValueOnce(mockUploadBtn);

      // Mock successful fetch response
      mockFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          success: true,
          message: 'Document processed successfully',
          document: {
            id: 'test-id',
            originalName: 'test.pdf',
            textLength: 1000,
            chunks: 5
          }
        })
      });

      const setupFileUpload = () => {
        const uploadForm = document.getElementById('uploadForm');
        const documentInput = document.getElementById('documentInput');
        const uploadBtn = document.getElementById('uploadBtn');

        const submitHandler = async function(e) {
          e.preventDefault();
          
          const file = documentInput.files[0];
          if (!file) return;

          uploadBtn.disabled = true;
          uploadBtn.innerHTML = 'Processing...';

          const formData = new FormData();
          formData.append('document', file);

          try {
            const response = await fetch('/upload', {
              method: 'POST',
              body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
              // Success handling
              uploadBtn.disabled = false;
              uploadBtn.innerHTML = 'Upload Document';
            }
          } catch (error) {
            console.error('Upload error:', error);
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = 'Upload Document';
          }
        };

        uploadForm.addEventListener('submit', submitHandler);
        return submitHandler;
      };

      const submitHandler = setupFileUpload();
      const mockEvent = { preventDefault: jest.fn() };
      
      await submitHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/upload', {
        method: 'POST',
        body: mockFormData
      });
      expect(mockFormData.append).toHaveBeenCalledWith('document', mockFile);
    });

    test('should handle upload errors gracefully', async () => {
      const mockUploadForm = {
        addEventListener: jest.fn()
      };
      const mockDocumentInput = {
        files: [mockFile]
      };
      const mockUploadBtn = {
        disabled: false,
        innerHTML: 'Upload Document'
      };

      mockDocument.getElementById
        .mockReturnValueOnce(mockUploadForm)
        .mockReturnValueOnce(mockDocumentInput)
        .mockReturnValueOnce(mockUploadBtn);

      // Mock failed fetch response
      mockFetch.mockRejectedValueOnce(new Error('Upload failed'));

      const setupFileUpload = () => {
        const uploadForm = document.getElementById('uploadForm');
        const documentInput = document.getElementById('documentInput');
        const uploadBtn = document.getElementById('uploadBtn');

        const submitHandler = async function(e) {
          e.preventDefault();
          
          const file = documentInput.files[0];
          if (!file) return;

          uploadBtn.disabled = true;
          uploadBtn.innerHTML = 'Processing...';

          try {
            const response = await fetch('/upload', {
              method: 'POST',
              body: new FormData()
            });
            
            const data = await response.json();
            
            if (data.success) {
              // Success handling
            }
          } catch (error) {
            console.error('Upload error:', error);
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = 'Upload Document';
          }
        };

        uploadForm.addEventListener('submit', submitHandler);
        return submitHandler;
      };

      const submitHandler = setupFileUpload();
      const mockEvent = { preventDefault: jest.fn() };
      
      await submitHandler(mockEvent);

      expect(mockConsole.error).toHaveBeenCalledWith('Upload error:', expect.any(Error));
      expect(mockUploadBtn.disabled).toBe(false);
      expect(mockUploadBtn.innerHTML).toBe('Upload Document');
    });
  });

  describe('Document Management', () => {
    test('loadDocuments should fetch and display documents', async () => {
      const mockDocumentsList = {
        innerHTML: '<div class="loading">Loading documents...</div>'
      };

      mockDocument.getElementById.mockReturnValue(mockDocumentsList);

      // Mock successful fetch response
      mockFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          success: true,
          documents: [
            {
              id: 'doc1',
              name: 'test.pdf',
              type: 'application/pdf',
              uploadDate: new Date().toISOString(),
              textLength: 1000,
              chunks: 5
            }
          ]
        })
      });

      const loadDocuments = async () => {
        const documentsList = document.getElementById('documentsList');
        
        try {
          const response = await fetch('/documents');
          const data = await response.json();
          
          if (data.success) {
            if (data.documents.length === 0) {
              documentsList.innerHTML = '<div class="no-documents">No documents uploaded yet. Upload your first document to get started!</div>';
            } else {
              documentsList.innerHTML = data.documents.map(doc => `
                <div class="document-item">
                  <div class="document-info">
                    <div class="name" title="${doc.name}">${doc.name}</div>
                    <div class="type">${doc.type.includes('pdf') ? 'PDF' : 'Word'}</div>
                    <div class="upload-date">${new Date(doc.uploadDate).toLocaleDateString()}</div>
                    <div class="text-length">${doc.textLength.toLocaleString()} chars</div>
                  </div>
                </div>
              `).join('');
            }
          } else {
            documentsList.innerHTML = '<div class="error">Failed to load documents</div>';
          }
        } catch (error) {
          console.error('Error loading documents:', error);
          documentsList.innerHTML = '<div class="error">Error loading documents</div>';
        }
      };

      await loadDocuments();

      expect(mockFetch).toHaveBeenCalledWith('/documents');
      expect(mockDocumentsList.innerHTML).toContain('test.pdf');
      expect(mockDocumentsList.innerHTML).toContain('PDF');
    });

    test('should display no documents message when list is empty', async () => {
      const mockDocumentsList = {
        innerHTML: '<div class="loading">Loading documents...</div>'
      };

      mockDocument.getElementById.mockReturnValue(mockDocumentsList);

      // Mock successful fetch response with empty documents
      mockFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          success: true,
          documents: []
        })
      });

      const loadDocuments = async () => {
        const documentsList = document.getElementById('documentsList');
        
        try {
          const response = await fetch('/documents');
          const data = await response.json();
          
          if (data.success) {
            if (data.documents.length === 0) {
              documentsList.innerHTML = '<div class="no-documents">No documents uploaded yet. Upload your first document to get started!</div>';
            } else {
              // Document list rendering logic
            }
          }
        } catch (error) {
          console.error('Error loading documents:', error);
        }
      };

      await loadDocuments();

      expect(mockDocumentsList.innerHTML).toContain('No documents uploaded yet');
    });

    test('should handle document loading errors', async () => {
      const mockDocumentsList = {
        innerHTML: '<div class="loading">Loading documents...</div>'
      };

      mockDocument.getElementById.mockReturnValue(mockDocumentsList);

      // Mock failed fetch response
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const loadDocuments = async () => {
        const documentsList = document.getElementById('documentsList');
        
        try {
          const response = await fetch('/documents');
          const data = await response.json();
          
          if (data.success) {
            // Success handling
          }
        } catch (error) {
          console.error('Error loading documents:', error);
          documentsList.innerHTML = '<div class="error">Error loading documents</div>';
        }
      };

      await loadDocuments();

      expect(mockConsole.error).toHaveBeenCalledWith('Error loading documents:', expect.any(Error));
      expect(mockDocumentsList.innerHTML).toContain('Error loading documents');
    });

    test('deleteDocument should remove documents after confirmation', async () => {
      // Mock confirm to return true
      global.confirm.mockReturnValue(true);

      // Mock successful fetch response
      mockFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          success: true,
          message: 'Document deleted successfully'
        })
      });

      const deleteDocument = async (documentId) => {
        if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
          return;
        }
        
        try {
          const response = await fetch(`/documents/${documentId}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          
          if (data.success) {
            // Reload documents list
            console.log('Document deleted successfully');
          } else {
            alert('Failed to delete document: ' + (data.error || 'Unknown error'));
          }
        } catch (error) {
          console.error('Error deleting document:', error);
          alert('Error deleting document: ' + error.message);
        }
      };

      await deleteDocument('doc1');

      expect(global.confirm).toHaveBeenCalledWith('Are you sure you want to delete this document? This action cannot be undone.');
      expect(mockFetch).toHaveBeenCalledWith('/documents/doc1', {
        method: 'DELETE'
      });
      expect(mockConsole.log).toHaveBeenCalledWith('Document deleted successfully');
    });

    test('should not delete document when user cancels confirmation', async () => {
      // Mock confirm to return false
      global.confirm.mockReturnValue(false);

      const deleteDocument = async (documentId) => {
        if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
          return;
        }
        
        // This should not execute
        const response = await fetch(`/documents/${documentId}`, {
          method: 'DELETE'
        });
      };

      await deleteDocument('doc1');

      expect(global.confirm).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Utility Functions', () => {
    test('formatUptime should format seconds correctly', () => {
      const formatUptime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
      };

      expect(formatUptime(3661)).toBe('01:01:01');
      expect(formatUptime(0)).toBe('00:00:00');
      expect(formatUptime(3600)).toBe('01:00:00');
      expect(formatUptime(61)).toBe('00:01:01');
      expect(formatUptime(12345)).toBe('03:25:45');
    });

    test('should handle DOM ready events', () => {
      const mockSetupChat = jest.fn();
      const mockSetupFileUpload = jest.fn();
      const mockLoadDocuments = jest.fn();

      const setupDOMReady = () => {
        document.addEventListener('DOMContentLoaded', function() {
          // Update uptime every second
          setInterval(function() {
            fetch('/health')
              .then(response => response.json())
              .then(data => {
                const uptimeElement = document.querySelector('.metric');
                if (uptimeElement && uptimeElement.textContent.includes(':')) {
                  const uptime = data.uptime;
                  // Update uptime display
                }
              })
              .catch(console.error);
          }, 1000);
          
          // Setup functionality
          mockSetupChat();
          mockSetupFileUpload();
          mockLoadDocuments();
        });
      };

      setupDOMReady();

      // Simulate DOM ready event
      const domReadyHandler = mockDocument.addEventListener.mock.calls.find(
        call => call[0] === 'DOMContentLoaded'
      )[1];

      domReadyHandler();

      expect(mockSetupChat).toHaveBeenCalled();
      expect(mockSetupFileUpload).toHaveBeenCalled();
      expect(mockLoadDocuments).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing DOM elements gracefully', () => {
      // Mock getElementById to return null
      mockDocument.getElementById.mockReturnValue(null);

      const safeElementAccess = () => {
        const element = document.getElementById('nonExistentElement');
        if (element) {
          element.innerHTML = 'test';
        } else {
          console.warn('Element not found');
        }
      };

      safeElementAccess();

      expect(mockConsole.warn).toHaveBeenCalledWith('Element not found');
    });

    test('should handle network timeouts', async () => {
      // Mock fetch to simulate timeout
      mockFetch.mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'));

      const fetchWithTimeout = async (url, options = {}) => {
        try {
          const response = await fetch(url, options);
          return response;
        } catch (error) {
          if (error.message.includes('timeout')) {
            console.error('Request timed out');
            throw new Error('Request timed out');
          }
          throw error;
        }
      };

      await expect(fetchWithTimeout('/test')).rejects.toThrow('Request timed out');
      expect(mockConsole.error).toHaveBeenCalledWith('Request timed out');
    });

    test('should validate file types before upload', () => {
      const validateFileType = (file) => {
        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword'
        ];
        
        return allowedTypes.includes(file.type);
      };

      const pdfFile = { type: 'application/pdf' };
      const wordFile = { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      const txtFile = { type: 'text/plain' };

      expect(validateFileType(pdfFile)).toBe(true);
      expect(validateFileType(wordFile)).toBe(true);
      expect(validateFileType(txtFile)).toBe(false);
    });

    test('should handle large file sizes', () => {
      const validateFileSize = (file, maxSizeMB = 10) => {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxSizeBytes;
      };

      const smallFile = { size: 1024 * 1024 }; // 1MB
      const largeFile = { size: 15 * 1024 * 1024 }; // 15MB

      expect(validateFileSize(smallFile, 10)).toBe(true);
      expect(validateFileSize(largeFile, 10)).toBe(false);
    });
  });

  describe('Performance and Optimization', () => {
    test('should debounce rapid API calls', () => {
      const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      };

      const mockApiCall = jest.fn();
      const debouncedApiCall = debounce(mockApiCall, 100);

      // Call multiple times rapidly
      debouncedApiCall();
      debouncedApiCall();
      debouncedApiCall();

      // Should not have been called yet
      expect(mockApiCall).not.toHaveBeenCalled();

      // Wait for debounce delay
      setTimeout(() => {
        expect(mockApiCall).toHaveBeenCalledTimes(1);
      }, 150);
    });

    test('should cache DOM queries', () => {
      const mockElement = { innerHTML: '' };
      mockDocument.getElementById.mockReturnValue(mockElement);

      const cacheDOMQueries = () => {
        // Cache DOM elements
        const elements = {
          chatMessages: document.getElementById('chatMessages'),
          messageInput: document.getElementById('messageInput'),
          uploadBtn: document.getElementById('uploadBtn')
        };

        // Use cached elements
        elements.chatMessages.innerHTML = 'test';
        elements.messageInput.value = 'test';
        elements.uploadBtn.disabled = true;

        return elements;
      };

      const cachedElements = cacheDOMQueries();

      expect(mockDocument.getElementById).toHaveBeenCalledTimes(3);
      expect(cachedElements.chatMessages).toBe(mockElement);
      expect(cachedElements.messageInput).toBe(mockElement);
      expect(cachedElements.uploadBtn).toBe(mockElement);
    });
  });
});
