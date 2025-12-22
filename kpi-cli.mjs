#!/usr/bin/env node

/**
 * KPI MANAGEMENT CLI
 * 
 * Command-line tool for viewing and managing bot KPIs
 * 
 * Usage:
 *   node kpi-cli.mjs view              - View current KPIs
 *   node kpi-cli.mjs report            - Generate full report
 *   node kpi-cli.mjs export [file]     - Export KPIs to JSON
 *   node kpi-cli.mjs reset             - Reset all KPIs (with confirmation)
 *   node kpi-cli.mjs circuit-breaker   - Check circuit breaker status
 *   node kpi-cli.mjs performance       - Check performance targets
 */

import { KPITracker } from './src/utils/kpiTracker.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const STORAGE_DIR = './data/kpis';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function printHeader(text) {
  console.log(`\n${colors.bright}${colors.cyan}${text}${colors.reset}\n`);
}

function printSuccess(text) {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printError(text) {
  console.log(`${colors.red}✗ ${text}${colors.reset}`);
}

function printInfo(text) {
  console.log(`${colors.blue}ℹ ${text}${colors.reset}`);
}

async function viewKPIs() {
  const tracker = new KPITracker(STORAGE_DIR);
  await tracker.load();
  
  const kpis = tracker.getKPIs();
  
  printHeader('📊 KEY PERFORMANCE INDICATORS');
  
  // Execution metrics
  console.log(`${colors.bright}Execution Metrics:${colors.reset}`);
  console.log(`  Total Attempts: ${kpis.execution.totalAttempts}`);
  console.log(`  Successful: ${kpis.execution.successfulFills} (${tracker.getFillRate().toFixed(2)}%)`);
  console.log(`  Failed: ${kpis.execution.failedFills}`);
  console.log(`  Reverted: ${kpis.execution.revertedTransactions}`);
  console.log(`  Avg Execution Time: ${kpis.execution.avgExecutionTime.toFixed(0)}ms`);
  console.log(`  P95 End-to-End: ${kpis.execution.endToEndLatency.p95.toFixed(0)}ms`);
  
  // RPC metrics
  console.log(`\n${colors.bright}RPC Performance:${colors.reset}`);
  console.log(`  Total Calls: ${kpis.rpc.totalCalls}`);
  console.log(`  Success Rate: ${tracker.getRPCSuccessRate().toFixed(2)}%`);
  console.log(`  Avg Latency: ${kpis.rpc.latency.avg.toFixed(0)}ms`);
  console.log(`  P95 Latency: ${kpis.rpc.latency.p95.toFixed(0)}ms`);
  console.log(`  Rate Limits: ${kpis.rpc.rateLimitEvents}`);
  console.log(`  Slot Lag: ${kpis.rpc.slotLag}`);
  
  // Risk metrics
  console.log(`\n${colors.bright}Risk & Safety:${colors.reset}`);
  console.log(`  Anomaly Exits: ${kpis.risk.anomalyExits}`);
  console.log(`  Honeypot Detected: ${kpis.risk.honeypotDetections}`);
  console.log(`  Rug Pulls: ${kpis.risk.rugPulls}`);
  console.log(`  High Slippage Events: ${kpis.risk.highSlippageEvents}`);
  console.log(`  Stop Loss Triggered: ${kpis.risk.stopLossTriggered}`);
  console.log(`  Total Scam Loss: $${kpis.risk.totalLossFromScams.toFixed(2)}`);
  
  // Cost metrics
  console.log(`\n${colors.bright}Costs:${colors.reset}`);
  console.log(`  Total Gas: ${kpis.costs.totalGasSpent.toFixed(4)} SOL`);
  console.log(`  Priority Fees: ${kpis.costs.totalPriorityFees.toFixed(4)} SOL`);
  console.log(`  Wasted (Reverts): ${kpis.costs.wastedFeesFromReverts.toFixed(4)} SOL`);
  console.log(`  DEX Fees: $${kpis.costs.dexFees.toFixed(2)}`);
  
  // Profitability metrics
  console.log(`\n${colors.bright}Profitability:${colors.reset}`);
  console.log(`  Net Profit: ${kpis.profitability.netProfit >= 0 ? colors.green : colors.red}$${kpis.profitability.netProfit.toFixed(2)}${colors.reset}`);
  console.log(`  Gross Profit: $${kpis.profitability.grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss: $${kpis.profitability.grossLoss.toFixed(2)}`);
  console.log(`  Total Trades: ${kpis.profitability.totalTrades}`);
  console.log(`  Profit Factor: ${kpis.profitability.profitFactor.toFixed(2)}x`);
  console.log(`  Win Rate: ${kpis.profitability.winRate.toFixed(2)}%`);
  
  // Circuit breaker
  console.log(`\n${colors.bright}Circuit Breaker:${colors.reset}`);
  if (kpis.circuitBreaker.isActive) {
    printError(`ACTIVE - ${kpis.circuitBreaker.reason}`);
    console.log(`  Triggered: ${new Date(kpis.circuitBreaker.triggeredAt).toLocaleString()}`);
  } else {
    printSuccess('Normal');
  }
  console.log(`  Consecutive Failures: ${kpis.circuitBreaker.consecutiveFailures}`);
}

async function generateReport() {
  const tracker = new KPITracker(STORAGE_DIR);
  await tracker.load();
  
  const report = tracker.generateReport();
  console.log(report);
}

async function exportKPIs(outputFile) {
  const tracker = new KPITracker(STORAGE_DIR);
  await tracker.load();
  
  const kpis = tracker.getKPIs();
  
  const exportData = {
    exportedAt: new Date().toISOString(),
    kpis,
  };
  
  if (outputFile) {
    const { writeFile } = await import('fs/promises');
    await writeFile(outputFile, JSON.stringify(exportData, null, 2));
    printSuccess(`KPIs exported to ${outputFile}`);
  } else {
    console.log(JSON.stringify(exportData, null, 2));
  }
}

async function checkCircuitBreaker() {
  const tracker = new KPITracker(STORAGE_DIR);
  await tracker.load();
  
  printHeader('🚨 CIRCUIT BREAKER STATUS');
  
  const kpis = tracker.getKPIs();
  const breaker = kpis.circuitBreaker;
  
  console.log(`Status: ${breaker.isActive ? colors.red + 'ACTIVE' : colors.green + 'Normal'}${colors.reset}`);
  
  if (breaker.isActive) {
    console.log(`Reason: ${breaker.reason}`);
    console.log(`Triggered: ${new Date(breaker.triggeredAt).toLocaleString()}`);
  }
  
  console.log(`\nConsecutive Failures: ${breaker.consecutiveFailures}`);
  console.log(`Price Deviation: ${(breaker.priceDeviationPercent * 100).toFixed(2)}%`);
  
  if (breaker.isActive) {
    printWarning('\nBot execution is paused for safety.');
    printInfo('Review recent trades and adjust parameters before resuming.');
  }
}

async function checkPerformance() {
  const tracker = new KPITracker(STORAGE_DIR);
  await tracker.load();
  
  printHeader('📈 PERFORMANCE TARGET ASSESSMENT');
  
  const performance = tracker.isMeetingPerformanceTargets();
  
  console.log(`Overall: ${performance.overall ? colors.green + '✓ Meeting Targets' : colors.yellow + '⚠ Below Target'}${colors.reset}\n`);
  
  console.log('Individual Targets:');
  console.log(`  Latency (P95 < 150ms): ${performance.details.latency ? printInline('✓', 'green') : printInline('✗', 'red')}`);
  console.log(`  Fill Rate (>= 80%): ${performance.details.fillRate ? printInline('✓', 'green') : printInline('✗', 'red')}`);
  console.log(`  Revert Rate (<= 10%): ${performance.details.revertRate ? printInline('✓', 'green') : printInline('✗', 'red')}`);
  console.log(`  Profitability (Factor > 1.5x): ${performance.details.profitability ? printInline('✓', 'green') : printInline('✗', 'red')}`);
  
  const exec = tracker.getExecutionMetrics();
  const prof = tracker.getProfitabilityMetrics();
  
  console.log('\nCurrent Metrics:');
  console.log(`  P95 Latency: ${exec.endToEndLatency.p95.toFixed(0)}ms`);
  console.log(`  Fill Rate: ${tracker.getFillRate().toFixed(2)}%`);
  console.log(`  Revert Rate: ${tracker.getRevertRate().toFixed(2)}%`);
  console.log(`  Profit Factor: ${prof.profitFactor.toFixed(2)}x`);
  
  if (!performance.overall) {
    console.log('\n' + colors.yellow + 'Recommendations:' + colors.reset);
    if (!performance.details.latency) {
      console.log('  • Consider using faster RPC endpoint or Jito bundles');
    }
    if (!performance.details.fillRate) {
      console.log('  • Increase priority fees or adjust slippage tolerance');
    }
    if (!performance.details.revertRate) {
      console.log('  • Strengthen pre-trade validation and safety checks');
    }
    if (!performance.details.profitability) {
      console.log('  • Review strategy parameters and consider A/B testing');
    }
  }
}

function printInline(symbol, color) {
  return `${colors[color]}${symbol}${colors.reset}`;
}

async function resetKPIs() {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('\nAre you sure you want to reset all KPIs? This cannot be undone. (yes/no): ', async (answer) => {
      rl.close();
      
      if (answer.toLowerCase() === 'yes') {
        const tracker = new KPITracker(STORAGE_DIR);
        tracker.reset();
        await tracker.save();
        printSuccess('All KPIs have been reset');
      } else {
        printInfo('Reset cancelled');
      }
      resolve();
    });
  });
}

