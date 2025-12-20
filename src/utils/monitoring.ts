/**
 * REAL-TIME MONITORING & ALERTING
 * 
 * Tracks bot health, performance metrics, and sends alerts
 */

import { createLogger } from './logger.js';
import { telegramNotifier } from './telegram.js';

const log = createLogger('Monitoring');

// ============================================================================
// MONITORING METRICS
// ============================================================================

export interface BotMetrics {
  // Uptime
  startTime: number;
  lastActivityTime: number;
  
  // Scanning metrics
  totalScans: number;
  successfulScans: number;
  failedScans: number;
  averageScanDuration: number;
  
  // Opportunity metrics
  opportunitiesDetected: number;
  opportunitiesAboveThreshold: number;
  opportunitiesExecuted: number;
  
  // Trade metrics
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitUSD: number;
  totalLossUSD: number;
  
  // Performance metrics
  averageLatency: number;
  peakLatency: number;
  rpcCallsTotal: number;
  rpcCallsFailed: number;
  
  // Resource metrics
  memoryUsageMB: number;
  cpuUsagePercent: number;
  
  // Health
  isHealthy: boolean;
  lastError?: string;
  lastErrorTime?: number;
}

const metrics: BotMetrics = {
  startTime: Date.now(),
  lastActivityTime: Date.now(),
  totalScans: 0,
  successfulScans: 0,
  failedScans: 0,
  averageScanDuration: 0,
  opportunitiesDetected: 0,
  opportunitiesAboveThreshold: 0,
  opportunitiesExecuted: 0,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfitUSD: 0,
  totalLossUSD: 0,
  averageLatency: 0,
  peakLatency: 0,
  rpcCallsTotal: 0,
  rpcCallsFailed: 0,
  memoryUsageMB: 0,
  cpuUsagePercent: 0,
  isHealthy: true,
};

// Scan duration tracking
const scanDurations: number[] = [];
const MAX_DURATION_SAMPLES = 100;

// Latency tracking
const latencies: number[] = [];
const MAX_LATENCY_SAMPLES = 100;

// ============================================================================
// METRIC UPDATES
// ============================================================================

