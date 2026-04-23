/**
 * COMPREHENSIVE KPI TRACKING SYSTEM
 * 
 * Tracks all key performance indicators for the trading bot including:
 * - Execution speed & reliability metrics
 * - RPC performance monitoring
 * - Risk & safety effectiveness
 * - Profitability & cost analysis
 */

import { Logger } from './logger.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const log = Logger.getInstance();

// ============================================================================
// KPI INTERFACES
// ============================================================================

export interface LatencyMetrics {
  p50: number; // 50th percentile (median)
  p95: number; // 95th percentile
  p99: number; // 99th percentile
  min: number;
  max: number;
  avg: number;
  samples: number[];
}

export interface ExecutionMetrics {
  // Speed metrics
  submitLatency: LatencyMetrics; // Time to submit transaction
  confirmationLatency: LatencyMetrics; // Time to confirm transaction
  endToEndLatency: LatencyMetrics; // Total cycle time
  confirmationRank: number[]; // Position in block confirmation
  
  // Success & failure rates
  totalAttempts: number;
  successfulFills: number; // Successful buys
  failedFills: number;
  revertedTransactions: number; // Failed txs that cost fees
  transactionSuccess: number; // Successful tx count
  
  // Competitive timing
  avgExecutionTime: number;
  bestExecutionTime: number;
  worstExecutionTime: number;
}

export interface RPCMetrics {
  // Performance
  latency: LatencyMetrics;
  slotLag: number; // How far behind chain head
  
  // Reliability
  totalCalls: number;
  failedCalls: number;
  rateLimitEvents: number;
  timeouts: number;
  
  // By endpoint
  endpointMetrics: Map<string, {
    calls: number;
    failures: number;
    avgLatency: number;
  }>;
}

export interface RiskMetrics {
  // Safety checks
  anomalyExits: number; // Exits due to rug detection
  honeypotDetections: number;
  suspiciousTokensAvoided: number;
  
  // Slippage control
  realizedSlippage: LatencyMetrics; // Actual vs expected price
  highSlippageEvents: number; // Times slippage exceeded threshold
  
  // Loss events
  rugPulls: number;
  badFills: number;
  totalLossFromScams: number;
  
  // Position management
  emergencyExits: number;
  stopLossTriggered: number;
}

export interface CostMetrics {
  // Transaction costs
  totalGasSpent: number; // In SOL
  totalPriorityFees: number; // In SOL
  wastedFeesFromReverts: number; // In SOL
  
  // Platform costs
  dexFees: number; // In USD
  rpcSubscriptionCost: number; // In USD (if tracked)
  
  // Average costs
  avgGasPerTrade: number;
  avgPriorityFee: number;
  avgDexFee: number;
}

export interface ProfitabilityMetrics {
  // P&L
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  totalTrades: number;
  
  // Performance ratios
  profitFactor: number; // grossProfit / grossLoss
  winRate: number; // Percentage
  avgWin: number;
  avgLoss: number;
  
  // Time-based
  profitByHour: Map<number, number>; // Hour of day -> profit
  profitByDay: Map<string, number>; // Date -> profit
  profitByStrategy: Map<string, number>; // Strategy -> profit
  
  // Risk-adjusted
  sharpeRatio?: number;
  maxDrawdown: number;
  recoveryFactor: number; // netProfit / maxDrawdown
}

export interface CircuitBreakerStatus {
  isActive: boolean;
  reason?: string;
  triggeredAt?: Date;
  consecutiveFailures: number;
  priceDeviationPercent: number;
}

export interface ComprehensiveKPIs {
  startTime: Date;
  lastUpdateTime: Date;
  
  execution: ExecutionMetrics;
  rpc: RPCMetrics;
  risk: RiskMetrics;
  costs: CostMetrics;
  profitability: ProfitabilityMetrics;
  circuitBreaker: CircuitBreakerStatus;
}

// ============================================================================
// KPI TRACKER CLASS
// ============================================================================

export class KPITracker {
  private kpis: ComprehensiveKPIs;
  private storageDir: string;
  private storageFile: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  
  // Configuration thresholds
  private config = {
    maxConsecutiveFailures: 5,
    maxPriceDeviation: 0.05, // 5%
    targetP95Latency: 150, // 150ms target
    highSlippageThreshold: 0.02, // 2%
    maxLatencySamples: 1000, // Keep last 1000 samples
  };

