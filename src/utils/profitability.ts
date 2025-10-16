import { Logger } from './index.js';

export interface ProfitMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  dailyProfit: number;
  hourlyProfit: number;
  averageTradeProfit: number;
  bestTrade: number;
  worstTrade: number;
  profitPerHour: number;
  roi: number; // Return on Investment
  winRate: number;
  startTime: Date;
  lastTradeTime: Date | null;
}

export interface Trade {
  timestamp: Date;
  type: 'arbitrage' | 'liquidation' | 'sandwich';
  profit: number;
  success: boolean;
  details: {
    inputToken?: string;
    outputToken?: string;
    inputAmount?: number;
    outputAmount?: number;
    gasUsed?: number;
  };
}

export class ProfitabilityTracker {
  private logger: Logger;
  private trades: Trade[] = [];
  private startTime: Date;
  private initialCapital: number;

  constructor(initialCapital: number = 0) {
    this.logger = Logger.getInstance();
    this.startTime = new Date();
    this.initialCapital = initialCapital;
    this.logger.info(`Profitability tracker initialized with $${initialCapital.toFixed(2)} capital`);
  }

  /**
   * Record a trade
   */
  recordTrade(trade: Trade): void {
    this.trades.push(trade);
    
    if (trade.success) {
      this.logger.info(
        `✅ Successful ${trade.type}: +$${trade.profit.toFixed(4)} | Total: ${this.trades.length} trades`
      );
    } else {
      this.logger.warn(
        `❌ Failed ${trade.type}: -$${Math.abs(trade.profit).toFixed(4)} | Total: ${this.trades.length} trades`
      );
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): ProfitMetrics {
    const now = new Date();
    const hoursRunning = (now.getTime() - this.startTime.getTime()) / (1000 * 60 * 60);
    const daysRunning = hoursRunning / 24;

    const successfulTrades = this.trades.filter(t => t.success).length;
    const failedTrades = this.trades.filter(t => !t.success).length;
    
    const totalProfit = this.trades
      .filter(t => t.success)
      .reduce((sum, t) => sum + t.profit, 0);
    
    const totalLoss = this.trades
      .filter(t => !t.success)
      .reduce((sum, t) => sum + Math.abs(t.profit), 0);
    
    const netProfit = totalProfit - totalLoss;
    const averageTradeProfit = this.trades.length > 0 ? netProfit / this.trades.length : 0;
    
    const bestTrade = this.trades.length > 0 
      ? Math.max(...this.trades.map(t => t.profit))
      : 0;
    
    const worstTrade = this.trades.length > 0
      ? Math.min(...this.trades.map(t => t.profit))
      : 0;

    const profitPerHour = hoursRunning > 0 ? netProfit / hoursRunning : 0;
    const roi = this.initialCapital > 0 ? (netProfit / this.initialCapital) * 100 : 0;
    const winRate = this.trades.length > 0 ? (successfulTrades / this.trades.length) * 100 : 0;

    return {
      totalTrades: this.trades.length,
      successfulTrades,
      failedTrades,
      totalProfit,
      totalLoss,
      netProfit,
      dailyProfit: daysRunning > 0 ? netProfit / daysRunning : 0,
      hourlyProfit: profitPerHour,
      averageTradeProfit,
      bestTrade,
      worstTrade,
      profitPerHour,
      roi,
      winRate,
      startTime: this.startTime,
      lastTradeTime: this.trades.length > 0 ? this.trades[this.trades.length - 1].timestamp : null,
    };
  }

  /**
   * Get metrics for a specific time period
   */
  getMetricsForPeriod(hours: number): Partial<ProfitMetrics> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const periodTrades = this.trades.filter(t => t.timestamp >= cutoffTime);

    if (periodTrades.length === 0) {
      return {
        totalTrades: 0,
        netProfit: 0,
      };
    }

    const successfulTrades = periodTrades.filter(t => t.success).length;
    const totalProfit = periodTrades
      .filter(t => t.success)
      .reduce((sum, t) => sum + t.profit, 0);
    const totalLoss = periodTrades
      .filter(t => !t.success)
      .reduce((sum, t) => sum + Math.abs(t.profit), 0);

    return {
      totalTrades: periodTrades.length,
      successfulTrades,
      totalProfit,
      totalLoss,
      netProfit: totalProfit - totalLoss,
      winRate: (successfulTrades / periodTrades.length) * 100,
    };
  }

