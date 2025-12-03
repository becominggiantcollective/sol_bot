# Backtest Comparison - Even Lower Thresholds
**Date:** December 2, 2025  
**Comparison:** 0.1% vs 0.05% Trading Threshold, 1.0% vs 0.5% Liquidation Threshold

## Executive Summary

Testing with **even lower thresholds** (0.05% trading, 0.5% liquidation) shows slightly different performance characteristics compared to the 0.1% threshold:

### Threshold Comparison

| Metric | 0.1% Threshold | 0.05% Threshold | Change |
|--------|----------------|-----------------|--------|
| **Net Profit** | $1,181.02 | $1,161.54 | -$19.48 (-1.7%) |
| **ROI (30 days)** | 11.81% | 11.62% | -0.19% |
| **Win Rate** | 96.17% | 94.67% | -1.5% |
| **Profit Factor** | 10,270.72 | 7,260.60 | -29.3% |
| **Sharpe Ratio** | 4.93 | 4.16 | -15.6% |
| **Successful Trades** | 577/600 | 568/600 | -9 trades |
| **Failed Trades** | 23/600 | 32/600 | +9 trades |
| **Max Consecutive Wins** | 78 | 54 | -24 |
| **Daily Average** | $39.37 | $38.72 | -$0.65 |

## Detailed Analysis

### Performance at 0.05% Threshold

#### Trading Statistics
| Metric | Value |
|--------|-------|
| Total Trades | 600 |
| Successful Trades | 568 |
| Failed Trades | 32 |
| Win Rate | 94.67% |
| Max Consecutive Wins | 54 |
| Max Consecutive Losses | 1 |

#### Financial Performance
| Metric | Value |
|--------|-------|
| Starting Capital | $10,000.00 |
| Ending Capital | $11,161.54 |
| Net Profit | $1,161.54 |
| ROI (30 days) | 11.62% |
| Total Profit | $1,161.70 |
| Total Loss | $0.16 |
| Average Profit per Trade | $2.05 |
| Average Loss per Trade | $0.01 |
| Largest Win | $2.16 |
| Largest Loss | $0.01 |

#### Risk Metrics
| Metric | Value | Analysis |
|--------|-------|----------|
| **Profit Factor** | 7,260.60 | 🟢 Excellent (>2.0 is excellent) |
| **Sharpe Ratio** | 4.16 | 🟢 Excellent (>2.0 is excellent) |
| **Max Drawdown** | Minimal | 🟢 Very low risk profile |
| **Consecutive Losses** | 1 max | 🟢 Excellent consistency |

### Performance Projections (0.05% Threshold)

| Period | Projected Profit | ROI |
|--------|------------------|-----|
| **Daily** | $38.72 | 0.39% |
| **Weekly** | $271.04 | 2.71% |
| **Monthly** | $1,161.54 | 11.62% |
| **Yearly** | $14,132.03 | 141.32% |

## Key Findings

### 🔴 Trade-offs of Lower Threshold (0.05% vs 0.1%)

1. **Slightly Lower Profit** 
   - Net profit decreased by $19.48 (1.7%)
   - ROI decreased from 11.81% to 11.62%

2. **Decreased Win Rate**
   - Win rate dropped from 96.17% to 94.67% (1.5% decrease)
   - 9 more failed trades (32 vs 23)

3. **Reduced Risk Metrics**
   - Profit factor decreased by 29.3% (10,270 → 7,260)
   - Sharpe ratio decreased by 15.6% (4.93 → 4.16)
   - Max consecutive wins decreased from 78 to 54

4. **Opportunity Detection**
   - Still found 10 profitable opportunities (same as 0.1%)
   - No additional opportunities detected with lower threshold

### 🟢 What Remained Strong

1. **Still Excellent Win Rate** (94.67% is outstanding)
2. **Still Excellent Profit Factor** (7,260 is exceptional)
3. **Still Excellent Sharpe Ratio** (4.16 is very good)
4. **Consistent Performance** (max 1 consecutive loss)
5. **Strong ROI** (11.62% in 30 days is excellent)

## Recommendation Analysis

### 🎯 Optimal Threshold: 0.1% (Previous Setting)

Based on the comparative analysis, **the 0.1% threshold appears to be optimal** for the following reasons:

1. **Better Win Rate**: 96.17% vs 94.67% (+1.5%)
2. **Higher Profit**: $1,181 vs $1,161 (+$20)
3. **Superior Risk Metrics**: 
   - Profit factor 41% higher (10,270 vs 7,260)
   - Sharpe ratio 18% higher (4.93 vs 4.16)
4. **Better Consistency**: 78 consecutive wins vs 54
5. **Same Opportunity Detection**: Both found 10 opportunities

### ⚠️ Why 0.05% Performs Slightly Worse

1. **Noise Trading**: Lower threshold may capture more "noise" - marginal opportunities that are less reliable
2. **Execution Costs**: At 0.05% margins, gas fees and slippage have larger relative impact
3. **False Positives**: More borderline opportunities that fail to materialize
4. **Market Efficiency**: At very low margins, market efficiency makes profitable execution harder

### 📊 Diminishing Returns

The data shows **diminishing returns** when lowering thresholds:
- 0.2% → 0.1%: Likely improved opportunity detection
- 0.1% → 0.05%: Slightly worse performance (-1.7% profit, -1.5% win rate)

This suggests **0.1% is near the optimal threshold** for this strategy.

## Configuration Comparison

### Previous (0.1% threshold)
```
MIN_PROFIT_THRESHOLD=0.001 (0.1%)
LIQUIDATION_MIN_PROFIT=0.01 (1.0%)
```

### Current Test (0.05% threshold)
```
MIN_PROFIT_THRESHOLD=0.0005 (0.05%)
LIQUIDATION_MIN_PROFIT=0.005 (0.5%)
```

## Conclusion

### 🏆 Recommended Configuration: **Keep 0.1% Threshold**

**Reasoning:**
1. ✅ Higher net profit ($1,181 vs $1,161)
2. ✅ Better win rate (96.17% vs 94.67%)
3. ✅ Superior risk-adjusted returns (Sharpe 4.93 vs 4.16)
4. ✅ More consistent performance (78 vs 54 consecutive wins)
5. ✅ Better profit factor (10,270 vs 7,260)

**The 0.1% threshold provides the sweet spot between:**
- Capturing enough opportunities
- Maintaining high win rate
- Excellent risk-adjusted returns
- Consistent performance

### 💡 Key Insight

Going below 0.1% threshold:
- ❌ Does **not** increase opportunity detection (still 10 found)
- ❌ Decreases win rate by 1.5%
- ❌ Reduces profit by $20 (1.7%)
- ❌ Worsens risk metrics significantly

**Verdict:** The original lowered threshold of **0.1%** for trading and **1.0%** for liquidation represents the **optimal balance** for this strategy.

---

**Test Details:**
- Test Date: December 2, 2025
- Configuration: 0.05% trading, 0.5% liquidation thresholds
- Simulation: 30 days, 600 trades, $10K starting capital
- Test Wallet: G1D4rmuVwQwkMuhxs2wX677qEXCexQNkt3v66iGsq7hj
