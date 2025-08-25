# Test Suite for Telegram Bot Application

This directory contains comprehensive Jest test cases for all critical functions in the Telegram bot application with RAG (Retrieval-Augmented Generation) capabilities.

## Test Coverage

The test suite covers the following critical areas:

### 1. Main Application (`index.test.js`)
- **Environment Validation**: Tests for required environment variables
- **Utility Functions**: Uptime formatting, cache management
- **Document Processing**: PDF and Word document text extraction
- **Embeddings and Vector Operations**: Text embedding generation and cosine similarity calculations
- **Search and Retrieval**: Azure Search integration and document retrieval
- **Chat and AI Integration**: RAG-powered chat functionality
- **Bot Handlers**: Telegram bot command handling
- **Express Routes**: API endpoint testing
- **Error Handling**: Graceful error handling and recovery
- **Performance and Optimization**: Batch processing and caching

### 2. Document Indexer (`indexer.test.js`)
- **Text Chunking**: Document splitting algorithms
- **Environment Validation**: Configuration requirements
- **Embedding Generation**: Azure OpenAI embeddings API integration
- **Azure Search Integration**: Document indexing and search
- **Document Processing Pipeline**: End-to-end document workflow
- **Performance and Scalability**: Large document handling
- **Error Recovery and Resilience**: Fault tolerance and retry mechanisms
- **Data Validation and Sanitization**: Input validation and cleaning

### 3. Frontend JavaScript (`frontend.test.js`)
- **Chat Functionality**: Message handling and UI updates
- **File Upload**: Document upload interface and validation
- **Document Management**: Document listing and deletion
- **Utility Functions**: Helper functions and utilities
- **Error Handling**: User experience and error recovery
- **Performance and Optimization**: DOM caching and debouncing

## Prerequisites

Before running the tests, ensure you have the following installed:

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. Install the project dependencies:
```bash
npm install
```

2. Install test dependencies:
```bash
npm install --save-dev jest supertest nock mock-fs
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Tests for CI/CD
```bash
npm run test:ci
```

## Test Configuration

The test suite is configured in `package.json` with the following Jest settings:

```json
{
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
    "collectCoverageFrom": [
      "index.js",
      "indexer.js",
      "!**/node_modules/**",
      "!**/tests/**"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## Test Setup

The `tests/setup.js` file configures the testing environment:

- Sets up test environment variables
- Mocks external dependencies (Azure services, Telegram bot, file system)
- Provides global test utilities
- Configures console logging for tests

## Mocking Strategy

The test suite uses comprehensive mocking to isolate units under test:

### External Services
- **Azure OpenAI**: Mocked API responses for embeddings and chat completions
- **Azure AI Search**: Mocked search client and operations
- **Telegram Bot API**: Mocked bot instance and methods
- **File System**: Mocked file operations using `mock-fs`

### Dependencies
- **HTTP Requests**: Mocked using `nock` for external API calls
- **Database Operations**: Mocked in-memory storage
- **File Uploads**: Mocked using `multer` mocks

## Test Structure

Each test file follows this structure:

```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup mocks and test data
  });

  afterEach(() => {
    // Clean up mocks
  });

  describe('Specific Functionality', () => {
    test('should perform expected behavior', () => {
      // Test implementation
    });
  });
});
```

## Writing New Tests

When adding new functionality, follow these guidelines:

1. **Test Naming**: Use descriptive test names that explain the expected behavior
2. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
3. **Mock Isolation**: Ensure tests don't depend on external services
4. **Edge Cases**: Test error conditions and boundary cases
5. **Performance**: Include tests for performance-critical functions

### Example Test Template

```javascript
test('should handle specific scenario correctly', async () => {
  // Arrange - Setup test data and mocks
  const mockData = { /* test data */ };
  const mockFunction = jest.fn().mockResolvedValue(mockData);

  // Act - Execute the function under test
  const result = await functionUnderTest(mockFunction);

  // Assert - Verify the expected behavior
  expect(result).toEqual(expectedValue);
  expect(mockFunction).toHaveBeenCalledWith(expectedParams);
});
```

## Coverage Requirements

The test suite enforces 80% coverage across:
- **Branches**: All code paths are tested
- **Functions**: All functions have test coverage
- **Lines**: All executable lines are covered
- **Statements**: All statements are executed during tests

## Continuous Integration

The test suite is designed for CI/CD pipelines:

- **Fast Execution**: Tests complete within 30 seconds
- **Deterministic**: No flaky tests or race conditions
- **Isolated**: Tests don't interfere with each other
- **Comprehensive**: Covers all critical functionality

## Troubleshooting

### Common Issues

1. **Mock Not Working**: Ensure mocks are set up before importing modules
2. **Environment Variables**: Check that test environment is properly configured
3. **Async Tests**: Use proper async/await patterns for asynchronous operations
4. **Cleanup**: Ensure mocks are cleaned up between tests

### Debug Mode

Run tests with verbose output:
```bash
npm test -- --verbose
```

### Single Test File

Run tests for a specific file:
```bash
npm test -- tests/index.test.js
```

### Watch Mode with Coverage

```bash
npm run test:watch -- --coverage
```

## Performance Testing

The test suite includes performance tests for:

- **Document Processing**: Large file handling and chunking
- **Embedding Generation**: Batch processing and caching
- **Search Operations**: Vector similarity calculations
- **Memory Usage**: Cache management and cleanup

## Security Testing

Tests cover security aspects:

- **Input Validation**: File type and size validation
- **Authentication**: API key validation
- **Error Handling**: Secure error messages
- **File Upload**: Malicious file prevention

## Integration Testing

While the test suite focuses on unit tests, it also includes:

- **API Endpoint Testing**: Using `supertest` for Express routes
- **Database Operations**: Mocked but realistic data flows
- **External Service Integration**: Mocked but complete workflows

## Contributing

When contributing to the test suite:

1. **Follow Patterns**: Use existing test patterns and conventions
2. **Add Coverage**: Ensure new functionality has corresponding tests
3. **Update Documentation**: Keep this README current with new test features
4. **Performance**: Ensure tests run quickly and efficiently

## Support

For questions about the test suite:

1. Check the test output for specific error messages
2. Review the Jest documentation for testing patterns
3. Examine existing tests for examples of similar functionality
4. Ensure all dependencies are properly installed and configured

## Future Enhancements

Planned improvements to the test suite:

- **E2E Testing**: Integration tests with real services
- **Performance Benchmarks**: Automated performance regression testing
- **Visual Regression**: UI component testing
- **Load Testing**: Stress testing for high-traffic scenarios
- **Security Scanning**: Automated security vulnerability testing