  constructor(storageDir: string = './data/kpis') {
    this.storageDir = storageDir;
    this.storageFile = path.join(storageDir, 'kpi-metrics.json');
    
    this.kpis = this.initializeKPIs();
  }

  /**
   * Initialize KPI structure with default values
   */
  private initializeKPIs(): ComprehensiveKPIs {
    return {
      startTime: new Date(),
      lastUpdateTime: new Date(),
      
      execution: {
        submitLatency: this.createEmptyLatencyMetrics(),
        confirmationLatency: this.createEmptyLatencyMetrics(),
        endToEndLatency: this.createEmptyLatencyMetrics(),
        confirmationRank: [],
        totalAttempts: 0,
        successfulFills: 0,
        failedFills: 0,
        revertedTransactions: 0,
        transactionSuccess: 0,
        avgExecutionTime: 0,
        bestExecutionTime: Infinity,
        worstExecutionTime: 0,
      },
      
      rpc: {
        latency: this.createEmptyLatencyMetrics(),
        slotLag: 0,
        totalCalls: 0,
        failedCalls: 0,
        rateLimitEvents: 0,
        timeouts: 0,
        endpointMetrics: new Map(),
      },
      
      risk: {
        anomalyExits: 0,
        honeypotDetections: 0,
        suspiciousTokensAvoided: 0,
        realizedSlippage: this.createEmptyLatencyMetrics(),
        highSlippageEvents: 0,
        rugPulls: 0,
        badFills: 0,
        totalLossFromScams: 0,
        emergencyExits: 0,
        stopLossTriggered: 0,
      },
      
      costs: {
        totalGasSpent: 0,
        totalPriorityFees: 0,
        wastedFeesFromReverts: 0,
        dexFees: 0,
        rpcSubscriptionCost: 0,
        avgGasPerTrade: 0,
        avgPriorityFee: 0,
        avgDexFee: 0,
      },
      
      profitability: {
        grossProfit: 0,
        grossLoss: 0,
        netProfit: 0,
        totalTrades: 0,
        profitFactor: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitByHour: new Map(),
        profitByDay: new Map(),
        profitByStrategy: new Map(),
        maxDrawdown: 0,
        recoveryFactor: 0,
      },
      
      circuitBreaker: {
        isActive: false,
        consecutiveFailures: 0,
        priceDeviationPercent: 0,
      },
    };
  }

  /**
   * Create empty latency metrics structure
   */
  private createEmptyLatencyMetrics(): LatencyMetrics {
    return {
      p50: 0,
      p95: 0,
      p99: 0,
      min: Infinity,
      max: 0,
      avg: 0,
      samples: [],
    };
  }

  /**
   * Load KPIs from storage
   */
  async load(): Promise<void> {
    try {
      if (!existsSync(this.storageDir)) {
        await mkdir(this.storageDir, { recursive: true });
      }
      
      if (existsSync(this.storageFile)) {
        const data = await readFile(this.storageFile, 'utf-8');
        const loaded = JSON.parse(data);
        
        // Convert date strings back to Date objects
        loaded.startTime = new Date(loaded.startTime);
        loaded.lastUpdateTime = new Date(loaded.lastUpdateTime);
        if (loaded.circuitBreaker.triggeredAt) {
          loaded.circuitBreaker.triggeredAt = new Date(loaded.circuitBreaker.triggeredAt);
        }
        
        // Convert Map objects
        loaded.rpc.endpointMetrics = new Map(Object.entries(loaded.rpc.endpointMetrics || {}));
        loaded.profitability.profitByHour = new Map(Object.entries(loaded.profitability.profitByHour || {}));
        loaded.profitability.profitByDay = new Map(Object.entries(loaded.profitability.profitByDay || {}));
        loaded.profitability.profitByStrategy = new Map(Object.entries(loaded.profitability.profitByStrategy || {}));
        
        this.kpis = loaded;
        log.info('KPI metrics loaded from storage', { file: this.storageFile });
      }
    } catch (error) {
      log.warn('Failed to load KPI metrics, using defaults', error);
    }
  }

