/**
 * FINE-TUNING SYSTEM
 * 
 * Provides systematic parameter optimization and A/B testing capabilities
 * for trading strategy fine-tuning based on KPI feedback.
 */

import { Logger } from './logger.js';
import { KPITracker } from './kpiTracker.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const log = Logger.getInstance();

// ============================================================================
// INTERFACES
// ============================================================================

export interface TradingParameters {
  // Strategy parameters
  minProfitThreshold: number;
  maxSlippage: number;
  maxGasFee: number;
  maxPositionSize: number;
  
  // Safety parameters
  stopLossPercent: number;
  takeProfitPercent: number;
  maxHoldTimeMinutes: number;
  
  // Execution parameters
  priorityFeeMultiplier: number;
  useJitoBundles: boolean;
  commitmentLevel: 'processed' | 'confirmed' | 'finalized';
  skipPreflight: boolean;
  
  // Risk parameters
  minLiquidityUSD: number;
  maxTokenAge: number; // -1 for no limit
  minHolderCount: number;
  honeypotRiskThreshold: number;
}

export interface ParameterTestResult {
  parameters: TradingParameters;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  
  // Performance metrics
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  profitUSD: number;
  lossUSD: number;
  netProfitUSD: number;
  
  // Key metrics
  winRate: number;
  profitFactor: number;
  avgExecutionTime: number;
  fillRate: number;
  revertRate: number;
  
  // Cost metrics
  totalGasSpent: number;
  totalFees: number;
  
  // Score (for comparison)
  score: number;
}

export interface ABTestConfig {
  name: string;
  description: string;
  baseline: TradingParameters;
  variants: TradingParameters[];
  durationMinutes: number;
  minTradesRequired: number;
}

export interface ABTestResults {
  config: ABTestConfig;
  results: ParameterTestResult[];
  winner?: ParameterTestResult;
  recommendation: string;
}

export interface OptimizationTarget {
  metric: 'profit' | 'winRate' | 'profitFactor' | 'executionTime' | 'fillRate';
  weight: number;
}

// ============================================================================
// FINE-TUNING ENGINE
// ============================================================================

export class FineTuningEngine {
  private storageDir: string;
  private kpiTracker: KPITracker;
  private currentTest?: {
    config: ABTestConfig;
    startTime: Date;
    variantIndex: number;
    variantStartTime: Date;
  };

  constructor(kpiTracker: KPITracker, storageDir: string = './data/fine-tuning') {
    this.storageDir = storageDir;
    this.kpiTracker = kpiTracker;
  }

  /**
   * Get default trading parameters (baseline)
   */
  static getDefaultParameters(): TradingParameters {
    return {
      // Strategy
      minProfitThreshold: 0.002, // 0.2%
      maxSlippage: 0.005, // 0.5%
      maxGasFee: 0.02, // 0.02 SOL
      maxPositionSize: 5000, // $5000
      
      // Safety
      stopLossPercent: 0.08, // 8%
      takeProfitPercent: 0.15, // 15%
      maxHoldTimeMinutes: 5,
      
      // Execution
      priorityFeeMultiplier: 2.0,
      useJitoBundles: false,
      commitmentLevel: 'confirmed',
      skipPreflight: false,
      
      // Risk
      minLiquidityUSD: 5000,
      maxTokenAge: -1, // No limit
      minHolderCount: 10,
      honeypotRiskThreshold: 60,
    };
  }

