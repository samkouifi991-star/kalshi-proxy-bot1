/**
 * Mean Reversion Strategy
 * Detects price drops and generates trade signals.
 * Designed to be one of many pluggable strategies.
 */

const STRATEGY_ID = "mean-reversion-v1";

const CONFIG = {
  minDropCents: 10,       // Minimum price drop to trigger
  maxSpread: 10,          // Max bid-ask spread
  minVolume: 5,           // Min volume to consider
  takeProfitCents: 10,    // Exit at +10¢
  stopLossCents: 13,      // Exit at -13¢
  timeWindowMs: 60000,    // Look back 60s for price drops
  maxPositionAge: 300000, // 5 min max hold time
};

/**
 * Evaluate markets against the mean-reversion strategy.
 * @param {Array} markets - Structured market data
 * @param {Object} priceHistory - { [ticker]: [{price, timestamp}, ...] }
 * @param {Object} activePositions - { [ticker]: position }
 * @returns {{ signals: Array, config: Object }}
 */
function evaluate(markets, priceHistory, activePositions) {
  const signals = [];
  const now = Date.now();

  for (const market of markets) {
    // Skip if already in a position
    if (activePositions[market.ticker]) continue;

    // Filter conditions
    if (market.spread > CONFIG.maxSpread) continue;
    if (market.volume < CONFIG.minVolume) continue;
    if (market.status !== "active") continue;

    // Check price history for drop
    const history = priceHistory[market.ticker] || [];
    const recentPoints = history.filter((p) => now - p.timestamp <= CONFIG.timeWindowMs);

    if (recentPoints.length < 2) continue;

    const peak = Math.max(...recentPoints.map((p) => p.price));
    const current = market.lastPrice;
    const drop = peak - current;

    if (drop >= CONFIG.minDropCents) {
      // Expected bounce must be >= 10¢ (we expect reversion to near peak)
      const expectedBounce = drop;
      if (expectedBounce >= CONFIG.takeProfitCents) {
        signals.push({
          strategyId: STRATEGY_ID,
          ticker: market.ticker,
          title: market.title,
          player1: market.player1,
          player2: market.player2,
          action: "BUY",
          side: "yes",
          price: current,
          limitPrice: market.yesAsk, // Buy at the ask
          peakPrice: peak,
          dropAmount: drop,
          expectedBounce,
          takeProfit: current + CONFIG.takeProfitCents,
          stopLoss: current - CONFIG.stopLossCents,
          reason: `Price dropped ${drop}¢ (${peak}→${current}) — mean reversion expected`,
          timestamp: now,
          confidence: Math.min(drop / 20, 1), // 0-1 scale
        });
      }
    }
  }

  return { signals, config: CONFIG };
}

module.exports = { evaluate, CONFIG, STRATEGY_ID };
