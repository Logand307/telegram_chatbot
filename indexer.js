// indexer.js — embed and upload docs to Azure AI Search (botdocs)
import 'dotenv/config';
import axios from 'axios';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

/**
 * Minimal chunker: splits long text into ~800-character chunks at sentence boundaries.
 * Good enough for demos; feel free to replace with a token-based chunker later.
 */
function chunkText(text, maxLen = 800) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks = [];
  let buf = '';

  for (const s of sentences) {
    if ((buf + ' ' + s).trim().length > maxLen) {
      if (buf) chunks.push(buf.trim());
      buf = s;
    } else {
      buf = (buf ? buf + ' ' : '') + s;
    }
  }
  if (buf) chunks.push(buf.trim());
  return chunks;
}

// --- Env ---
const {
  AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_EMBEDDINGS_URL,
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_API_KEY,
  AZURE_SEARCH_INDEX
} = process.env;

function ensure(name, v) { if (!v) throw new Error(`Missing ${name} in .env`); }
ensure('AZURE_OPENAI_API_KEY', AZURE_OPENAI_API_KEY);
ensure('AZURE_OPENAI_EMBEDDINGS_URL', AZURE_OPENAI_EMBEDDINGS_URL);
ensure('AZURE_SEARCH_ENDPOINT', AZURE_SEARCH_ENDPOINT);
ensure('AZURE_SEARCH_API_KEY', AZURE_SEARCH_API_KEY);
ensure('AZURE_SEARCH_INDEX', AZURE_SEARCH_INDEX);

// --- Clients ---
const search = new SearchClient(
  AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_INDEX,
  new AzureKeyCredential(AZURE_SEARCH_API_KEY)
);

// --- Embedding helper ---
async function embed(text) {
  const res = await axios.post(
    AZURE_OPENAI_EMBEDDINGS_URL,
    { input: text },
    {
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      timeout: 30000
    }
  );
  return res.data.data[0].embedding; // 1536-length vector for text-embedding-3-small
}

// --- Replace these with your real docs ---
const SOURCE_DOCS = [
  {
    id: 'refund-policy',
    title: 'Refund Policy',
    url: 'https://example.com/refund',
    content: `
We accept returns within 30 days of purchase when items are unused and in original packaging.
A receipt or proof of purchase is required. Refunds are issued to the original payment method.
Certain items (gift cards, downloadable products) are non-refundable.
    `.trim()
  },
  {
    id: 'pricing',
    title: 'Pricing',
    url: 'https://example.com/pricing',
    content: `
We offer three plans: Free, Pro, and Enterprise. Free includes basic features with community support.
Pro includes advanced features and standard support. Enterprise includes SSO, custom SLAs, and a dedicated CSM.
Billing is monthly; annual discounts are available.
    `.trim()
  }
];

async function run() {
  const uploadBatch = [];

  for (const doc of SOURCE_DOCS) {
    // 1) Chunk long content (better recall)
    const parts = chunkText(doc.content, 800);

    // 2) Create one record per chunk
    for (let i = 0; i < parts.length; i++) {
      const chunkId = `${doc.id}-${i + 1}`;
      const chunkText = parts[i];

      // 3) Embed chunk
      const vec = await embed(chunkText);

      // 4) Push to batch
      uploadBatch.push({
        id: chunkId,
        title: i === 0 ? doc.title : `${doc.title} (part ${i + 1})`,
        url: doc.url,
        content: chunkText,
        contentVector: vec
      });
    }
  }

  // 5) Upload to Azure AI Search
  const result = await search.uploadDocuments(uploadBatch);
  console.log(`Uploaded ${uploadBatch.length} chunks.`);
  console.log('Search upload result:', result);

  // Small sanity search (optional)
  const testQuery = 'What is the refund policy?';
  const vector = await embed(testQuery);
  const results = await search.search(testQuery, {
    top: 3,
    vectorSearchOptions: {
      queries: [{ kind: 'vector', vector, fields: ['contentVector'], kNearestNeighborsCount: 3 }]
    }
  });

  console.log('Sample search results:');
  for await (const r of results.results) {
    console.log('-', r.document.title, '→', (r.document.content || '').slice(0, 80) + '...');
  }
}

run().catch((e) => {
  console.error('Indexer error:', e?.response?.data || e.message);
  process.exit(1);
});