  /**
   * Generate parameter variants for testing
   */
  static generateVariants(baseline: TradingParameters, focus: 'aggressive' | 'conservative' | 'speed'): TradingParameters[] {
    const variants: TradingParameters[] = [];
    
    if (focus === 'aggressive') {
      // More aggressive profit targets and risk tolerance
      variants.push({
        ...baseline,
        minProfitThreshold: baseline.minProfitThreshold * 0.5, // Lower threshold
        maxSlippage: baseline.maxSlippage * 1.5, // Allow more slippage
        stopLossPercent: baseline.stopLossPercent * 1.25, // Wider stop loss
        takeProfitPercent: baseline.takeProfitPercent * 1.5, // Higher profit target
      });
      
      variants.push({
        ...baseline,
        minProfitThreshold: baseline.minProfitThreshold * 0.75,
        maxPositionSize: baseline.maxPositionSize * 2, // Larger positions
        priorityFeeMultiplier: baseline.priorityFeeMultiplier * 1.5, // Higher priority
      });
    } else if (focus === 'conservative') {
      // More conservative with tighter risk controls
      variants.push({
        ...baseline,
        minProfitThreshold: baseline.minProfitThreshold * 1.5, // Higher threshold
        maxSlippage: baseline.maxSlippage * 0.7, // Tighter slippage
        stopLossPercent: baseline.stopLossPercent * 0.75, // Tighter stop loss
        maxPositionSize: baseline.maxPositionSize * 0.5, // Smaller positions
      });
      
      variants.push({
        ...baseline,
        minProfitThreshold: baseline.minProfitThreshold * 2,
        minLiquidityUSD: baseline.minLiquidityUSD * 2, // Require more liquidity
        honeypotRiskThreshold: baseline.honeypotRiskThreshold * 0.7, // Stricter safety
      });
    } else if (focus === 'speed') {
      // Optimize for execution speed
      variants.push({
        ...baseline,
        commitmentLevel: 'processed', // Faster confirmation
        skipPreflight: true, // Skip preflight checks
        priorityFeeMultiplier: baseline.priorityFeeMultiplier * 2, // Higher priority
      });
      
      variants.push({
        ...baseline,
        useJitoBundles: true, // Use Jito for speed
        priorityFeeMultiplier: baseline.priorityFeeMultiplier * 1.5,
        commitmentLevel: 'processed',
      });
    }
    
    return variants;
  }

  /**
   * Calculate performance score for parameter set
   */
  private calculateScore(result: Partial<ParameterTestResult>, targets: OptimizationTarget[]): number {
    let score = 0;
    
    for (const target of targets) {
      let metricValue = 0;
      
      switch (target.metric) {
        case 'profit':
          metricValue = result.netProfitUSD || 0;
          break;
        case 'winRate':
          metricValue = result.winRate || 0;
          break;
        case 'profitFactor':
          metricValue = (result.profitFactor || 0) * 100; // Scale to similar range
          break;
        case 'executionTime':
          // Lower is better, so invert
          metricValue = result.avgExecutionTime ? 1000 / result.avgExecutionTime : 0;
          break;
        case 'fillRate':
          metricValue = result.fillRate || 0;
          break;
      }
      
      score += metricValue * target.weight;
    }
    
    return score;
  }

  /**
   * Capture current KPIs as test result
   */
  private captureTestResult(params: TradingParameters, startTime: Date): ParameterTestResult {
    const endTime = new Date();
    const kpis = this.kpiTracker.getKPIs();
    
    const result: ParameterTestResult = {
      parameters: params,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      
      totalTrades: kpis.profitability.totalTrades,
      successfulTrades: kpis.execution.successfulFills,
      failedTrades: kpis.execution.failedFills,
      profitUSD: kpis.profitability.grossProfit,
      lossUSD: kpis.profitability.grossLoss,
      netProfitUSD: kpis.profitability.netProfit,
      
      winRate: kpis.profitability.winRate,
      profitFactor: kpis.profitability.profitFactor,
      avgExecutionTime: kpis.execution.avgExecutionTime,
      fillRate: this.kpiTracker.getFillRate(),
      revertRate: this.kpiTracker.getRevertRate(),
      
      totalGasSpent: kpis.costs.totalGasSpent,
      totalFees: kpis.costs.totalGasSpent + kpis.costs.totalPriorityFees + (kpis.costs.dexFees / 230), // Convert to SOL
      
      score: 0, // Will be calculated later
    };
    
    return result;
  }

  /**
   * Run A/B test
   */
  async runABTest(config: ABTestConfig, targets: OptimizationTarget[]): Promise<ABTestResults> {
    log.info('Starting A/B test', { name: config.name, variants: config.variants.length });
    
    const results: ParameterTestResult[] = [];
    
    // Test baseline first
    log.info('Testing baseline parameters');
    const baselineResult = await this.testParameters(
      config.baseline,
      config.durationMinutes,
      config.minTradesRequired
    );
    baselineResult.score = this.calculateScore(baselineResult, targets);
    results.push(baselineResult);
    
    // Test each variant
    for (let i = 0; i < config.variants.length; i++) {
      log.info(`Testing variant ${i + 1}/${config.variants.length}`);
      const variantResult = await this.testParameters(
        config.variants[i],
        config.durationMinutes,
        config.minTradesRequired
      );
      variantResult.score = this.calculateScore(variantResult, targets);
      results.push(variantResult);
    }
    
    // Find winner
    const winner = results.reduce((best, current) => 
      current.score > best.score ? current : best
    );
    
    // Generate recommendation
    const isBaselineWinner = winner === results[0];
    const improvement = isBaselineWinner ? 0 : 
      ((winner.score - results[0].score) / results[0].score) * 100;
    
    const recommendation = isBaselineWinner
      ? 'Current parameters are optimal. No changes recommended.'
      : `Switch to variant with ${improvement.toFixed(2)}% better performance. ` +
        `Key improvements: Net profit $${(winner.netProfitUSD - results[0].netProfitUSD).toFixed(2)}, ` +
        `Win rate ${(winner.winRate - results[0].winRate).toFixed(2)}%`;
    
    const testResults: ABTestResults = {
      config,
      results,
      winner,
      recommendation,
    };
    
    // Save results
    await this.saveTestResults(testResults);
    
    log.info('A/B test completed', {
      winner: results.indexOf(winner) === 0 ? 'baseline' : `variant ${results.indexOf(winner)}`,
      improvement: improvement.toFixed(2) + '%',
    });
    
    return testResults;
  }