export const monitoring = {
  /**
   * Record a scan completion
   */
  recordScan(success: boolean, duration: number) {
    metrics.totalScans++;
    metrics.lastActivityTime = Date.now();
    
    if (success) {
      metrics.successfulScans++;
      scanDurations.push(duration);
      if (scanDurations.length > MAX_DURATION_SAMPLES) {
        scanDurations.shift();
      }
      metrics.averageScanDuration = scanDurations.reduce((a, b) => a + b, 0) / scanDurations.length;
    } else {
      metrics.failedScans++;
    }
    
    log.debug('Scan recorded', {
      success,
      duration,
      totalScans: metrics.totalScans,
      successRate: ((metrics.successfulScans / metrics.totalScans) * 100).toFixed(1) + '%',
    });
  },

  /**
   * Record opportunity detection
   */
  recordOpportunity(aboveThreshold: boolean, profitPercent: number, details?: any) {
    metrics.opportunitiesDetected++;
    metrics.lastActivityTime = Date.now();
    
    if (aboveThreshold) {
      metrics.opportunitiesAboveThreshold++;
      log.info('💎 Profitable opportunity detected', {
        profitPercent: profitPercent.toFixed(4) + '%',
        total: metrics.opportunitiesAboveThreshold,
        ...details,
      });
    } else {
      log.debug('Opportunity below threshold', {
        profitPercent: profitPercent.toFixed(4) + '%',
        ...details,
      });
    }
  },

  /**
   * Record trade execution
   */
  async recordTrade(success: boolean, profitUSD: number, details?: any) {
    metrics.totalTrades++;
    metrics.lastActivityTime = Date.now();
    
    if (success) {
      metrics.successfulTrades++;
      if (profitUSD > 0) {
        metrics.totalProfitUSD += profitUSD;
        log.info('✅ Trade executed successfully', {
          profit: '$' + profitUSD.toFixed(2),
          totalProfit: '$' + metrics.totalProfitUSD.toFixed(2),
          winRate: ((metrics.successfulTrades / metrics.totalTrades) * 100).toFixed(1) + '%',
          ...details,
        });
        
        // Send Telegram alert for profitable trades
        if (profitUSD > 10) {
          const tokenA = details?.tokenA || 'N/A';
          const tokenB = details?.tokenB || 'N/A';
          await telegramNotifier.sendTrade({
            tokenA,
            tokenB,
            amount: details?.amount || 0,
            profit: profitUSD,
            profitUsd: profitUSD,
            txSignature: details?.txSignature || 'unknown',
            success: true,
          });
        }
      } else {
        metrics.totalLossUSD += Math.abs(profitUSD);
        log.warn('Trade executed at loss', {
          loss: '$' + Math.abs(profitUSD).toFixed(2),
          ...details,
        });
      }
    } else {
      metrics.failedTrades++;
      log.error('❌ Trade execution failed', undefined, details);
      
      // Send Telegram alert for failed trades
      const tokenA = details?.tokenA || 'N/A';
      const tokenB = details?.tokenB || 'N/A';
      await telegramNotifier.sendTrade({
        tokenA,
        tokenB,
        amount: details?.amount || 0,
        profit: 0,
        profitUsd: 0,
        txSignature: details?.txSignature || 'unknown',
        success: false,
      });
    }
  },

  /**
   * Record RPC call
   */
  recordRPC(success: boolean, latency?: number) {
    metrics.rpcCallsTotal++;
    
    if (!success) {
      metrics.rpcCallsFailed++;
    }
    
    if (latency) {
      latencies.push(latency);
      if (latencies.length > MAX_LATENCY_SAMPLES) {
        latencies.shift();
      }
      metrics.averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      metrics.peakLatency = Math.max(metrics.peakLatency, latency);
    }
  },

  /**
   * Record an error
   */
  async recordError(error: string) {
    metrics.lastError = error;
    metrics.lastErrorTime = Date.now();
    metrics.isHealthy = false;
    
    log.error('Error recorded', new Error(error));
    
    // Send Telegram alert for critical errors
    await telegramNotifier.sendMessage(
      `⚠️ ERROR\n${error}\nTime: ${new Date().toISOString()}`
    );
  },

  /**
   * Update resource metrics
   */
  updateResourceMetrics() {
    const memUsage = process.memoryUsage();
    metrics.memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    
    // Simple CPU usage estimation
    const cpuUsage = process.cpuUsage();
    metrics.cpuUsagePercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to percentage
    
    // Health check
    const idleTime = Date.now() - metrics.lastActivityTime;
    if (idleTime > 300000) { // 5 minutes idle
      log.warn('Bot appears idle', {
        idleMinutes: (idleTime / 60000).toFixed(1),
        lastActivity: new Date(metrics.lastActivityTime).toISOString(),
      });
    }
    
    // Memory check
    if (metrics.memoryUsageMB > 1500) { // 1.5GB warning
      log.warn('High memory usage', {
        memoryMB: metrics.memoryUsageMB.toFixed(2),
        heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
      });
    }
  },

  /**
   * Mark bot as healthy
   */
  markHealthy() {
    metrics.isHealthy = true;
    metrics.lastActivityTime = Date.now();
  },

  /**
   * Get current metrics
   */
  getMetrics(): BotMetrics {
    this.updateResourceMetrics();
    return { ...metrics };
  },

  /**
   * Generate monitoring report
   */
  generateReport(): string {
    const m = this.getMetrics();
    const uptime = Date.now() - m.startTime;
    const uptimeHours = (uptime / 3600000).toFixed(1);
    const scanSuccessRate = m.totalScans > 0 
      ? ((m.successfulScans / m.totalScans) * 100).toFixed(1) 
      : '0';
    const tradeWinRate = m.totalTrades > 0 
      ? ((m.successfulTrades / m.totalTrades) * 100).toFixed(1) 
      : '0';
    const netProfit = m.totalProfitUSD - m.totalLossUSD;
    const rpcSuccessRate = m.rpcCallsTotal > 0
      ? (((m.rpcCallsTotal - m.rpcCallsFailed) / m.rpcCallsTotal) * 100).toFixed(1)
      : '0';

    return `
╔════════════════════════════════════════════════════════════════╗
║                   BOT MONITORING REPORT                        ║
╠════════════════════════════════════════════════════════════════╣
║ UPTIME: ${uptimeHours}h | Status: ${m.isHealthy ? '✅ Healthy' : '⚠️ Issues'}
║────────────────────────────────────────────────────────────────║
║ SCANNING:
║   Total Scans: ${m.totalScans}
║   Success Rate: ${scanSuccessRate}%
║   Avg Duration: ${m.averageScanDuration.toFixed(0)}ms
║────────────────────────────────────────────────────────────────║
║ OPPORTUNITIES:
║   Detected: ${m.opportunitiesDetected}
║   Above Threshold: ${m.opportunitiesAboveThreshold}
║   Executed: ${m.opportunitiesExecuted}
║────────────────────────────────────────────────────────────────║
║ TRADING:
║   Total Trades: ${m.totalTrades}
║   Win Rate: ${tradeWinRate}%
║   Total Profit: $${m.totalProfitUSD.toFixed(2)}
║   Total Loss: $${m.totalLossUSD.toFixed(2)}
║   Net Profit: $${netProfit.toFixed(2)}
║────────────────────────────────────────────────────────────────║
║ PERFORMANCE:
║   Avg Latency: ${m.averageLatency.toFixed(0)}ms
║   Peak Latency: ${m.peakLatency.toFixed(0)}ms
║   RPC Success: ${rpcSuccessRate}%
║────────────────────────────────────────────────────────────────║
║ RESOURCES:
║   Memory: ${m.memoryUsageMB.toFixed(2)} MB
║   CPU: ${m.cpuUsagePercent.toFixed(1)}%
╚════════════════════════════════════════════════════════════════╝
    `.trim();
  },

  /**
   * Log monitoring report
   */
  logReport() {
    const report = this.generateReport();
    console.log('\n' + report + '\n');
    log.info('Monitoring report generated', {
      ...metrics,
      uptime: Date.now() - metrics.startTime,
    });
  },
};

// ============================================================================
// AUTOMATIC MONITORING
// ============================================================================

// Update resource metrics every 30 seconds
setInterval(() => {
  monitoring.updateResourceMetrics();
}, 30000);

// Log monitoring report every 30 minutes
setInterval(() => {
  monitoring.logReport();
}, 30 * 60 * 1000);

// Initial report after 1 minute
setTimeout(() => {
  monitoring.logReport();
}, 60000);

export default monitoring;
