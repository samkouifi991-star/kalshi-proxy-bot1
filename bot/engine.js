/**
 * Bot Engine
 * Orchestrates strategy evaluation, order execution, and position management.
 * Runs as a background loop on the proxy server.
 */

const strategy = require("./strategy");
const { placeLimitOrder } = require("./executor");
const { PositionManager } = require("./position-manager");

const BOT_TICK_INTERVAL = 5000; // 5s

class BotEngine {
  constructor() {
    this.positionManager = new PositionManager();
    this.priceHistory = {};  // { [ticker]: [{price, timestamp}] }
    this.alerts = [];
    this.isRunning = false;
    this.mode = "manual";    // "auto" | "manual"
    this.pendingSignals = []; // signals awaiting manual confirmation
    this.tickCount = 0;
    this.startedAt = null;
    this._interval = null;
    this._fetchMarkets = null;
  }

  /**
   * Start the bot loop.
   * @param {Function} fetchMarkets - async function returning structured markets array
   */
  start(fetchMarkets) {
    if (this.isRunning) return;
    this._fetchMarkets = fetchMarkets;
    this.isRunning = true;
    this.startedAt = Date.now();
    this._interval = setInterval(() => this.tick(), BOT_TICK_INTERVAL);
    this.tick(); // immediate first tick
    this._addAlert("system", "Bot started", `Mode: ${this.mode}`);
    console.log(`[BOT] Engine started in ${this.mode} mode`);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this.isRunning = false;
    this._addAlert("system", "Bot stopped", "");
    console.log("[BOT] Engine stopped");
  }

  setMode(mode) {
    if (mode !== "auto" && mode !== "manual") return;
    this.mode = mode;
    this._addAlert("system", `Mode changed to ${mode}`, "");
    console.log(`[BOT] Mode set to ${mode}`);
  }

  async tick() {
    if (!this._fetchMarkets) return;
    this.tickCount++;

    try {
      const markets = await this._fetchMarkets();
      if (!markets || markets.length === 0) return;

      // Update price history
      const now = Date.now();
      for (const m of markets) {
        if (!this.priceHistory[m.ticker]) this.priceHistory[m.ticker] = [];
        this.priceHistory[m.ticker].push({ price: m.lastPrice, timestamp: now });
        // Keep last 120 points (~10 min at 5s interval)
        if (this.priceHistory[m.ticker].length > 120) {
          this.priceHistory[m.ticker].shift();
        }
      }

      // Check position exits
      const { exits } = this.positionManager.update(markets);
      for (const exit of exits) {
        this._addAlert("trade_closed", `Closed ${exit.ticker}`, `PnL: ${exit.realizedPnl > 0 ? "+" : ""}${exit.realizedPnl}¢ — ${exit.exitReason}`);
      }

      // Evaluate strategy
      const { signals } = strategy.evaluate(
        markets,
        this.priceHistory,
        this.positionManager.positions
      );

      if (signals.length > 0) {
        for (const signal of signals) {
          this._addAlert("signal", `Signal: ${signal.ticker}`, signal.reason);

          if (this.mode === "auto") {
            await this._executeSignal(signal);
          } else {
            // Queue for manual confirmation
            this.pendingSignals = this.pendingSignals.filter((s) => s.ticker !== signal.ticker);
            this.pendingSignals.push(signal);
          }
        }
      }
    } catch (err) {
      console.error("[BOT] Tick error:", err.message);
      this._addAlert("error", "Tick error", err.message);
    }
  }

  async _executeSignal(signal) {
    try {
      const order = await placeLimitOrder({
        ticker: signal.ticker,
        side: signal.side,
        price: signal.limitPrice,
        quantity: 1,
      });

      if (order.filledQuantity > 0) {
        this.positionManager.open({
          ticker: signal.ticker,
          title: signal.title,
          player1: signal.player1,
          player2: signal.player2,
          side: signal.side,
          entryPrice: signal.price,
          quantity: order.filledQuantity,
          orderId: order.orderId,
          strategyId: signal.strategyId,
          signal,
        });

        this._addAlert("trade_opened", `Opened ${signal.ticker}`, `BUY ${order.filledQuantity}x @ ${signal.price}¢ | TP: ${signal.takeProfit}¢ SL: ${signal.stopLoss}¢`);
      }
    } catch (err) {
      this._addAlert("error", `Execution failed: ${signal.ticker}`, err.message);
    }
  }

  /**
   * Manually confirm a pending signal.
   */
  async confirmSignal(ticker) {
    const signal = this.pendingSignals.find((s) => s.ticker === ticker);
    if (!signal) return { error: "No pending signal for this ticker" };
    this.pendingSignals = this.pendingSignals.filter((s) => s.ticker !== ticker);
    await this._executeSignal(signal);
    return { success: true };
  }

  /**
   * Dismiss a pending signal.
   */
  dismissSignal(ticker) {
    this.pendingSignals = this.pendingSignals.filter((s) => s.ticker !== ticker);
    return { success: true };
  }

  _addAlert(type, title, detail) {
    this.alerts.unshift({
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      detail,
      timestamp: Date.now(),
    });
    if (this.alerts.length > 100) this.alerts.length = 100;
  }

  getState() {
    const posState = this.positionManager.getState();
    return {
      isRunning: this.isRunning,
      mode: this.mode,
      tickCount: this.tickCount,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      ...posState,
      pendingSignals: this.pendingSignals,
      alerts: this.alerts.slice(0, 50),
      strategyConfig: strategy.CONFIG,
    };
  }
}

module.exports = { BotEngine };
