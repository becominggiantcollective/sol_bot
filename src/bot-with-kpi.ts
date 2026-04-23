/**
 * BOT INTEGRATION EXAMPLE FOR KPI TRACKING
 * 
 * This file demonstrates how to integrate the KPI tracking system
 * into the main trading bot.
 */

import { SolanaArbitrageBot } from './index.js';
import { KPITracker } from './utils/kpiTracker.js';
import { FineTuningEngine } from './utils/fineTuning.js';
import { Logger } from './utils/index.js';

const log = Logger.getInstance();

/**
 * Enhanced bot with KPI tracking
 */
export class KPIEnabledBot extends SolanaArbitrageBot {
  private kpiTracker: KPITracker;
  private fineTuningEngine: FineTuningEngine;
  private kpiReportInterval?: NodeJS.Timeout;

  constructor() {
    super();
    
    // Initialize KPI tracking
    this.kpiTracker = new KPITracker('./data/kpis');
    this.fineTuningEngine = new FineTuningEngine(this.kpiTracker);
    
    log.info('KPI tracking enabled');
  }

  /**
   * Start bot with KPI tracking
   */
  async start(): Promise<void> {
    // Load historical KPIs
    await this.kpiTracker.load();
    
    // Enable auto-save every minute
    this.kpiTracker.enableAutoSave(60000);
    
    // Start KPI reporting every 15 minutes
    this.kpiReportInterval = setInterval(() => {
      this.reportKPIs();
    }, 15 * 60 * 1000);
    
    // Initial KPI report
    setTimeout(() => this.reportKPIs(), 60000); // After 1 minute
    
    // Start main bot
    await super.start();
  }

  /**
   * Stop bot and save KPIs
   */
  async stop(): Promise<void> {
    if (this.kpiReportInterval) {
      clearInterval(this.kpiReportInterval);
    }
    
    // Final KPI report
    this.reportKPIs();
    
    // Save KPIs
    await this.kpiTracker.save();
    
    this.kpiTracker.disableAutoSave();
    
    await super.stop();
  }

  /**
   * Report current KPIs
   */
  private reportKPIs(): void {
    const report = this.kpiTracker.generateReport();
    console.log('\n' + report + '\n');
    
    // Check if circuit breaker should be activated
    if (this.kpiTracker.isCircuitBreakerActive()) {
      log.error('🚨 CIRCUIT BREAKER ACTIVE - Bot execution paused for safety');
    }
    
    // Check performance targets
    const performance = this.kpiTracker.isMeetingPerformanceTargets();
    if (!performance.overall) {
      log.warn('⚠️ Performance targets not met. Consider running optimization.');
      this.suggestOptimizations(performance);
    }
  }

  /**
   * Suggest optimizations based on current performance
   */
  private suggestOptimizations(performance: any): void {
    const suggestions: string[] = [];
    
    if (!performance.details.latency) {
      suggestions.push('- Consider using a faster RPC endpoint or Jito bundles');
      suggestions.push('- Enable skipPreflight for faster submission');
    }
    
    if (!performance.details.fillRate) {
      suggestions.push('- Increase priority fees to improve fill rate');
      suggestions.push('- Review and optimize slippage settings');
    }
    
    if (!performance.details.revertRate) {
      suggestions.push('- Strengthen safety checks to avoid reverted transactions');
      suggestions.push('- Implement better pre-trade validation');
    }
    
    if (!performance.details.profitability) {
      suggestions.push('- Increase minimum profit threshold');
      suggestions.push('- Review and tighten stop-loss parameters');
      suggestions.push('- Consider running A/B tests on strategy parameters');
    }
    
    if (suggestions.length > 0) {
      log.info('💡 OPTIMIZATION SUGGESTIONS:\n' + suggestions.join('\n'));
    }
  }

  /**
   * Get KPI tracker instance
   */
  getKPITracker(): KPITracker {
    return this.kpiTracker;
  }

  /**
   * Get fine-tuning engine instance
   */
  getFineTuningEngine(): FineTuningEngine {
    return this.fineTuningEngine;
  }

