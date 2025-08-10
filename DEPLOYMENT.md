# 🚀 Deploy to Railway (Free Hosting)

## Prerequisites
1. GitHub account
2. Railway account (free at [railway.app](https://railway.app))

## Step 1: Push Code to GitHub
```bash
git add .
git commit -m "Add Railway deployment"
git push origin main
```

## Step 2: Connect Railway to GitHub
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Choose "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect it's a Node.js app

## Step 3: Set Environment Variables
In Railway dashboard, add these variables:
- `TELEGRAM_BOT_TOKEN` - Your bot token
- `AZURE_OPENAI_URL` - Your Azure OpenAI endpoint
- `AZURE_OPENAI_API_KEY` - Your Azure OpenAI key
- `AZURE_OPENAI_EMBEDDINGS_URL` - Your embeddings endpoint
- `AZURE_SEARCH_ENDPOINT` - Your Azure Search endpoint
- `AZURE_SEARCH_API_KEY` - Your Search API key
- `AZURE_SEARCH_INDEX` - Your search index name
- `NODE_ENV` = `production`
- `PORT` = `3000`

## Step 4: Get Railway Token
1. In Railway, go to your profile settings
2. Copy your Railway token
3. In GitHub repo → Settings → Secrets → Actions
4. Add secret: `RAILWAY_TOKEN` with your Railway token

## Step 5: Deploy
- Push to `main` branch → Automatic deployment
- Or manually trigger in GitHub Actions tab

## Step 6: Update Webhook
1. Get your Railway app URL (e.g., `https://your-app.railway.app`)
2. Set `WEBHOOK_URL` in Railway environment variables
3. Restart the service

## ✅ Done!
Your bot is now running in the cloud and accessible 24/7!
