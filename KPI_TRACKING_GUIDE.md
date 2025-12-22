# KPI Tracking and Fine-Tuning System

## Overview

This comprehensive KPI (Key Performance Indicator) tracking system provides real-time monitoring and optimization capabilities for the Solana MEV trading bot. It tracks execution speed, reliability, safety, profitability, and costs to help you maximize bot performance.

## Key Features

### 📊 Comprehensive Metrics

- **Execution Speed & Reliability**
  - P50/P95/P99 latency tracking
  - Submit latency, confirmation latency, end-to-end timing
  - Confirmation rank in blocks
  - Fill rate, transaction success rate, revert rate
  - Best/worst/average execution times

- **RPC Performance**
  - Latency percentiles by endpoint
  - Success rates and failure tracking
  - Rate limit event detection
  - Slot lag monitoring
  - Per-endpoint performance comparison

- **Risk & Safety**
  - Anomaly exit tracking
  - Honeypot detection counts
  - Suspicious token avoidance
  - Realized slippage monitoring
  - Rug pull and scam loss tracking
  - Stop-loss trigger frequency

- **Cost Analysis**
  - Total gas spent (SOL)
  - Priority fees tracking
  - Wasted fees from reverted transactions
  - DEX fees (USD)
  - Average costs per trade

- **Profitability**
  - Gross profit/loss
  - Net profit
  - Profit factor (gross profit / gross loss)
  - Win rate percentage
  - Average win/loss amounts
  - Profit segmentation by hour, day, and strategy
  - Max drawdown and recovery factor

### 🚨 Circuit Breaker

Automatic safety mechanism that halts trading when:
- Consecutive failures exceed threshold (default: 5)
- Price deviation exceeds limits (default: 5%)
- Manual activation for emergencies

### 🎯 Performance Targets

Configurable targets with automatic assessment:
- **Latency**: P95 < 150ms
- **Fill Rate**: >= 80%
- **Revert Rate**: <= 10%
- **Profit Factor**: > 1.5x

### 🔧 Fine-Tuning Engine

A/B testing and parameter optimization:
- Automatic parameter variant generation
- Performance comparison with scoring
- Baseline vs variant testing
- Strategy recommendation based on results
- Support for aggressive, conservative, and speed-focused optimization

## Installation

The KPI tracking system is built-in. No additional installation required.

## Usage

### 1. Basic Integration

```typescript
import { KPIEnabledBot } from './src/bot-with-kpi.js';

// Start bot with KPI tracking
const bot = new KPIEnabledBot();
await bot.start();

// Access KPI tracker
const tracker = bot.getKPITracker();

// View metrics
const kpis = tracker.getKPIs();
console.log(kpis);

// Generate report
const report = tracker.generateReport();
console.log(report);
```

### 2. Recording Metrics

#### Execution Metrics

```typescript
tracker.recordExecution({
  submitLatency: 120,           // Time to submit (ms)
  confirmationLatency: 250,     // Time to confirm (ms)
  confirmationRank: 8,          // Position in block
  success: true,                // Did trade succeed?
  reverted: false,              // Was transaction reverted?
  gasUsed: 0.001,              // Gas in SOL
  priorityFee: 0.0005,         // Priority fee in SOL
  profit: 15.50,               // Profit in USD
  strategy: 'arbitrage',       // Strategy name
});
```

#### RPC Calls

```typescript
tracker.recordRPCCall({
  endpoint: 'https://api.mainnet-beta.solana.com',
  latency: 95,
  success: true,
  rateLimited: false,
  timeout: false,
  slotLag: 2,
});
```

#### Safety Events

```typescript
// Honeypot detected
tracker.recordSafetyEvent({
  type: 'honeypot',
});

// Rug pull with loss
tracker.recordSafetyEvent({
  type: 'rugpull',
  loss: 50.00,
});

// Stop loss triggered
tracker.recordSafetyEvent({
  type: 'stoploss',
});
```

#### Slippage

```typescript
const slippagePercent = 0.015; // 1.5%
tracker.recordSlippage(slippagePercent);
```

#### Profit/Loss

```typescript
tracker.recordProfit({
  profit: 25.50,
  strategy: 'liquidation',
});
```

### 3. Circuit Breaker

```typescript
// Check if active
if (tracker.isCircuitBreakerActive()) {
  console.log('Circuit breaker active - halting trading');
  return;
}

// Manual activation
tracker.activateCircuitBreaker('Manual safety halt');

// Deactivation
tracker.deactivateCircuitBreaker();
```

### 4. Performance Assessment

```typescript
const performance = tracker.isMeetingPerformanceTargets();

if (!performance.overall) {
  console.log('Not meeting performance targets:');
  
  if (!performance.details.latency) {
    console.log('- Latency too high');
  }
  
  if (!performance.details.fillRate) {
    console.log('- Fill rate too low');
  }
  
  if (!performance.details.profitability) {
    console.log('- Profitability below target');
  }
}
```