  /**
   * Run auto-optimization based on recent performance
   */
  async autoOptimize(testDurationMinutes: number = 30): Promise<void> {
    log.info('Starting auto-optimization...');
    
    // Determine recent performance
    const prof = this.kpiTracker.getProfitabilityMetrics();
    let recentPerformance: 'poor' | 'moderate' | 'good';
    
    if (prof.profitFactor < 1.0 || prof.winRate < 40) {
      recentPerformance = 'poor';
    } else if (prof.profitFactor < 1.5 || prof.winRate < 60) {
      recentPerformance = 'moderate';
    } else {
      recentPerformance = 'good';
    }
    
    log.info(`Recent performance assessed as: ${recentPerformance}`);
    
    // Get current parameters (would need to extract from config in real implementation)
    const currentParams = FineTuningEngine.getDefaultParameters();
    
    // Run optimization
    const optimizedParams = await this.fineTuningEngine.autoOptimize(
      currentParams,
      recentPerformance,
      testDurationMinutes
    );
    
    log.info('Auto-optimization complete');
    log.info('Optimized parameters:', optimizedParams);
    
    // In real implementation, would apply optimizedParams to bot configuration
  }
}

/**
 * Example: Recording execution in strategy
 * 
 * This shows how to integrate KPI recording into your trading strategies.
 */
export function recordExecutionExample(kpiTracker: KPITracker) {
  const startTime = Date.now();
  
  // ... execute trade ...
  
  const submitLatency = Date.now() - startTime;
  const confirmStartTime = Date.now();
  
  // ... wait for confirmation ...
  
  const confirmationLatency = Date.now() - confirmStartTime;
  
  // Record the execution
  kpiTracker.recordExecution({
    submitLatency,
    confirmationLatency,
    confirmationRank: 5, // Position in block
    success: true,
    reverted: false,
    gasUsed: 0.001,
    priorityFee: 0.0005,
    profit: 10.5,
    strategy: 'triangular-arbitrage',
  });
}

/**
 * Example: Recording RPC calls
 */
export function recordRPCExample(kpiTracker: KPITracker) {
  const startTime = Date.now();
  
  // ... make RPC call ...
  
  const latency = Date.now() - startTime;
  
  kpiTracker.recordRPCCall({
    endpoint: 'https://api.mainnet-beta.solana.com',
    latency,
    success: true,
    rateLimited: false,
    timeout: false,
    slotLag: 2,
  });
}

/**
 * Example: Recording safety events
 */
export function recordSafetyExample(kpiTracker: KPITracker) {
  // Honeypot detected
  kpiTracker.recordSafetyEvent({
    type: 'honeypot',
  });
  
  // Rug pull with loss
  kpiTracker.recordSafetyEvent({
    type: 'rugpull',
    loss: 25.5,
  });
  
  // Stop loss triggered
  kpiTracker.recordSafetyEvent({
    type: 'stoploss',
  });
}

/**
 * Example: Recording slippage
 */
export function recordSlippageExample(kpiTracker: KPITracker) {
  const expectedPrice = 100;
  const actualPrice = 101.5;
  const slippagePercent = Math.abs(actualPrice - expectedPrice) / expectedPrice;
  
  kpiTracker.recordSlippage(slippagePercent);
}

/**
 * Example: Running A/B test
 */
export async function runABTestExample(kpiTracker: KPITracker) {
  const engine = new FineTuningEngine(kpiTracker);
  
  const baseline = FineTuningEngine.getDefaultParameters();
  const variants = FineTuningEngine.generateVariants(baseline, 'aggressive');
  
  const testConfig = {
    name: 'Aggressive Strategy Test',
    description: 'Testing more aggressive profit targets',
    baseline,
    variants,
    durationMinutes: 60,
    minTradesRequired: 20,
  };
  
  const targets = [
    { metric: 'profit' as const, weight: 1.0 },
    { metric: 'winRate' as const, weight: 0.5 },
    { metric: 'profitFactor' as const, weight: 0.3 },
  ];
  
  const results = await engine.runABTest(testConfig, targets);
  
  console.log('\n' + engine.generateComparisonReport(results) + '\n');
  
  return results.winner?.parameters || baseline;
}

// Main execution example
if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = new KPIEnabledBot();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });
  
  // Start bot with KPI tracking
  bot.start().catch(console.error);
}