  /**
   * Save KPIs to storage
   */
  async save(): Promise<void> {
    try {
      if (!existsSync(this.storageDir)) {
        await mkdir(this.storageDir, { recursive: true });
      }
      
      // Convert Maps to objects for JSON serialization
      const toSave = {
        ...this.kpis,
        rpc: {
          ...this.kpis.rpc,
          endpointMetrics: Object.fromEntries(this.kpis.rpc.endpointMetrics),
        },
        profitability: {
          ...this.kpis.profitability,
          profitByHour: Object.fromEntries(this.kpis.profitability.profitByHour),
          profitByDay: Object.fromEntries(this.kpis.profitability.profitByDay),
          profitByStrategy: Object.fromEntries(this.kpis.profitability.profitByStrategy),
        },
      };
      
      await writeFile(this.storageFile, JSON.stringify(toSave, null, 2));
      log.debug('KPI metrics saved to storage');
    } catch (error) {
      log.error('Failed to save KPI metrics', error);
    }
  }

  /**
   * Enable auto-save at interval
   */
  enableAutoSave(intervalMs: number = 60000): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    this.autoSaveInterval = setInterval(() => {
      this.save().catch(err => log.error('Auto-save failed', err));
    }, intervalMs);
    
    log.info('KPI auto-save enabled', { intervalMs });
  }

  /**
   * Disable auto-save
   */
  disableAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      log.info('KPI auto-save disabled');
    }
  }

  /**
   * Update latency metrics with new sample
   */
  private updateLatencyMetrics(metrics: LatencyMetrics, latency: number): void {
    // Add sample (limit size to prevent memory issues)
    metrics.samples.push(latency);
    if (metrics.samples.length > this.config.maxLatencySamples) {
      metrics.samples.shift();
    }
    
    // Update basic stats
    metrics.min = Math.min(metrics.min, latency);
    metrics.max = Math.max(metrics.max, latency);
    metrics.avg = metrics.samples.reduce((a, b) => a + b, 0) / metrics.samples.length;
    
    // Calculate percentiles
    if (metrics.samples.length > 0) {
      const sorted = [...metrics.samples].sort((a, b) => a - b);
      metrics.p50 = this.percentile(sorted, 50);
      metrics.p95 = this.percentile(sorted, 95);
      metrics.p99 = this.percentile(sorted, 99);
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // ============================================================================
  // RECORDING METHODS
  // ============================================================================

  /**
   * Record transaction execution
   */
  recordExecution(params: {
    submitLatency: number;
    confirmationLatency?: number;
    confirmationRank?: number;
    success: boolean;
    reverted?: boolean;
    gasUsed: number;
    priorityFee: number;
    profit?: number;
    strategy?: string;
  }): void {
    this.kpis.lastUpdateTime = new Date();
    const exec = this.kpis.execution;
    
    // Update latencies
    this.updateLatencyMetrics(exec.submitLatency, params.submitLatency);
    if (params.confirmationLatency) {
      this.updateLatencyMetrics(exec.confirmationLatency, params.confirmationLatency);
      const endToEnd = params.submitLatency + params.confirmationLatency;
      this.updateLatencyMetrics(exec.endToEndLatency, endToEnd);
      
      // Update execution time tracking
      exec.avgExecutionTime = exec.endToEndLatency.avg;
      exec.bestExecutionTime = Math.min(exec.bestExecutionTime, endToEnd);
      exec.worstExecutionTime = Math.max(exec.worstExecutionTime, endToEnd);
    }
    
    if (params.confirmationRank !== undefined) {
      exec.confirmationRank.push(params.confirmationRank);
      if (exec.confirmationRank.length > this.config.maxLatencySamples) {
        exec.confirmationRank.shift();
      }
    }
    
    // Update success/failure metrics
    exec.totalAttempts++;
    if (params.success) {
      exec.successfulFills++;
      exec.transactionSuccess++;
      this.kpis.circuitBreaker.consecutiveFailures = 0; // Reset on success
    } else {
      exec.failedFills++;
      this.kpis.circuitBreaker.consecutiveFailures++;
      
      if (params.reverted) {
        exec.revertedTransactions++;
        this.kpis.costs.wastedFeesFromReverts += params.gasUsed;
      }
    }
    
    // Update costs
    this.kpis.costs.totalGasSpent += params.gasUsed;
    this.kpis.costs.totalPriorityFees += params.priorityFee;
    
    // Calculate averages
    const totalTrades = this.kpis.profitability.totalTrades || 1;
    this.kpis.costs.avgGasPerTrade = this.kpis.costs.totalGasSpent / totalTrades;
    this.kpis.costs.avgPriorityFee = this.kpis.costs.totalPriorityFees / totalTrades;
    
    // Update profitability if provided
    if (params.profit !== undefined) {
      this.recordProfit({
        profit: params.profit,
        strategy: params.strategy,
      });
    }
    
    // Check circuit breaker
    this.checkCircuitBreaker();
  }

  /**
   * Record RPC call
   */
  recordRPCCall(params: {
    endpoint: string;
    latency: number;
    success: boolean;
    rateLimited?: boolean;
    timeout?: boolean;
    slotLag?: number;
  }): void {
    this.kpis.lastUpdateTime = new Date();
    const rpc = this.kpis.rpc;
    
    // Update global stats
    rpc.totalCalls++;
    this.updateLatencyMetrics(rpc.latency, params.latency);
    
    if (!params.success) {
      rpc.failedCalls++;
    }
    
    if (params.rateLimited) {
      rpc.rateLimitEvents++;
    }
    
    if (params.timeout) {
      rpc.timeouts++;
    }
    
    if (params.slotLag !== undefined) {
      rpc.slotLag = params.slotLag;
    }
    
    // Update endpoint-specific metrics
    const endpointKey = params.endpoint;
    let endpointMetric = rpc.endpointMetrics.get(endpointKey);
    
    if (!endpointMetric) {
      endpointMetric = {
        calls: 0,
        failures: 0,
        avgLatency: 0,
      };
      rpc.endpointMetrics.set(endpointKey, endpointMetric);
    }
    
    endpointMetric.calls++;
    if (!params.success) {
      endpointMetric.failures++;
    }
    
    // Update average latency
    endpointMetric.avgLatency = 
      (endpointMetric.avgLatency * (endpointMetric.calls - 1) + params.latency) / endpointMetric.calls;
  }

  /**
   * Record safety event
   */
  recordSafetyEvent(params: {
    type: 'anomaly' | 'honeypot' | 'suspicious' | 'rugpull' | 'badfill' | 'emergency' | 'stoploss';
    loss?: number;
  }): void {
    this.kpis.lastUpdateTime = new Date();
    const risk = this.kpis.risk;
    
    switch (params.type) {
      case 'anomaly':
        risk.anomalyExits++;
        break;
      case 'honeypot':
        risk.honeypotDetections++;
        break;
      case 'suspicious':
        risk.suspiciousTokensAvoided++;
        break;
      case 'rugpull':
        risk.rugPulls++;
        if (params.loss) risk.totalLossFromScams += params.loss;
        break;
      case 'badfill':
        risk.badFills++;
        if (params.loss) risk.totalLossFromScams += params.loss;
        break;
      case 'emergency':
        risk.emergencyExits++;
        break;
      case 'stoploss':
        risk.stopLossTriggered++;
        break;
    }
  }

  /**
   * Record slippage
   */
  recordSlippage(slippagePercent: number): void {
    this.kpis.lastUpdateTime = new Date();
    const risk = this.kpis.risk;
    
    this.updateLatencyMetrics(risk.realizedSlippage, Math.abs(slippagePercent));
    
    if (Math.abs(slippagePercent) > this.config.highSlippageThreshold) {
      risk.highSlippageEvents++;
    }
  }

  /**
   * Record profit/loss
   */
  recordProfit(params: {
    profit: number;
    strategy?: string;
  }): void {
    this.kpis.lastUpdateTime = new Date();
    const prof = this.kpis.profitability;
    
    prof.totalTrades++;
    
    if (params.profit > 0) {
      prof.grossProfit += params.profit;
      prof.avgWin = prof.grossProfit / Math.max(1, prof.totalTrades);
    } else {
      prof.grossLoss += Math.abs(params.profit);
      prof.avgLoss = prof.grossLoss / Math.max(1, prof.totalTrades);
    }
    
    prof.netProfit = prof.grossProfit - prof.grossLoss;
    prof.profitFactor = prof.grossLoss > 0 ? prof.grossProfit / prof.grossLoss : 0;
    prof.winRate = prof.totalTrades > 0 ? (prof.grossProfit / prof.totalTrades) * 100 : 0;
    
    // Track by hour
    const hour = new Date().getHours();
    const hourProfit = prof.profitByHour.get(hour) || 0;
    prof.profitByHour.set(hour, hourProfit + params.profit);
    
    // Track by day
    const day = new Date().toISOString().split('T')[0];
    const dayProfit = prof.profitByDay.get(day) || 0;
    prof.profitByDay.set(day, dayProfit + params.profit);
    
    // Track by strategy
    if (params.strategy) {
      const strategyProfit = prof.profitByStrategy.get(params.strategy) || 0;
      prof.profitByStrategy.set(params.strategy, strategyProfit + params.profit);
    }
    
    // Update max drawdown
    if (prof.netProfit < 0 && Math.abs(prof.netProfit) > prof.maxDrawdown) {
      prof.maxDrawdown = Math.abs(prof.netProfit);
    }
    
    // Update recovery factor
    prof.recoveryFactor = prof.maxDrawdown > 0 ? prof.netProfit / prof.maxDrawdown : 0;
  }

  /**
   * Record DEX fee
   */
  recordDEXFee(fee: number): void {
    this.kpis.costs.dexFees += fee;
    const totalTrades = this.kpis.profitability.totalTrades || 1;
    this.kpis.costs.avgDexFee = this.kpis.costs.dexFees / totalTrades;
  }

  /**
   * Check and update circuit breaker status
   */
  private checkCircuitBreaker(): void {
    const breaker = this.kpis.circuitBreaker;
    
    // Check consecutive failures
    if (breaker.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.activateCircuitBreaker(`Consecutive failures: ${breaker.consecutiveFailures}`);
      return;
    }
    
    // Check if already active and should be reset
    if (breaker.isActive && breaker.consecutiveFailures < this.config.maxConsecutiveFailures) {
      this.deactivateCircuitBreaker();
    }
  }

  /**
   * Manually activate circuit breaker
   */
  activateCircuitBreaker(reason: string): void {
    this.kpis.circuitBreaker.isActive = true;
    this.kpis.circuitBreaker.reason = reason;
    this.kpis.circuitBreaker.triggeredAt = new Date();
    
    log.warn('🚨 CIRCUIT BREAKER ACTIVATED', { reason });
  }

  /**
   * Deactivate circuit breaker
   */
  deactivateCircuitBreaker(): void {
    if (this.kpis.circuitBreaker.isActive) {
      log.info('✅ Circuit breaker deactivated');
    }
    
    this.kpis.circuitBreaker.isActive = false;
    this.kpis.circuitBreaker.reason = undefined;
    this.kpis.circuitBreaker.triggeredAt = undefined;
  }

  /**
   * Check if circuit breaker is active
   */
  isCircuitBreakerActive(): boolean {
    return this.kpis.circuitBreaker.isActive;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get all KPIs
   */
  getKPIs(): ComprehensiveKPIs {
    return this.kpis;
  }

  /**
   * Get execution metrics
   */
  getExecutionMetrics(): ExecutionMetrics {
    return this.kpis.execution;
  }

  /**
   * Get RPC metrics
   */
  getRPCMetrics(): RPCMetrics {
    return this.kpis.rpc;
  }

  /**
   * Get risk metrics
   */
  getRiskMetrics(): RiskMetrics {
    return this.kpis.risk;
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(): CostMetrics {
    return this.kpis.costs;
  }

  /**
   * Get profitability metrics
   */
  getProfitabilityMetrics(): ProfitabilityMetrics {
    return this.kpis.profitability;
  }

  /**
   * Get fill rate
   */
  getFillRate(): number {
    const exec = this.kpis.execution;
    return exec.totalAttempts > 0 
      ? (exec.successfulFills / exec.totalAttempts) * 100 
      : 0;
  }

  /**
   * Get transaction success rate
   */
  getTransactionSuccessRate(): number {
    const exec = this.kpis.execution;
    return exec.totalAttempts > 0 
      ? (exec.transactionSuccess / exec.totalAttempts) * 100 
      : 0;
  }

  /**
   * Get revert rate
   */
  getRevertRate(): number {
    const exec = this.kpis.execution;
    return exec.totalAttempts > 0 
      ? (exec.revertedTransactions / exec.totalAttempts) * 100 
      : 0;
  }

  /**
   * Get RPC success rate
   */
  getRPCSuccessRate(): number {
    const rpc = this.kpis.rpc;
    return rpc.totalCalls > 0 
      ? ((rpc.totalCalls - rpc.failedCalls) / rpc.totalCalls) * 100 
      : 0;
  }

  /**
   * Get average confirmation rank
   */
  getAvgConfirmationRank(): number {
    const ranks = this.kpis.execution.confirmationRank;
    return ranks.length > 0 
      ? ranks.reduce((a, b) => a + b, 0) / ranks.length 
      : 0;
  }

  /**
   * Check if meeting performance targets
   */
  isMeetingPerformanceTargets(): {
    overall: boolean;
    details: {
      latency: boolean;
      fillRate: boolean;
      revertRate: boolean;
      profitability: boolean;
    };
  } {
    const exec = this.kpis.execution;
    const prof = this.kpis.profitability;
    
    const latencyGood = exec.endToEndLatency.p95 <= this.config.targetP95Latency;
    const fillRateGood = this.getFillRate() >= 80; // Target: 80%
    const revertRateGood = this.getRevertRate() <= 10; // Target: <10%
    const profitabilityGood = prof.profitFactor > 1.5; // Target: 1.5x
    
    return {
      overall: latencyGood && fillRateGood && revertRateGood && profitabilityGood,
      details: {
        latency: latencyGood,
        fillRate: fillRateGood,
        revertRate: revertRateGood,
        profitability: profitabilityGood,
      },
    };
  }

  /**
   * Generate comprehensive report
   */
  generateReport(): string {
    const kpis = this.kpis;
    const exec = kpis.execution;
    const rpc = kpis.rpc;
    const risk = kpis.risk;
    const costs = kpis.costs;
    const prof = kpis.profitability;
    const breaker = kpis.circuitBreaker;
    
    const uptime = Date.now() - kpis.startTime.getTime();
    const uptimeHours = (uptime / (1000 * 60 * 60)).toFixed(2);
    
    const performance = this.isMeetingPerformanceTargets();
    
    return `
╔════════════════════════════════════════════════════════════════════════════╗
║                       COMPREHENSIVE KPI REPORT                              ║
╠════════════════════════════════════════════════════════════════════════════╣
║ SYSTEM STATUS                                                               ║
║ Uptime: ${uptimeHours}h | Last Update: ${kpis.lastUpdateTime.toLocaleTimeString()}
║ Circuit Breaker: ${breaker.isActive ? '🚨 ACTIVE' : '✅ Normal'} ${breaker.reason ? `(${breaker.reason})` : ''}
║ Performance Target: ${performance.overall ? '✅ Meeting' : '⚠️ Below Target'}
╠════════════════════════════════════════════════════════════════════════════╣
║ EXECUTION SPEED & RELIABILITY                                               ║
║ Submit Latency:     P50=${exec.submitLatency.p50.toFixed(0)}ms P95=${exec.submitLatency.p95.toFixed(0)}ms P99=${exec.submitLatency.p99.toFixed(0)}ms
║ Confirmation:       P50=${exec.confirmationLatency.p50.toFixed(0)}ms P95=${exec.confirmationLatency.p95.toFixed(0)}ms
║ End-to-End:         P50=${exec.endToEndLatency.p50.toFixed(0)}ms P95=${exec.endToEndLatency.p95.toFixed(0)}ms [Target: <${this.config.targetP95Latency}ms]
║ Avg Confirmation Rank: ${this.getAvgConfirmationRank().toFixed(1)}
║ 
║ Fill Rate:          ${this.getFillRate().toFixed(2)}% (${exec.successfulFills}/${exec.totalAttempts})
║ Transaction Success: ${this.getTransactionSuccessRate().toFixed(2)}%
║ Revert Rate:        ${this.getRevertRate().toFixed(2)}% (${exec.revertedTransactions} reverted)
║ 
║ Best Execution:     ${exec.bestExecutionTime === Infinity ? 'N/A' : exec.bestExecutionTime.toFixed(0) + 'ms'}
║ Worst Execution:    ${exec.worstExecutionTime === 0 ? 'N/A' : exec.worstExecutionTime.toFixed(0) + 'ms'}
║ Average Execution:  ${exec.avgExecutionTime.toFixed(0)}ms
╠════════════════════════════════════════════════════════════════════════════╣
║ RPC PERFORMANCE                                                             ║
║ Latency:            P50=${rpc.latency.p50.toFixed(0)}ms P95=${rpc.latency.p95.toFixed(0)}ms P99=${rpc.latency.p99.toFixed(0)}ms
║ Success Rate:       ${this.getRPCSuccessRate().toFixed(2)}% (${rpc.totalCalls - rpc.failedCalls}/${rpc.totalCalls})
║ Rate Limits:        ${rpc.rateLimitEvents} events
║ Timeouts:           ${rpc.timeouts}
║ Slot Lag:           ${rpc.slotLag} slots
╠════════════════════════════════════════════════════════════════════════════╣
║ RISK & SAFETY                                                               ║
║ Anomaly Exits:      ${risk.anomalyExits}
║ Honeypot Detected:  ${risk.honeypotDetections}
║ Suspicious Avoided: ${risk.suspiciousTokensAvoided}
║ 
║ Slippage:           P50=${risk.realizedSlippage.p50.toFixed(2)}% P95=${risk.realizedSlippage.p95.toFixed(2)}%
║ High Slippage:      ${risk.highSlippageEvents} events (>${(this.config.highSlippageThreshold * 100).toFixed(0)}%)
║ 
║ Rug Pulls:          ${risk.rugPulls}
║ Bad Fills:          ${risk.badFills}
║ Total Scam Loss:    $${risk.totalLossFromScams.toFixed(2)}
║ 
║ Emergency Exits:    ${risk.emergencyExits}
║ Stop Loss Triggered: ${risk.stopLossTriggered}
╠════════════════════════════════════════════════════════════════════════════╣
║ COSTS                                                                       ║
║ Total Gas:          ${costs.totalGasSpent.toFixed(4)} SOL ($${(costs.totalGasSpent * 230).toFixed(2)})
║ Priority Fees:      ${costs.totalPriorityFees.toFixed(4)} SOL ($${(costs.totalPriorityFees * 230).toFixed(2)})
║ Wasted (Reverts):   ${costs.wastedFeesFromReverts.toFixed(4)} SOL ($${(costs.wastedFeesFromReverts * 230).toFixed(2)})
║ DEX Fees:           $${costs.dexFees.toFixed(2)}
║ 
║ Avg Gas/Trade:      ${costs.avgGasPerTrade.toFixed(6)} SOL
║ Avg Priority/Trade: ${costs.avgPriorityFee.toFixed(6)} SOL
║ Avg DEX Fee/Trade:  $${costs.avgDexFee.toFixed(4)}
╠════════════════════════════════════════════════════════════════════════════╣
║ PROFITABILITY                                                               ║
║ Net Profit:         $${prof.netProfit.toFixed(2)}
║ Gross Profit:       $${prof.grossProfit.toFixed(2)}
║ Gross Loss:         $${prof.grossLoss.toFixed(2)}
║ 
║ Total Trades:       ${prof.totalTrades}
║ Profit Factor:      ${prof.profitFactor.toFixed(2)}x [Target: >1.5x]
║ Win Rate:           ${prof.winRate.toFixed(2)}%
║ Avg Win:            $${prof.avgWin.toFixed(4)}
║ Avg Loss:           $${prof.avgLoss.toFixed(4)}
║ 
║ Max Drawdown:       $${prof.maxDrawdown.toFixed(2)}
║ Recovery Factor:    ${prof.recoveryFactor.toFixed(2)}x
║ ${prof.sharpeRatio ? `Sharpe Ratio:       ${prof.sharpeRatio.toFixed(2)}` : ''}
╠════════════════════════════════════════════════════════════════════════════╣
║ PERFORMANCE ASSESSMENT                                                      ║
║ Latency Target:     ${performance.details.latency ? '✅ Met' : '❌ Not Met'}
║ Fill Rate Target:   ${performance.details.fillRate ? '✅ Met' : '❌ Not Met'}
║ Revert Rate Target: ${performance.details.revertRate ? '✅ Met' : '❌ Not Met'}
║ Profit Target:      ${performance.details.profitability ? '✅ Met' : '❌ Not Met'}
╚════════════════════════════════════════════════════════════════════════════╝
    `.trim();
  }

  /**
   * Reset all KPIs
   */
  reset(): void {
    this.kpis = this.initializeKPIs();
    log.info('KPI metrics reset');
  }
}