### 5. Fine-Tuning

```typescript
import { FineTuningEngine } from './src/utils/fineTuning.js';

const engine = new FineTuningEngine(tracker);

// Get default parameters
const baseline = FineTuningEngine.getDefaultParameters();

// Generate variants for testing
const variants = FineTuningEngine.generateVariants(baseline, 'aggressive');

// Run A/B test
const testConfig = {
  name: 'Aggressive Profit Test',
  description: 'Testing higher profit targets',
  baseline,
  variants,
  durationMinutes: 60,
  minTradesRequired: 20,
};

const targets = [
  { metric: 'profit', weight: 1.0 },
  { metric: 'winRate', weight: 0.5 },
  { metric: 'profitFactor', weight: 0.3 },
];

const results = await engine.runABTest(testConfig, targets);

// View comparison
const report = engine.generateComparisonReport(results);
console.log(report);

// Apply winner
const optimalParams = results.winner.parameters;
```

### 6. Auto-Optimization

```typescript
// Let the system optimize automatically
const recentPerformance = 'moderate'; // 'poor', 'moderate', or 'good'
const optimizedParams = await engine.autoOptimize(
  currentParams,
  recentPerformance,
  30 // test duration in minutes
);

console.log('Optimized parameters:', optimizedParams);
```

## CLI Tool

Use the command-line interface for quick KPI access:

```bash
# View KPI summary
node kpi-cli.mjs view

# Generate full report
node kpi-cli.mjs report

# Export to JSON
node kpi-cli.mjs export kpis-backup.json

# Check circuit breaker
node kpi-cli.mjs circuit-breaker

# Check performance targets
node kpi-cli.mjs performance

# Reset all KPIs (requires confirmation)
node kpi-cli.mjs reset

# Show help
node kpi-cli.mjs help
```

## Configuration

### KPI Tracker Settings

Customize thresholds in the KPI tracker:

```typescript
const tracker = new KPITracker('./data/kpis');

// Access internal config (modify as needed)
tracker['config'] = {
  maxConsecutiveFailures: 5,      // Circuit breaker threshold
  maxPriceDeviation: 0.05,        // 5% price deviation limit
  targetP95Latency: 150,          // Target P95 latency in ms
  highSlippageThreshold: 0.02,    // 2% high slippage threshold
  maxLatencySamples: 1000,        // Sample buffer size
};
```

### Trading Parameters

Default fine-tuning parameters:

```typescript
{
  // Strategy
  minProfitThreshold: 0.002,      // 0.2% minimum profit
  maxSlippage: 0.005,             // 0.5% max slippage
  maxGasFee: 0.02,                // 0.02 SOL max gas
  maxPositionSize: 5000,          // $5000 max position
  
  // Safety
  stopLossPercent: 0.08,          // 8% stop loss
  takeProfitPercent: 0.15,        // 15% take profit
  maxHoldTimeMinutes: 5,          // 5 minute max hold
  
  // Execution
  priorityFeeMultiplier: 2.0,     // 2x priority fee
  useJitoBundles: false,          // Jito bundles disabled
  commitmentLevel: 'confirmed',   // Confirmation level
  skipPreflight: false,           // Preflight checks enabled
  
  // Risk
  minLiquidityUSD: 5000,          // $5k min liquidity
  maxTokenAge: -1,                // No age limit
  minHolderCount: 10,             // 10 min holders
  honeypotRiskThreshold: 60,      // 60 risk score threshold
}
```

## Data Storage

KPIs are automatically saved to `./data/kpis/kpi-metrics.json`:

- Auto-save interval: 60 seconds (configurable)
- Includes all metrics and historical samples
- Persists across bot restarts
- Can be backed up and restored

## Best Practices

### 1. Monitor Regularly

Set up automatic reporting:

```typescript
// Report every 15 minutes
setInterval(() => {
  const report = tracker.generateReport();
  console.log(report);
}, 15 * 60 * 1000);
```

### 2. Respond to Circuit Breakers

Always check circuit breaker before trading:

```typescript
if (tracker.isCircuitBreakerActive()) {
  // Investigate issue
  const kpis = tracker.getKPIs();
  console.log('Reason:', kpis.circuitBreaker.reason);
  
  // Don't trade until resolved
  return;
}
```

### 3. Run Regular A/B Tests

Test parameter changes before production:

```typescript
// Test weekly during low-volume hours
const results = await engine.runABTest(config, targets);

// Only apply if improvement > 10%
const improvement = (results.winner.score - results.results[0].score) / results.results[0].score;
if (improvement > 0.10) {
  applyParameters(results.winner.parameters);
}
```

