# Kalshi Tennis Markets Proxy Server

Standalone Node.js proxy that fetches tennis markets from the Kalshi API and serves them to the frontend dashboard.

## Deploy to Railway / Render / Vercel

### 1. Set Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KALSHI_API_KEY` | ✅ | Your Kalshi API key (Bearer token) |
| `PORT` | ❌ | Server port (default: 3001) |
| `CORS_ORIGIN` | ❌ | Allowed CORS origin (default: `*`) |

### 2. Deploy

**Railway:**
```bash
railway init
railway up
```

**Render:**
- Create a new Web Service
- Point to this directory
- Set start command: `node server.js`
- Add environment variables

**Vercel (Serverless):**
- Use the `api/tennis-markets.js` file as a serverless function

### 3. Update Frontend

After deploying, copy your server URL and add it as `VITE_KALSHI_PROXY_URL` in your Lovable project:

Example: `https://your-app.railway.app`

## API Endpoint

### `GET /api/tennis-markets`

Returns filtered tennis markets from Kalshi.

**Response:**
```json
{
  "markets": [...],
  "count": 5,
  "totalScanned": 200,
  "fetchedAt": 1234567890
}
```

## Local Development

```bash
npm install
KALSHI_API_KEY=your_key_here node server.js
```

Server runs at `http://localhost:3001`
