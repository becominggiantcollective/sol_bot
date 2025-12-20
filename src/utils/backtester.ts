import { ArbitrageOpportunity } from '../types/index.js';
import { Logger } from './index.js';

export interface BacktestResult {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  winRate: number;
  averageProfit: number;
  averageLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  sharpeRatio: number;
}

export interface BacktestConfig {
  initialCapital: number;
  startDate: Date;
  endDate: Date;
  riskPerTrade: number; // Percentage of capital to risk per trade
  maxDrawdown: number; // Maximum acceptable drawdown percentage
}

export class Backtester {
  private logger: Logger;
  private trades: Array<{ profit: number; timestamp: Date }> = [];

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Run backtest on historical opportunities
   */
  async runBacktest(
    opportunities: ArbitrageOpportunity[],
    config: BacktestConfig
  ): Promise<BacktestResult> {
    this.logger.info('Starting backtest...');
    this.trades = [];

    let currentCapital = config.initialCapital;
    let successfulTrades = 0;
    let failedTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let currentConsecutiveWins = 0;
    let currentConsecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;

    for (const opp of opportunities) {
      // Calculate position size based on risk
      const positionSize = currentCapital * config.riskPerTrade;
      
      // Simulate trade execution
      const tradeResult = this.simulateTrade(opp, positionSize);
      
      if (tradeResult > 0) {
        successfulTrades++;
        totalProfit += tradeResult;
        largestWin = Math.max(largestWin, tradeResult);
        currentConsecutiveWins++;
        currentConsecutiveLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentConsecutiveWins);
      } else {
        failedTrades++;
        totalLoss += Math.abs(tradeResult);
        largestLoss = Math.max(largestLoss, Math.abs(tradeResult));
        currentConsecutiveLosses++;
        currentConsecutiveWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
      }

      currentCapital += tradeResult;
      this.trades.push({ profit: tradeResult, timestamp: new Date() });

      // Check drawdown limit
      const drawdown = ((config.initialCapital - currentCapital) / config.initialCapital) * 100;
      if (drawdown > config.maxDrawdown) {
        this.logger.warn(`Maximum drawdown reached: ${drawdown.toFixed(2)}%`);
        break;
      }
    }

    const totalTrades = successfulTrades + failedTrades;
    const netProfit = totalProfit - totalLoss;
    const winRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
    const averageProfit = successfulTrades > 0 ? totalProfit / successfulTrades : 0;
    const averageLoss = failedTrades > 0 ? totalLoss / failedTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
    const sharpeRatio = this.calculateSharpeRatio();

    const result: BacktestResult = {
      totalTrades,
      successfulTrades,
      failedTrades,
      totalProfit,
      totalLoss,
      netProfit,
      winRate,
      averageProfit,
      averageLoss,
      profitFactor,
      largestWin,
      largestLoss,
      consecutiveWins: maxConsecutiveWins,
      consecutiveLosses: maxConsecutiveLosses,
      sharpeRatio,
    };