  /**
   * Display formatted metrics
   */
  displayMetrics(): void {
    const metrics = this.getMetrics();
    const runningTime = this.getRunningTime();

    this.logger.info('═'.repeat(70));
    this.logger.info('📊 PROFITABILITY METRICS');
    this.logger.info('═'.repeat(70));
    this.logger.info(`⏱️  Running Time: ${runningTime}`);
    this.logger.info(`💰 Net Profit: $${metrics.netProfit.toFixed(4)} (ROI: ${metrics.roi.toFixed(2)}%)`);
    this.logger.info(`📈 Total Profit: $${metrics.totalProfit.toFixed(4)}`);
    this.logger.info(`📉 Total Loss: $${metrics.totalLoss.toFixed(4)}`);
    this.logger.info('─'.repeat(70));
    this.logger.info(`🎯 Total Trades: ${metrics.totalTrades} (✅ ${metrics.successfulTrades} | ❌ ${metrics.failedTrades})`);
    this.logger.info(`📊 Win Rate: ${metrics.winRate.toFixed(2)}%`);
    this.logger.info(`💵 Average Trade: $${metrics.averageTradeProfit.toFixed(4)}`);
    this.logger.info(`🏆 Best Trade: $${metrics.bestTrade.toFixed(4)}`);
    this.logger.info(`💔 Worst Trade: $${metrics.worstTrade.toFixed(4)}`);
    this.logger.info('─'.repeat(70));
    this.logger.info(`⏰ Hourly Profit: $${metrics.hourlyProfit.toFixed(4)}`);
    this.logger.info(`📅 Daily Profit: $${metrics.dailyProfit.toFixed(4)}`);
    this.logger.info('═'.repeat(70));

    // Display period metrics
    const last1h = this.getMetricsForPeriod(1);
    const last24h = this.getMetricsForPeriod(24);
    
    this.logger.info('📊 PERIOD PERFORMANCE');
    this.logger.info(`Last 1h:  Trades: ${last1h.totalTrades}, Profit: $${(last1h.netProfit || 0).toFixed(4)}`);
    this.logger.info(`Last 24h: Trades: ${last24h.totalTrades}, Profit: $${(last24h.netProfit || 0).toFixed(4)}`);
    this.logger.info('═'.repeat(70));
  }

  /**
   * Get running time as a formatted string
   */
  private getRunningTime(): string {
    const now = new Date();
    const diff = now.getTime() - this.startTime.getTime();
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * Get all trades
   */
  getTrades(): Trade[] {
    return [...this.trades];
  }

  /**
   * Export metrics to JSON
   */
  exportToJSON(): string {
    const metrics = this.getMetrics();
    return JSON.stringify({
      metrics,
      trades: this.trades,
    }, null, 2);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.trades = [];
    this.startTime = new Date();
    this.logger.info('Profitability tracker reset');
  }

  /**
   * Check if bot is performing well
   */
  isPerformingWell(minWinRate: number = 60, minProfitPerHour: number = 1): boolean {
    const metrics = this.getMetrics();
    
    // Need at least 10 trades to make a judgment
    if (metrics.totalTrades < 10) {
      return true; // Give it time to prove itself
    }

    const isWinRateGood = metrics.winRate >= minWinRate;
    const isProfitable = metrics.profitPerHour >= minProfitPerHour;

    if (!isWinRateGood || !isProfitable) {
      this.logger.warn(
        `⚠️ Performance below threshold: Win Rate ${metrics.winRate.toFixed(2)}% (target: ${minWinRate}%), ` +
        `Profit/Hour $${metrics.profitPerHour.toFixed(2)} (target: $${minProfitPerHour})`
      );
    }

    return isWinRateGood && isProfitable;
  }
}
