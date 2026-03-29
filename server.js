const http = require("http");
const { BotEngine } = require("./bot/engine");

const PORT = process.env.PORT || 3001;
const KALSHI_API_KEY = process.env.KALSHI_API_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const KALSHI_API_BASE = "https://trading-api.kalshi.com/trade-api/v2";

const TENNIS_KEYWORDS = [
  "tennis", "atp", "wta", "grand slam", "roland garros",
  "wimbledon", "us open", "australian open",
];

function isTennisMarket(market) {
  const text = `${market.title || ""} ${market.subtitle || ""} ${market.event_ticker || ""}`.toLowerCase();
  return TENNIS_KEYWORDS.some((kw) => text.includes(kw));
}

function extractPlayers(title) {
  const match = title.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s*[-–—]|\s*$)/i);
  if (match) return { player1: match[1].trim(), player2: match[2].trim() };
  return { player1: "Player 1", player2: "Player 2" };
}

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, status, data) {
  corsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function fetchKalshiMarkets() {
  const allMarkets = [];
  let cursor = null;
  let pages = 0;

  while (pages < 5) {
    const params = new URLSearchParams({ limit: "200", status: "open" });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`${KALSHI_API_BASE}/markets?${params}`, {
      headers: {
        Authorization: `Bearer ${KALSHI_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kalshi API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const markets = data.markets || [];
    allMarkets.push(...markets);

    cursor = data.cursor || null;
    if (!cursor || markets.length === 0) break;
    pages++;
  }

  return allMarkets;
}

function structureMarket(m) {
  const { player1, player2 } = extractPlayers(m.title || "");
  const yesBid = m.yes_bid ?? 0;
  const yesAsk = m.yes_ask ?? 0;

  return {
    ticker: m.ticker,
    title: m.title || "",
    player1,
    player2,
    yesBid,
    yesAsk,
    noBid: m.no_bid ?? 100 - yesAsk,
    noAsk: m.no_ask ?? 100 - yesBid,
    lastPrice: m.last_price ?? m.yes_bid ?? 50,
    volume: m.volume ?? 0,
    liquidity: m.liquidity ?? 0,
    openTime: m.open_time || new Date().toISOString(),
    closeTime: m.close_time || new Date().toISOString(),
    spread: Math.abs(yesAsk - yesBid),
    status: m.status === "open" ? "active" : m.status,
    timestamp: Date.now(),
  };
}

// Cached markets for bot consumption
let cachedMarkets = [];

async function fetchAndCacheMarkets() {
  try {
    const allMarkets = await fetchKalshiMarkets();
    const tennisMarkets = allMarkets.filter(isTennisMarket);
    cachedMarkets = tennisMarkets.map(structureMarket);
    return cachedMarkets;
  } catch (err) {
    console.error("[CACHE] Failed to refresh markets:", err.message);
    return cachedMarkets;
  }
}

// === Bot Engine ===
const bot = new BotEngine();

// Start bot with market fetcher
if (KALSHI_API_KEY) {
  bot.start(() => fetchAndCacheMarkets());
  console.log("[BOT] Auto-started with market fetcher");
}

// === HTTP Server ===
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    corsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  // Health check
  if (url === "/" || url === "/health") {
    return sendJson(res, 200, { status: "ok", service: "kalshi-proxy", botRunning: bot.isRunning });
  }

  // Market data endpoint
  if (url === "/api/tennis-markets" && req.method === "GET") {
    if (!KALSHI_API_KEY) {
      return sendJson(res, 500, { error: "KALSHI_API_KEY not configured" });
    }
    try {
      const markets = await fetchAndCacheMarkets();
      console.log(`[${new Date().toISOString()}] Served ${markets.length} tennis markets`);
      return sendJson(res, 200, {
        markets,
        count: markets.length,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  // === Bot API ===

  // Get bot state
  if (url === "/api/bot/status" && req.method === "GET") {
    return sendJson(res, 200, bot.getState());
  }

  // Start bot
  if (url === "/api/bot/start" && req.method === "POST") {
    if (!bot.isRunning) {
      bot.start(() => fetchAndCacheMarkets());
    }
    return sendJson(res, 200, { success: true, state: bot.getState() });
  }

  // Stop bot
  if (url === "/api/bot/stop" && req.method === "POST") {
    bot.stop();
    return sendJson(res, 200, { success: true, state: bot.getState() });
  }

  // Set mode
  if (url === "/api/bot/mode" && req.method === "POST") {
    const body = await readBody(req);
    if (body.mode === "auto" || body.mode === "manual") {
      bot.setMode(body.mode);
      return sendJson(res, 200, { success: true, mode: bot.mode });
    }
    return sendJson(res, 400, { error: "Invalid mode. Use 'auto' or 'manual'" });
  }

  // Confirm a pending signal
  if (url === "/api/bot/confirm" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.ticker) return sendJson(res, 400, { error: "ticker required" });
    const result = await bot.confirmSignal(body.ticker);
    return sendJson(res, result.error ? 400 : 200, result);
  }

  // Dismiss a pending signal
  if (url === "/api/bot/dismiss" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.ticker) return sendJson(res, 400, { error: "ticker required" });
    const result = bot.dismissSignal(body.ticker);
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Kalshi Proxy + Bot running on port ${PORT}`);
  console.log(`Market data: GET /api/tennis-markets`);
  console.log(`Bot status:  GET /api/bot/status`);
  console.log(`Bot control: POST /api/bot/start | /api/bot/stop | /api/bot/mode`);
  console.log(`Bot trades:  POST /api/bot/confirm | /api/bot/dismiss`);
  console.log(`API Key configured: ${KALSHI_API_KEY ? "Yes" : "No"}`);
});