async function showHelp() {
  console.log(`
${colors.bright}${colors.cyan}KPI Management CLI${colors.reset}

${colors.bright}Usage:${colors.reset}
  node kpi-cli.mjs <command> [options]

${colors.bright}Commands:${colors.reset}
  view                 View current KPIs summary
  report               Generate full detailed report
  export [file]        Export KPIs to JSON file (or stdout if no file)
  reset                Reset all KPIs (requires confirmation)
  circuit-breaker      Check circuit breaker status
  performance          Check if meeting performance targets
  help                 Show this help message

${colors.bright}Examples:${colors.reset}
  node kpi-cli.mjs view
  node kpi-cli.mjs export kpis-backup.json
  node kpi-cli.mjs performance
  `);
}

// Main CLI handler
async function main() {
  const command = process.argv[2] || 'help';
  const arg = process.argv[3];
  
  try {
    // Check if KPI data exists
    const kpiFile = `${STORAGE_DIR}/kpi-metrics.json`;
    if (!existsSync(kpiFile) && command !== 'help' && command !== 'reset') {
      printWarning('No KPI data found. Start the bot to begin collecting metrics.');
      return;
    }
    
    switch (command) {
      case 'view':
        await viewKPIs();
        break;
      case 'report':
        await generateReport();
        break;
      case 'export':
        await exportKPIs(arg);
        break;
      case 'reset':
        await resetKPIs();
        break;
      case 'circuit-breaker':
      case 'cb':
        await checkCircuitBreaker();
        break;
      case 'performance':
      case 'perf':
        await checkPerformance();
        break;
      case 'help':
      case '--help':
      case '-h':
        await showHelp();
        break;
      default:
        printError(`Unknown command: ${command}`);
        console.log('Run "node kpi-cli.mjs help" for usage information.');
    }
  } catch (error) {
    printError(`Error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