  /**
   * Test specific parameters for duration
   */
  private async testParameters(
    params: TradingParameters,
    durationMinutes: number,
    minTrades: number
  ): Promise<ParameterTestResult> {
    const startTime = new Date();
    
    // Reset KPI tracker for clean test
    this.kpiTracker.reset();
    
    log.info('Parameter test started', {
      duration: durationMinutes,
      minTrades,
      params: {
        minProfit: params.minProfitThreshold,
        maxSlippage: params.maxSlippage,
        stopLoss: params.stopLossPercent,
      },
    });
    
    // In real implementation, this would apply params to bot and run
    // For now, we'll simulate by waiting and capturing current state
    const endTime = Date.now() + durationMinutes * 60 * 1000;
    
    while (Date.now() < endTime) {
      const kpis = this.kpiTracker.getKPIs();
      
      // Check if we've met minimum trades requirement
      if (kpis.profitability.totalTrades >= minTrades) {
        log.info('Minimum trades requirement met', { trades: kpis.profitability.totalTrades });
        break;
      }
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10s
    }
    
    const result = this.captureTestResult(params, startTime);
    
    log.info('Parameter test completed', {
      trades: result.totalTrades,
      profit: result.netProfitUSD.toFixed(2),
      winRate: result.winRate.toFixed(2),
    });
    
    return result;
  }

  /**
   * Save test results
   */
  private async saveTestResults(results: ABTestResults): Promise<void> {
    try {
      if (!existsSync(this.storageDir)) {
        await mkdir(this.storageDir, { recursive: true });
      }
      
      const filename = `ab-test-${results.config.name.replace(/\s+/g, '-')}-${Date.now()}.json`;
      const filepath = path.join(this.storageDir, filename);
      
      await writeFile(filepath, JSON.stringify(results, null, 2));
      log.info('A/B test results saved', { file: filepath });
    } catch (error) {
      log.error('Failed to save A/B test results', error);
    }
  }

  /**
   * Load test results
   */
  async loadTestResults(filename: string): Promise<ABTestResults | null> {
    try {
      const filepath = path.join(this.storageDir, filename);
      
      if (!existsSync(filepath)) {
        log.warn('Test results file not found', { file: filepath });
        return null;
      }
      
      const data = await readFile(filepath, 'utf-8');
      const results = JSON.parse(data);
      
      // Convert date strings back to Date objects
      results.results.forEach((r: any) => {
        r.startTime = new Date(r.startTime);
        r.endTime = new Date(r.endTime);
      });
      
      return results;
    } catch (error) {
      log.error('Failed to load test results', error);
      return null;
    }
  }

