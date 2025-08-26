// test-warmup.js - Test the warm-up routine independently
require('dotenv/config');

const axios = require('axios');
const { SearchClient, AzureKeyCredential, SearchIndexClient } = require('@azure/search-documents');

const {
  AZURE_OPENAI_URL,
  AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_EMBEDDINGS_URL,
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_API_KEY,
  AZURE_SEARCH_INDEX
} = process.env;

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
    console.error('❌ Azure OpenAI embeddings test failed:', error.message);
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
    
    // Test basic search operation
    const results = await searchClient.search('test', { top: 1 });
    console.log('✅ Azure Search: OK');
    return true;
  } catch (error) {
    console.error('❌ Azure Search test failed:', error.message);
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
    searchIndex: false
  };
  
  // Test Azure OpenAI
  results.azureOpenAI = await testAzureOpenAI();
  
  // Test Azure Search
  results.azureSearch = await testAzureSearch();
  
  // Ensure search index exists
  results.searchIndex = await ensureSearchIndex();
  
  const warmUpTime = Date.now() - startTime;
  console.log(`⏱️ Warm-up completed in ${warmUpTime}ms`);
  console.log('📊 Warm-up results:', results);
  
  return results;
}

// Run the test
async function main() {
  try {
    console.log('🧪 Testing warm-up routine...');
    const results = await warmUpServices();
    
    if (results.azureOpenAI && results.azureSearch && results.searchIndex) {
      console.log('🎉 All services are ready!');
      process.exit(0);
    } else {
      console.log('❌ Some services are not ready');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