### 4. Track by Strategy

Segment profitability by strategy:

```typescript
// Record with strategy tag
tracker.recordProfit({
  profit: 50,
  strategy: 'triangular-arbitrage',
});

// Analyze per-strategy performance
const prof = tracker.getProfitabilityMetrics();
console.log('Arbitrage profit:', prof.profitByStrategy.get('triangular-arbitrage'));
console.log('Liquidation profit:', prof.profitByStrategy.get('liquidation'));
```

### 5. Export for Analysis

Regularly export data for deeper analysis:

```typescript
// Export daily
const kpis = tracker.getKPIs();
const exportData = {
  date: new Date().toISOString(),
  kpis,
};

await writeFile(
  `./backups/kpis-${Date.now()}.json`,
  JSON.stringify(exportData, null, 2)
);
```

## Performance Targets Explained

### Latency (P95 < 150ms)

Top bots achieve end-to-end execution under 150ms. This includes:
- Transaction building: ~20-40ms
- RPC submission: ~50-80ms
- Confirmation: ~400-600ms (but we measure time-to-submit for P95)

**Optimization tips:**
- Use Helius/Alchemy premium RPC
- Enable `skipPreflight` for speed
- Use Jito bundles for MEV protection
- Optimize transaction building code

### Fill Rate (>= 80%)

Percentage of trade attempts that successfully fill.

**Common issues:**
- Slippage too tight
- Priority fees too low
- Slow execution
- Stale quotes

**Optimization tips:**
- Increase priority fee multiplier
- Widen slippage tolerance slightly (0.5-1%)
- Use faster RPC endpoints
- Implement better quote freshness checks

### Revert Rate (<= 10%)

Percentage of transactions that revert (failed but cost gas).

**High revert rate causes:**
- Insufficient balance checks
- Slippage exceeded
- Invalid token approvals
- Pool state changes

**Optimization tips:**
- Strengthen pre-trade validation
- Check balances before submission
- Simulate transactions first
- Implement better error handling

### Profit Factor (> 1.5x)

Ratio of gross profit to gross loss.

**Target breakdown:**
- 1.0x = Break even
- 1.5x = Good (50% more profit than loss)
- 2.0x = Excellent
- 3.0x = Elite

**Optimization tips:**
- Increase profit threshold
- Tighten stop-loss parameters
- Improve entry/exit timing
- Filter out low-quality opportunities

## Troubleshooting

### Issue: KPIs not saving

**Solution:**
- Check write permissions on `./data/kpis/` directory
- Ensure `enableAutoSave()` is called
- Check disk space

### Issue: Circuit breaker stuck active

**Solution:**
```typescript
// Check reason
const kpis = tracker.getKPIs();
console.log(kpis.circuitBreaker.reason);

// If resolved, manually deactivate
tracker.deactivateCircuitBreaker();
```

### Issue: Performance targets always failing

**Solution:**
- Review target thresholds (may be too strict)
- Ensure sufficient sample size (>20 trades minimum)
- Check if market conditions are abnormal
- Consider adjusting targets based on your setup

### Issue: A/B test not completing

**Solution:**
- Check `minTradesRequired` (might be too high)
- Verify bot is actually trading during test
- Check test duration is sufficient
- Review logs for errors

## Advanced Usage

### Custom Scoring for A/B Tests

```typescript
const targets = [
  { metric: 'profit', weight: 0.5 },
  { metric: 'winRate', weight: 0.3 },
  { metric: 'executionTime', weight: 0.2 }, // Lower is better
];
```

### Multi-Strategy Analysis

```typescript
const prof = tracker.getProfitabilityMetrics();

// Compare strategies
const strategies = Array.from(prof.profitByStrategy.entries());
strategies.sort((a, b) => b[1] - a[1]);

console.log('Top strategies:');
strategies.forEach(([strategy, profit]) => {
  console.log(`  ${strategy}: $${profit.toFixed(2)}`);
});
```

### Time-Based Analysis

```typescript
const prof = tracker.getProfitabilityMetrics();

// Find most profitable hour
const hours = Array.from(prof.profitByHour.entries());
hours.sort((a, b) => b[1] - a[1]);

console.log('Most profitable hour:', hours[0][0]);
console.log('Profit:', hours[0][1]);

// Daily trends
const days = Array.from(prof.profitByDay.entries());
console.log('Daily profit trend:', days);
```

## Support

For issues, questions, or feature requests:
1. Check this documentation
2. Review code examples in `src/bot-with-kpi.ts`
3. Run `node kpi-cli.mjs help`
4. Check bot logs for errors

## Future Enhancements

Planned features:
- Real-time dashboard UI
- Slack/Discord notifications
- Machine learning for parameter optimization
- Historical trend analysis
- Comparative benchmarking against other bots
- Automated anomaly detection