  /**
   * Generate comparison report
   */
  generateComparisonReport(results: ABTestResults): string {
    const baseline = results.results[0];
    const variants = results.results.slice(1);
    
    let report = `
╔════════════════════════════════════════════════════════════════════════════╗
║                         A/B TEST COMPARISON REPORT                          ║
╠════════════════════════════════════════════════════════════════════════════╣
║ Test: ${results.config.name}
║ Description: ${results.config.description}
║ Duration: ${results.config.durationMinutes} minutes per variant
║ Min Trades Required: ${results.config.minTradesRequired}
╠════════════════════════════════════════════════════════════════════════════╣
║ BASELINE PERFORMANCE
║ Net Profit:      $${baseline.netProfitUSD.toFixed(2)}
║ Total Trades:    ${baseline.totalTrades} (Win: ${baseline.successfulTrades}, Loss: ${baseline.failedTrades})
║ Win Rate:        ${baseline.winRate.toFixed(2)}%
║ Profit Factor:   ${baseline.profitFactor.toFixed(2)}x
║ Fill Rate:       ${baseline.fillRate.toFixed(2)}%
║ Revert Rate:     ${baseline.revertRate.toFixed(2)}%
║ Avg Exec Time:   ${baseline.avgExecutionTime.toFixed(0)}ms
║ Total Fees:      ${baseline.totalFees.toFixed(4)} SOL
║ Score:           ${baseline.score.toFixed(2)}
╠════════════════════════════════════════════════════════════════════════════╣`;

    variants.forEach((variant, i) => {
      const profitDiff = variant.netProfitUSD - baseline.netProfitUSD;
      const winRateDiff = variant.winRate - baseline.winRate;
      const execTimeDiff = variant.avgExecutionTime - baseline.avgExecutionTime;
      const scoreDiff = variant.score - baseline.score;
      const isWinner = results.winner === variant;
      
      report += `
║ VARIANT ${i + 1} ${isWinner ? '👑 WINNER' : ''}
║ Net Profit:      $${variant.netProfitUSD.toFixed(2)} (${profitDiff >= 0 ? '+' : ''}${profitDiff.toFixed(2)})
║ Total Trades:    ${variant.totalTrades} (Win: ${variant.successfulTrades}, Loss: ${variant.failedTrades})
║ Win Rate:        ${variant.winRate.toFixed(2)}% (${winRateDiff >= 0 ? '+' : ''}${winRateDiff.toFixed(2)}%)
║ Profit Factor:   ${variant.profitFactor.toFixed(2)}x
║ Fill Rate:       ${variant.fillRate.toFixed(2)}%
║ Revert Rate:     ${variant.revertRate.toFixed(2)}%
║ Avg Exec Time:   ${variant.avgExecutionTime.toFixed(0)}ms (${execTimeDiff >= 0 ? '+' : ''}${execTimeDiff.toFixed(0)}ms)
║ Total Fees:      ${variant.totalFees.toFixed(4)} SOL
║ Score:           ${variant.score.toFixed(2)} (${scoreDiff >= 0 ? '+' : ''}${scoreDiff.toFixed(2)})
║
║ Key Parameters:
║   Min Profit: ${(variant.parameters.minProfitThreshold * 100).toFixed(2)}% (baseline: ${(baseline.parameters.minProfitThreshold * 100).toFixed(2)}%)
║   Max Slippage: ${(variant.parameters.maxSlippage * 100).toFixed(2)}% (baseline: ${(baseline.parameters.maxSlippage * 100).toFixed(2)}%)
║   Stop Loss: ${(variant.parameters.stopLossPercent * 100).toFixed(2)}% (baseline: ${(baseline.parameters.stopLossPercent * 100).toFixed(2)}%)
║   Priority Fee: ${variant.parameters.priorityFeeMultiplier.toFixed(1)}x (baseline: ${baseline.parameters.priorityFeeMultiplier.toFixed(1)}x)
╠════════════════════════════════════════════════════════════════════════════╣`;
    });

    report += `
║ RECOMMENDATION
║ ${results.recommendation}
╚════════════════════════════════════════════════════════════════════════════╝
    `.trim();
    
    return report;
  }

  /**
   * Optimize parameters automatically based on recent performance
   */
  async autoOptimize(
    currentParams: TradingParameters,
    recentPerformance: 'poor' | 'moderate' | 'good',
    testDurationMinutes: number = 30
  ): Promise<TradingParameters> {
    log.info('Starting auto-optimization', { 
      currentPerformance: recentPerformance,
      testDuration: testDurationMinutes 
    });
    
    let focus: 'aggressive' | 'conservative' | 'speed';
    
    if (recentPerformance === 'poor') {
      focus = 'conservative'; // Reduce risk
    } else if (recentPerformance === 'good') {
      focus = 'aggressive'; // Take more risk for higher returns
    } else {
      focus = 'speed'; // Optimize execution speed
    }
    
    const variants = FineTuningEngine.generateVariants(currentParams, focus);
    
    const config: ABTestConfig = {
      name: `Auto-Optimize-${focus}`,
      description: `Automatic optimization based on ${recentPerformance} performance`,
      baseline: currentParams,
      variants,
      durationMinutes: testDurationMinutes,
      minTradesRequired: 10,
    };
    
    const targets: OptimizationTarget[] = [
      { metric: 'profit', weight: 1.0 },
      { metric: 'winRate', weight: 0.5 },
      { metric: 'profitFactor', weight: 0.3 },
    ];
    
    const results = await this.runABTest(config, targets);
    
    return results.winner?.parameters || currentParams;
  }
}
