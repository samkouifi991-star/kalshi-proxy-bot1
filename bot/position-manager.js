/**
 * Position Manager
 * Tracks active positions, checks exit conditions, computes PnL.
 */

const { CONFIG } = require("./strategy");

class PositionManager {
  constructor() {
    /** @type {Object.<string, Object>} active positions keyed by ticker */
    this.positions = {};
    /** @type {Array} closed trade history */
    this.history = [];
    this.totalPnl = 0;
  }

  /**
   * Open a new position.
   */
  open({ ticker, title, player1, player2, side, entryPrice, quantity, orderId, strategyId, signal }) {
    const position = {
      id: `pos-${Date.now()}-${ticker}`,
      ticker,
      title,
      player1,
      player2,
      side,
      entryPrice,
      quantity,
      orderId,
      strategyId,
      takeProfit: entryPrice + CONFIG.takeProfitCents,
      stopLoss: entryPrice - CONFIG.stopLossCents,
      openedAt: Date.now(),
      maxHoldUntil: Date.now() + CONFIG.maxPositionAge,
      currentPrice: entryPrice,
      unrealizedPnl: 0,
      status: "open",
    };

    this.positions[ticker] = position;
    console.log(`[POSITIONS] Opened: ${side} ${quantity}x ${ticker} @ ${entryPrice}¢ | TP: ${position.takeProfit}¢ SL: ${position.stopLoss}¢`);
    return position;
  }

  /**
   * Update current prices and check exit conditions.
   * @param {Array} markets - Current market data
   * @returns {{ exits: Array, alerts: Array }}
   */
  update(markets) {
    const exits = [];
    const alerts = [];
    const now = Date.now();

    const marketMap = {};
    for (const m of markets) marketMap[m.ticker] = m;

    for (const [ticker, pos] of Object.entries(this.positions)) {
      const market = marketMap[ticker];
      if (!market) continue;

      // Update current price (use yesBid for selling)
      pos.currentPrice = market.yesBid || market.lastPrice;
      pos.unrealizedPnl = (pos.currentPrice - pos.entryPrice) * pos.quantity;

      let exitReason = null;

      // Take profit
      if (pos.currentPrice >= pos.takeProfit) {
        exitReason = `Take profit hit: ${pos.currentPrice}¢ >= ${pos.takeProfit}¢`;
      }
      // Stop loss
      else if (pos.currentPrice <= pos.stopLoss) {
        exitReason = `Stop loss hit: ${pos.currentPrice}¢ <= ${pos.stopLoss}¢`;
      }
      // Time exit
      else if (now >= pos.maxHoldUntil) {
        exitReason = `Time exit: held for ${Math.round((now - pos.openedAt) / 1000)}s`;
      }
      // Market closing
      else if (market.status !== "active") {
        exitReason = `Market status changed to ${market.status}`;
      }

      if (exitReason) {
        exits.push(this._close(ticker, pos, exitReason));
      }
    }

    return { exits, alerts };
  }

  _close(ticker, pos, reason) {
    const pnl = (pos.currentPrice - pos.entryPrice) * pos.quantity;
    const closedTrade = {
      ...pos,
      exitPrice: pos.currentPrice,
      realizedPnl: pnl,
      exitReason: reason,
      closedAt: Date.now(),
      holdTimeMs: Date.now() - pos.openedAt,
      status: "closed",
    };

    this.totalPnl += pnl;
    this.history.push(closedTrade);
    delete this.positions[ticker];

    console.log(`[POSITIONS] Closed: ${ticker} @ ${pos.currentPrice}¢ | PnL: ${pnl > 0 ? "+" : ""}${pnl}¢ | ${reason}`);
    return closedTrade;
  }

  getState() {
    return {
      activePositions: Object.values(this.positions),
      tradeHistory: this.history.slice(-50),
      totalPnl: this.totalPnl,
      winRate: this.history.length > 0
        ? Math.round(this.history.filter((t) => t.realizedPnl > 0).length / this.history.length * 100)
        : 0,
      totalTrades: this.history.length,
    };
  }
}

module.exports = { PositionManager };