    this.logBacktestResults(result, config.initialCapital, currentCapital);
    return result;
  }

  /**
   * Run backtest with optional sentiment gating
   * sentimentMap: mapping token symbol -> sentiment score (-1..1)
   * sentimentThreshold: minimum sentiment to allow trade (default 0.0)
   */
  async runBacktestWithSentiment(
    opportunities: ArbitrageOpportunity[],
    config: BacktestConfig,
    sentimentMap: Record<string, number> = {},
    sentimentThreshold = 0.0
  ): Promise<BacktestResult> {
    this.logger.info('Starting backtest with sentiment gating...');
    const filtered = opportunities.filter(opp => {
      const symbol = opp.route?.[0]?.inputMint?.toString() || opp.inputMint.toString();
      // Try symbol first; fallback to serialized inputMint
      const s = sentimentMap[symbol] ?? sentimentMap[opp.inputMint.toString()] ?? 0;
      // allow if sentiment >= threshold
      if (s >= sentimentThreshold) return true;
      // if no signal (0) and threshold <= 0 allow
      return sentimentThreshold <= 0 && s === 0;
    });

    return this.runBacktest(filtered, config);
  }

  /**
   * Simulate a single trade execution
   */
  private simulateTrade(opp: ArbitrageOpportunity, positionSize: number): number {
    // Account for slippage (random between 0-0.5%)
    const slippage = Math.random() * 0.005;
    
    // Account for execution success rate (95% success rate)
    const executionSuccess = Math.random() > 0.05;
    
    if (!executionSuccess) {
      // Failed execution - loss of gas fees
      return -opp.gasEstimate;
    }

    // Calculate profit after slippage
    const profitAfterSlippage = opp.profit * (1 - slippage);
    const profitPercentage = profitAfterSlippage / opp.inputAmount;
    
    return positionSize * profitPercentage;
  }

  /**
   * Calculate Sharpe Ratio for risk-adjusted returns
   */
  private calculateSharpeRatio(): number {
    if (this.trades.length < 2) {
      return 0;
    }

    const returns = this.trades.map(t => t.profit);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    
    const variance = returns.reduce((sum, ret) => {
      return sum + Math.pow(ret - avgReturn, 2);
    }, 0) / returns.length;
    
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) {
      return 0;
    }

    // Assuming risk-free rate of 0 for crypto
    return avgReturn / stdDev;
  }

  /**
   * Log backtest results in a readable format
   */
  private logBacktestResults(
    result: BacktestResult,
    initialCapital: number,
    finalCapital: number
  ): void {
    this.logger.info('='.repeat(60));
    this.logger.info('BACKTEST RESULTS');
    this.logger.info('='.repeat(60));
    this.logger.info(`Initial Capital: $${initialCapital.toFixed(2)}`);
    this.logger.info(`Final Capital: $${finalCapital.toFixed(2)}`);
    this.logger.info(`Net Profit: $${result.netProfit.toFixed(2)} (${((finalCapital / initialCapital - 1) * 100).toFixed(2)}%)`);
    this.logger.info('-'.repeat(60));
    this.logger.info(`Total Trades: ${result.totalTrades}`);
    this.logger.info(`Successful Trades: ${result.successfulTrades}`);
    this.logger.info(`Failed Trades: ${result.failedTrades}`);
    this.logger.info(`Win Rate: ${result.winRate.toFixed(2)}%`);
    this.logger.info('-'.repeat(60));
    this.logger.info(`Total Profit: $${result.totalProfit.toFixed(2)}`);
    this.logger.info(`Total Loss: $${result.totalLoss.toFixed(2)}`);
    this.logger.info(`Average Profit: $${result.averageProfit.toFixed(2)}`);
    this.logger.info(`Average Loss: $${result.averageLoss.toFixed(2)}`);
    this.logger.info(`Profit Factor: ${result.profitFactor.toFixed(2)}`);
    this.logger.info('-'.repeat(60));
    this.logger.info(`Largest Win: $${result.largestWin.toFixed(2)}`);
    this.logger.info(`Largest Loss: $${result.largestLoss.toFixed(2)}`);
    this.logger.info(`Max Consecutive Wins: ${result.consecutiveWins}`);
    this.logger.info(`Max Consecutive Losses: ${result.consecutiveLosses}`);
    this.logger.info(`Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    this.logger.info('='.repeat(60));
  }

  /**
   * Generate performance report
   */
  generateReport(result: BacktestResult): string {
    return `
╔═══════════════════════════════════════════════════════════════╗
║                     BACKTEST PERFORMANCE REPORT                ║
╠═══════════════════════════════════════════════════════════════╣
║ Trading Performance                                            ║
║   Total Trades: ${result.totalTrades.toString().padEnd(43)} ║
║   Win Rate: ${result.winRate.toFixed(2)}%${' '.repeat(47 - result.winRate.toFixed(2).length)} ║
║   Net Profit: $${result.netProfit.toFixed(2).padEnd(42)} ║
╠═══════════════════════════════════════════════════════════════╣
║ Risk Metrics                                                   ║
║   Profit Factor: ${result.profitFactor.toFixed(2).padEnd(41)} ║
║   Sharpe Ratio: ${result.sharpeRatio.toFixed(2).padEnd(42)} ║
║   Largest Win: $${result.largestWin.toFixed(2).padEnd(41)} ║
║   Largest Loss: $${result.largestLoss.toFixed(2).padEnd(40)} ║
╚═══════════════════════════════════════════════════════════════╝
    `.trim();
  }
}
