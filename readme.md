# Telegram RAG Bot with Azure AI Search

A Telegram bot that uses RAG (Retrieval-Augmented Generation) with Azure AI Search and Azure OpenAI to provide intelligent responses based on indexed knowledge sources.

## Features

- 🤖 Telegram bot integration
- 🔍 RAG with Azure AI Search
- 🧠 Azure OpenAI GPT-4 integration
- 🌐 Webhook and polling modes
- 🐳 Docker containerization
- 📊 Health monitoring endpoints
- 🚀 Pipeline-ready deployment

## Quick Start

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp env.template .env
   # Edit .env with your actual values
   ```

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

### Docker Deployment

1. **Build and run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

2. **Or build and run manually:**
   ```bash
   docker build -t telegram-rag-bot .
   docker run -p 3000:3000 --env-file .env telegram-rag-bot
   ```

## Pipeline Deployment

### Environment Variables

The bot automatically switches between polling and webhook modes based on environment configuration:

- **Development**: Uses long polling (no webhook needed)
- **Production**: Uses webhook mode (requires public HTTPS URL)

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz` |
| `AZURE_OPENAI_URL` | Full Azure OpenAI chat completions URL | `https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2023-12-01-preview` |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | `your-api-key-here` |
| `AZURE_OPENAI_EMBEDDINGS_URL` | Full Azure OpenAI embeddings URL | `https://your-resource.openai.azure.com/openai/deployments/your-embeddings-deployment/embeddings?api-version=2023-12-01-preview` |
| `AZURE_SEARCH_ENDPOINT` | Azure AI Search endpoint | `https://your-search-service.search.windows.net` |
| `AZURE_SEARCH_API_KEY` | Azure AI Search API key | `your-search-api-key` |
| `AZURE_SEARCH_INDEX` | Search index name | `your-index-name` |

#### Pipeline Configuration Variables

| Variable | Description | Default | Required for Pipeline |
|----------|-------------|---------|----------------------|
| `NODE_ENV` | Environment mode | `development` | Yes (set to `production`) |
| `PORT` | HTTP server port | `3000` | Yes |
| `WEBHOOK_URL` | Public HTTPS URL for webhook | - | Yes (for production) |
| `WEBHOOK_PATH` | Webhook endpoint path | `/webhook` | No |

### Deployment Options

#### 1. Docker Container (Recommended)

```bash
# Build image
docker build -t telegram-rag-bot .

# Run container
docker run -d \
  --name telegram-bot \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  telegram-rag-bot
```

#### 2. Docker Compose

```yaml
version: '3.8'
services:
  telegram-bot:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    restart: unless-stopped
```

#### 3. Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: telegram-rag-bot
spec:
  replicas: 1
  selector:
    matchLabels:
      app: telegram-rag-bot
  template:
    metadata:
      labels:
        app: telegram-rag-bot
    spec:
      containers:
      - name: telegram-bot
        image: telegram-rag-bot:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: telegram-bot-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Health Monitoring

The bot provides health check endpoints for pipeline monitoring:

- **Health Check**: `GET /health`
- **Status**: `GET /`

Example health response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "production",
  "uptime": 3600
}
```

### Webhook Setup

For production deployment, you need a public HTTPS URL. The bot will automatically:

1. Set the webhook to `{WEBHOOK_URL}{WEBHOOK_PATH}`
2. Handle incoming updates via HTTP POST
3. Clean up webhook on graceful shutdown

### Graceful Shutdown

The bot handles SIGTERM and SIGINT signals properly:

- Deletes webhook (if in webhook mode)
- Closes HTTP server
- Exits cleanly

## Development

### Scripts

- `npm start` - Start the bot
- `npm run dev` - Start in development mode (polling)
- `npm run prod` - Start in production mode (webhook)
- `npm run docker` - Build and run with Docker

### Local Testing

1. Set `NODE_ENV=development` (or omit `WEBHOOK_URL`)
2. Bot will use long polling mode
3. No need for public HTTPS URL

### Production Testing

1. Set `NODE_ENV=production`
2. Set `WEBHOOK_URL` to your public HTTPS domain
3. Ensure your domain is accessible from Telegram servers
4. Bot will automatically switch to webhook mode

## Troubleshooting

### Common Issues

1. **Webhook fails to set**: Ensure `WEBHOOK_URL` is publicly accessible and uses HTTPS
2. **Bot not responding**: Check health endpoint and logs
3. **Azure services errors**: Verify API keys and endpoints in `.env`

### Logs

Check container logs:
```bash
docker logs telegram-bot
# or
docker-compose logs telegram-bot
```

### Health Check

Test health endpoint:
```bash
curl http://localhost:3000/health
```

## Security Considerations

- Bot runs as non-root user in Docker
- Environment variables are loaded from `.env` file
- Webhook validation on incoming requests
- Graceful shutdown prevents webhook leaks

## License

MIT License - see LICENSE file for details.

