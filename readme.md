# Telegram GPT-4 RAG Chatbot (Azure AI Search + Azure OpenAI)

A Telegram chatbot powered by **Azure OpenAI GPT-4** with **Retrieval-Augmented Generation (RAG)** using **Azure AI Search**.  
Built to demonstrate end-to-end integration of modern AI services into a messaging platform.

---

## Features

- **Telegram Integration**  
  Uses the Telegram Bot API to interact with users in real time.

- **Azure OpenAI (GPT-4)**  
  Handles natural language understanding and response generation.

- **Retrieval-Augmented Generation (RAG)**  
  - Uses **text-embedding-3-small** to embed both user queries and indexed documents.  
  - Fetches the most relevant chunks from Azure AI Search.  
  - Injects retrieved content into GPT prompts to ground answers in your own data.

- **Custom Knowledge Base**  
  - Index any set of documents (FAQs, policies, product info).  
  - Supports chunking for long documents.  
  - Stores both text and vector embeddings in Azure AI Search.

- **Vector Search**  
  - Uses Azure AI Search’s HNSW-based vector search for semantic retrieval.  
  - Filters top-K most relevant results.

- **Citations in Answers**  
  GPT responses cite sources like `[ #1 ]` for transparency.

- **Extendable Architecture**  
  Easily swap Telegram for another messaging platform or add more data sources.

---

