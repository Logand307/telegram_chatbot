// create_index.js — Create vector-enabled index for botdocs
import 'dotenv/config';
import { SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

const client = new SearchIndexClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

async function run() {
  const indexDefinition = {
    name: process.env.AZURE_SEARCH_INDEX,
    fields: [
      { name: 'id', type: 'Edm.String', key: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'url', type: 'Edm.String', filterable: true, searchable: true },
      { name: 'content', type: 'Edm.String', searchable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: 1536, // for text-embedding-3-small
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

  await client.createOrUpdateIndex(indexDefinition);
  console.log(`Index '${process.env.AZURE_SEARCH_INDEX}' created/updated successfully.`);
}

run().catch((err) => {
  console.error('Error creating index:', err?.response?.data || err.message);
});
