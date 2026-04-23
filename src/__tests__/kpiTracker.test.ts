import { KPITracker } from '../utils/kpiTracker';
import { rmSync, existsSync } from 'fs';
import path from 'path';

describe('KPITracker', () => {
  let tracker: KPITracker;
  const testStorageDir = './test-data/kpis';

  beforeEach(() => {
    // Clean up test storage directory
    if (existsSync(testStorageDir)) {
      rmSync(testStorageDir, { recursive: true, force: true });
    }
    tracker = new KPITracker(testStorageDir);
  });

  afterEach(() => {
    tracker.disableAutoSave();
    // Clean up test storage directory
    if (existsSync(testStorageDir)) {
      rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should initialize with default values', () => {
      const kpis = tracker.getKPIs();
      
      expect(kpis.execution.totalAttempts).toBe(0);
      expect(kpis.execution.successfulFills).toBe(0);
      expect(kpis.rpc.totalCalls).toBe(0);
      expect(kpis.profitability.netProfit).toBe(0);
      expect(kpis.circuitBreaker.isActive).toBe(false);
    });
  });

  describe('Execution Recording', () => {
    it('should record successful execution', () => {
      tracker.recordExecution({
        submitLatency: 100,
        confirmationLatency: 200,
        confirmationRank: 5,
        success: true,
        gasUsed: 0.001,
        priorityFee: 0.0005,
        profit: 10,
        strategy: 'arbitrage',
      });

      const exec = tracker.getExecutionMetrics();
      
      expect(exec.totalAttempts).toBe(1);
      expect(exec.successfulFills).toBe(1);
      expect(exec.failedFills).toBe(0);
      expect(exec.transactionSuccess).toBe(1);
      expect(exec.submitLatency.samples).toHaveLength(1);
      expect(exec.submitLatency.samples[0]).toBe(100);
      expect(exec.confirmationLatency.samples[0]).toBe(200);
      expect(exec.endToEndLatency.samples[0]).toBe(300);
    });

    it('should record failed execution', () => {
      tracker.recordExecution({
        submitLatency: 150,
        success: false,
        reverted: true,
        gasUsed: 0.002,
        priorityFee: 0.001,
      });

      const exec = tracker.getExecutionMetrics();
      const costs = tracker.getCostMetrics();
      
      expect(exec.totalAttempts).toBe(1);
      expect(exec.successfulFills).toBe(0);
      expect(exec.failedFills).toBe(1);
      expect(exec.revertedTransactions).toBe(1);
      expect(costs.wastedFeesFromReverts).toBe(0.002);
    });

    it('should calculate latency percentiles correctly', () => {
      // Record multiple executions
      const latencies = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
      
      latencies.forEach(latency => {
        tracker.recordExecution({
          submitLatency: latency,
          success: true,
          gasUsed: 0.001,
          priorityFee: 0.0005,
        });
      });

      const exec = tracker.getExecutionMetrics();
      
      // Check that percentiles are calculated
      expect(exec.submitLatency.p50).toBeGreaterThan(0);
      expect(exec.submitLatency.p95).toBeGreaterThan(exec.submitLatency.p50);
      expect(exec.submitLatency.p99).toBeGreaterThan(exec.submitLatency.p95);
      expect(exec.submitLatency.avg).toBeCloseTo(275, 0);
    });
  });

  describe('RPC Recording', () => {
    it('should record RPC call success', () => {
      tracker.recordRPCCall({
        endpoint: 'https://api.mainnet-beta.solana.com',
        latency: 100,
        success: true,
        slotLag: 2,
      });

      const rpc = tracker.getRPCMetrics();
      
      expect(rpc.totalCalls).toBe(1);
      expect(rpc.failedCalls).toBe(0);
      expect(rpc.slotLag).toBe(2);
      expect(rpc.latency.samples[0]).toBe(100);
    });

    it('should record RPC call failure', () => {
      tracker.recordRPCCall({
        endpoint: 'https://api.mainnet-beta.solana.com',
        latency: 500,
        success: false,
        timeout: true,
      });

      const rpc = tracker.getRPCMetrics();
      
      expect(rpc.totalCalls).toBe(1);
      expect(rpc.failedCalls).toBe(1);
      expect(rpc.timeouts).toBe(1);
    });

    it('should track endpoint-specific metrics', () => {
      const endpoint1 = 'https://api.mainnet-beta.solana.com';
      const endpoint2 = 'https://helius-rpc.com';
      
      tracker.recordRPCCall({ endpoint: endpoint1, latency: 100, success: true });
      tracker.recordRPCCall({ endpoint: endpoint1, latency: 150, success: true });
      tracker.recordRPCCall({ endpoint: endpoint2, latency: 50, success: true });

      const rpc = tracker.getRPCMetrics();
      
      expect(rpc.endpointMetrics.size).toBe(2);
      expect(rpc.endpointMetrics.get(endpoint1)?.calls).toBe(2);
      expect(rpc.endpointMetrics.get(endpoint2)?.calls).toBe(1);
    });
  });

  describe('Safety Event Recording', () => {
    it('should record anomaly exits', () => {
      tracker.recordSafetyEvent({ type: 'anomaly' });
      
      const risk = tracker.getRiskMetrics();
      expect(risk.anomalyExits).toBe(1);
    });

    it('should record honeypot detections', () => {
      tracker.recordSafetyEvent({ type: 'honeypot' });
      
      const risk = tracker.getRiskMetrics();
      expect(risk.honeypotDetections).toBe(1);
    });

    it('should record rug pulls with loss', () => {
      tracker.recordSafetyEvent({ type: 'rugpull', loss: 50 });
      
      const risk = tracker.getRiskMetrics();
      expect(risk.rugPulls).toBe(1);
      expect(risk.totalLossFromScams).toBe(50);
    });

    it('should record stop loss triggers', () => {
      tracker.recordSafetyEvent({ type: 'stoploss' });
      
      const risk = tracker.getRiskMetrics();
      expect(risk.stopLossTriggered).toBe(1);
    });
  });

  describe('Slippage Recording', () => {
    it('should record slippage within threshold', () => {
      tracker.recordSlippage(0.01); // 1%
      
      const risk = tracker.getRiskMetrics();
      expect(risk.realizedSlippage.samples).toHaveLength(1);
      expect(risk.highSlippageEvents).toBe(0);
    });

    it('should detect high slippage events', () => {
      tracker.recordSlippage(0.03); // 3% - above default 2% threshold
      
      const risk = tracker.getRiskMetrics();
      expect(risk.highSlippageEvents).toBe(1);
    });
  });

  describe('Profitability Recording', () => {
    it('should record profit', () => {
      tracker.recordProfit({ profit: 100, strategy: 'arbitrage' });
      
      const prof = tracker.getProfitabilityMetrics();
      
      expect(prof.totalTrades).toBe(1);
      expect(prof.grossProfit).toBe(100);
      expect(prof.grossLoss).toBe(0);
      expect(prof.netProfit).toBe(100);
    });

    it('should record loss', () => {
      tracker.recordProfit({ profit: -50 });
      
      const prof = tracker.getProfitabilityMetrics();
      
      expect(prof.totalTrades).toBe(1);
      expect(prof.grossProfit).toBe(0);
      expect(prof.grossLoss).toBe(50);
      expect(prof.netProfit).toBe(-50);
    });

    it('should calculate profit factor correctly', () => {
      tracker.recordProfit({ profit: 100 });
      tracker.recordProfit({ profit: 150 });
      tracker.recordProfit({ profit: -50 });
      tracker.recordProfit({ profit: -30 });
      
      const prof = tracker.getProfitabilityMetrics();
      
      // Gross profit = 250, Gross loss = 80
      expect(prof.grossProfit).toBe(250);
      expect(prof.grossLoss).toBe(80);
      expect(prof.profitFactor).toBeCloseTo(250 / 80, 2);
    });

    it('should track profit by strategy', () => {
      tracker.recordProfit({ profit: 100, strategy: 'arbitrage' });
      tracker.recordProfit({ profit: 50, strategy: 'arbitrage' });
      tracker.recordProfit({ profit: 75, strategy: 'liquidation' });
      
      const prof = tracker.getProfitabilityMetrics();
      
      expect(prof.profitByStrategy.get('arbitrage')).toBe(150);
      expect(prof.profitByStrategy.get('liquidation')).toBe(75);
    });
  });

  describe('Circuit Breaker', () => {
    it('should not activate circuit breaker on single failure', () => {
      tracker.recordExecution({
        submitLatency: 100,
        success: false,
        gasUsed: 0.001,
        priorityFee: 0.0005,
      });

      expect(tracker.isCircuitBreakerActive()).toBe(false);
    });

    it('should activate circuit breaker after consecutive failures', () => {
      // Record 5 consecutive failures (default threshold)
      for (let i = 0; i < 5; i++) {
        tracker.recordExecution({
          submitLatency: 100,
          success: false,
          gasUsed: 0.001,
          priorityFee: 0.0005,
        });
      }

      expect(tracker.isCircuitBreakerActive()).toBe(true);
    });

    it('should reset circuit breaker on success', () => {
      // Record failures
      for (let i = 0; i < 3; i++) {
        tracker.recordExecution({
          submitLatency: 100,
          success: false,
          gasUsed: 0.001,
          priorityFee: 0.0005,
        });
      }

      // Record success
      tracker.recordExecution({
        submitLatency: 100,
        success: true,
        gasUsed: 0.001,
        priorityFee: 0.0005,
      });

      const kpis = tracker.getKPIs();
      expect(kpis.circuitBreaker.consecutiveFailures).toBe(0);
    });

    it('should allow manual circuit breaker activation', () => {
      tracker.activateCircuitBreaker('Manual test trigger');
      
      expect(tracker.isCircuitBreakerActive()).toBe(true);
      
      const kpis = tracker.getKPIs();
      expect(kpis.circuitBreaker.reason).toBe('Manual test trigger');
      expect(kpis.circuitBreaker.triggeredAt).toBeDefined();
    });

    it('should allow manual circuit breaker deactivation', () => {
      tracker.activateCircuitBreaker('Test');
      expect(tracker.isCircuitBreakerActive()).toBe(true);
      
      tracker.deactivateCircuitBreaker();
      expect(tracker.isCircuitBreakerActive()).toBe(false);
    });
  });

  describe('Rate Calculations', () => {
    it('should calculate fill rate correctly', () => {
      tracker.recordExecution({ submitLatency: 100, success: true, gasUsed: 0.001, priorityFee: 0.0005 });
      tracker.recordExecution({ submitLatency: 100, success: true, gasUsed: 0.001, priorityFee: 0.0005 });
      tracker.recordExecution({ submitLatency: 100, success: false, gasUsed: 0.001, priorityFee: 0.0005 });
      
      expect(tracker.getFillRate()).toBeCloseTo(66.67, 1);
    });

    it('should calculate transaction success rate correctly', () => {
      tracker.recordExecution({ submitLatency: 100, success: true, gasUsed: 0.001, priorityFee: 0.0005 });
      tracker.recordExecution({ submitLatency: 100, success: false, gasUsed: 0.001, priorityFee: 0.0005 });
      
      expect(tracker.getTransactionSuccessRate()).toBe(50);
    });

    it('should calculate revert rate correctly', () => {
      tracker.recordExecution({ submitLatency: 100, success: true, gasUsed: 0.001, priorityFee: 0.0005 });
      tracker.recordExecution({ submitLatency: 100, success: false, reverted: true, gasUsed: 0.001, priorityFee: 0.0005 });
      tracker.recordExecution({ submitLatency: 100, success: false, reverted: false, gasUsed: 0.001, priorityFee: 0.0005 });
      
      expect(tracker.getRevertRate()).toBeCloseTo(33.33, 1);
    });

    it('should calculate RPC success rate correctly', () => {
      tracker.recordRPCCall({ endpoint: 'test', latency: 100, success: true });
      tracker.recordRPCCall({ endpoint: 'test', latency: 100, success: true });
      tracker.recordRPCCall({ endpoint: 'test', latency: 100, success: false });
      
      expect(tracker.getRPCSuccessRate()).toBeCloseTo(66.67, 1);
    });
  });

  describe('Performance Targets', () => {
    it('should detect when not meeting performance targets', () => {
      // Record poor performance
      tracker.recordExecution({ 
        submitLatency: 100, 
        confirmationLatency: 200,
        success: false, 
        gasUsed: 0.001, 
        priorityFee: 0.0005 
      });
      
      const performance = tracker.isMeetingPerformanceTargets();
      expect(performance.overall).toBe(false);
    });

    it('should detect when meeting performance targets', () => {
      // Record good performance - multiple successful trades
      for (let i = 0; i < 20; i++) {
        tracker.recordExecution({ 
          submitLatency: 50, 
          confirmationLatency: 80,
          success: true, 
          gasUsed: 0.001, 
          priorityFee: 0.0005,
          profit: 10,
        });
      }
      
      // Add some losing trades for realistic profit factor
      for (let i = 0; i < 3; i++) {
        tracker.recordExecution({ 
          submitLatency: 50, 
          confirmationLatency: 80,
          success: true, 
          gasUsed: 0.001, 
          priorityFee: 0.0005,
          profit: -5,
        });
      }
      
      const performance = tracker.isMeetingPerformanceTargets();
      expect(performance.details.latency).toBe(true);
      expect(performance.details.fillRate).toBe(true);
    });
  });

  describe('Persistence', () => {
    it('should save and load KPIs', async () => {
      // Record some data
      tracker.recordExecution({ 
        submitLatency: 100, 
        success: true, 
        gasUsed: 0.001, 
        priorityFee: 0.0005,
        profit: 50,
      });
      tracker.recordRPCCall({ endpoint: 'test', latency: 100, success: true });
      tracker.recordSafetyEvent({ type: 'honeypot' });
      
      // Save
      await tracker.save();
      
      // Create new tracker and load
      const newTracker = new KPITracker(testStorageDir);
      await newTracker.load();
      
      const kpis = newTracker.getKPIs();
      expect(kpis.execution.totalAttempts).toBe(1);
      expect(kpis.rpc.totalCalls).toBe(1);
      expect(kpis.risk.honeypotDetections).toBe(1);
      expect(kpis.profitability.netProfit).toBe(50);
    });

    it('should handle auto-save', async () => {
      tracker.enableAutoSave(100); // 100ms interval for testing
      
      tracker.recordExecution({ 
        submitLatency: 100, 
        success: true, 
        gasUsed: 0.001, 
        priorityFee: 0.0005 
      });
      
      // Wait for auto-save
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Verify file exists
      const filepath = path.join(testStorageDir, 'kpi-metrics.json');
      expect(existsSync(filepath)).toBe(true);
      
      tracker.disableAutoSave();
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive report', () => {
      // Record varied data
      tracker.recordExecution({ submitLatency: 100, confirmationLatency: 150, success: true, gasUsed: 0.001, priorityFee: 0.0005, profit: 100 });
      tracker.recordExecution({ submitLatency: 120, success: false, reverted: true, gasUsed: 0.002, priorityFee: 0.001 });
      tracker.recordRPCCall({ endpoint: 'test', latency: 80, success: true });
      tracker.recordSafetyEvent({ type: 'honeypot' });
      tracker.recordSlippage(0.015);
      
      const report = tracker.generateReport();
      
      expect(report).toContain('COMPREHENSIVE KPI REPORT');
      expect(report).toContain('EXECUTION SPEED & RELIABILITY');
      expect(report).toContain('RPC PERFORMANCE');
      expect(report).toContain('RISK & SAFETY');
      expect(report).toContain('PROFITABILITY');
    });
  });
});
