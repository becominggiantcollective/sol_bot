# KPI Tracking Quick Reference

## Quick Start

```bash
# Start bot with KPI tracking
npm run dev:kpi

# View KPIs anytime
npm run kpi:view

# Full report
npm run kpi:report

# Check performance
npm run kpi:performance
```

## Key Metrics at a Glance

### 🎯 Target Performance

| Metric | Target | Why It Matters |
|--------|--------|----------------|
| **P95 Latency** | < 150ms | Speed is competitive edge |
| **Fill Rate** | >= 80% | More trades = more profit |
| **Revert Rate** | <= 10% | Failed txs waste gas fees |
| **Profit Factor** | > 1.5x | Sustainable profitability |

### 📊 KPI Categories

**Execution** - Speed and reliability
- Submit, confirmation, end-to-end latency
- Fill rate, success rate, revert rate
- Confirmation rank in blocks

**RPC** - Connection quality
- Latency by endpoint
- Success rate, rate limits
- Slot lag

**Risk** - Safety effectiveness
- Anomaly exits, honeypot detections
- Realized slippage
- Rug pull losses

**Costs** - Fee tracking
- Gas spent, priority fees
- Wasted fees from reverts
- DEX fees

**Profitability** - Bottom line
- Net profit, profit factor
- Win rate, avg win/loss
- Profit by strategy/time

## Common Commands

```bash
# View summary
npm run kpi:view

# Full report with all metrics
npm run kpi:report

# Export to JSON
npm run kpi:export kpis-$(date +%Y%m%d).json

# Check circuit breaker
npm run kpi:circuit-breaker

# Performance assessment
npm run kpi:performance
```

## Integration Snippets

### Record Execution
```typescript
tracker.recordExecution({
  submitLatency: 120,
  confirmationLatency: 250,
  success: true,
  gasUsed: 0.001,
  priorityFee: 0.0005,
  profit: 15.50,
  strategy: 'arbitrage',
});
```

### Check Circuit Breaker
```typescript
if (tracker.isCircuitBreakerActive()) {
  console.log('Trading halted for safety');
  return;
}
```

### Record Safety Event
```typescript
// Honeypot detected
tracker.recordSafetyEvent({ type: 'honeypot' });

// Rug pull with $50 loss
tracker.recordSafetyEvent({ type: 'rugpull', loss: 50 });
```

### Generate Report
```typescript
const report = tracker.generateReport();
console.log(report);
```

## Performance Optimization Tips

### If Latency Too High
- Use premium RPC (Helius/Alchemy)
- Enable `skipPreflight`
- Use Jito bundles
- Optimize transaction building

### If Fill Rate Too Low
- Increase priority fees
- Widen slippage tolerance
- Use faster RPC
- Check quote freshness

### If Revert Rate Too High
- Add pre-trade validation
- Check balances first
- Simulate transactions
- Improve error handling

### If Profit Factor Low
- Increase profit threshold
- Tighten stop-loss
- Filter low-quality opportunities
- Review entry/exit timing

## Circuit Breaker Thresholds

| Condition | Default | Configurable |
|-----------|---------|--------------|
| Consecutive Failures | 5 | Yes |
| Price Deviation | 5% | Yes |
| Manual Activation | - | Yes |

```typescript
// Activate manually
tracker.activateCircuitBreaker('Manual safety halt');

// Deactivate when safe
tracker.deactivateCircuitBreaker();
```

## A/B Testing Quick Start

```typescript
import { FineTuningEngine } from './src/utils/fineTuning.js';

const engine = new FineTuningEngine(tracker);
const baseline = FineTuningEngine.getDefaultParameters();

// Generate variants
const variants = FineTuningEngine.generateVariants(
  baseline, 
  'aggressive' // or 'conservative', 'speed'
);

// Run test
const results = await engine.runABTest({
  name: 'Test Name',
  description: 'Test Description',
  baseline,
  variants,
  durationMinutes: 60,
  minTradesRequired: 20,
}, [
  { metric: 'profit', weight: 1.0 },
  { metric: 'winRate', weight: 0.5 },
]);

// View results
console.log(engine.generateComparisonReport(results));
```

## Data Storage

**Location**: `./data/kpis/kpi-metrics.json`

**Auto-save**: Every 60 seconds

**Backup**: 
```bash
cp ./data/kpis/kpi-metrics.json ./backups/kpis-$(date +%Y%m%d-%H%M%S).json
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| KPIs not saving | Check `./data/kpis/` permissions |
| Circuit breaker stuck | Check reason, manually deactivate if resolved |
| Performance always failing | Adjust targets or increase sample size |
| A/B test not completing | Check `minTradesRequired` and duration |

## Best Practices

1. ✅ **Monitor regularly** - Set 15-minute reporting interval
2. ✅ **Respect circuit breakers** - Don't trade when active
3. ✅ **Test before production** - Run A/B tests on parameter changes
4. ✅ **Track by strategy** - Segment profits to find winners
5. ✅ **Export regularly** - Back up KPI data daily

## Resources

- Full Documentation: `KPI_TRACKING_GUIDE.md`
- Example Integration: `src/bot-with-kpi.ts`
- CLI Tool: `kpi-cli.mjs`
- Tests: `src/__tests__/kpiTracker.test.ts`
