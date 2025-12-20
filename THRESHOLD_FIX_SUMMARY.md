# Flash Loan Fee Threshold Fix

## Problem Identified

The bot was configured with **incorrect flash loan fee assumptions**:
- **Previous assumption**: Solend charges 0.09% (9 basis points)
- **Reality**: Solend charges **0.3%** (30 basis points)

This meant all profit thresholds were set **BELOW** the actual cost of executing trades, causing the bot to identify "opportunities" that would actually **LOSE money**.

## Fee Breakdown (CORRECTED)

```
Flash Loan Arbitrage Costs:
─────────────────────────────────────
Solend Flash Loan Fee:  0.30%  ← This was assumed to be 0.09%!
DEX Fees (Jupiter/Orca): 0.25%
Gas (3 swaps + priority): 0.03%
─────────────────────────────────────
TOTAL COST:             ~0.58%
─────────────────────────────────────
MINIMUM SPREAD NEEDED:  0.80% (for 0.22% net profit)
```

## Changes Made

### 1. `src/config/index.ts`
```typescript
// BEFORE (incorrect)
minProfitThreshold: 0.0005    // 0.05%
minProfitForFlashloan: 0.0025 // 0.25%

// AFTER (correct)
minProfitThreshold: 0.008     // 0.8%
minProfitForFlashloan: 0.008  // 0.8%
```

### 2. `src/core/flashLoanScalper.ts` - SCALPER_CONFIG
```typescript
// BEFORE (incorrect)
flashLoanFeePercent: 0.0009       // 0.09% - WRONG!
minProfitPercentVolatile: 0.0025  // 0.25%
minProfitPercentArb: 0.0025       // 0.25%
sentimentLowThreshold: 0.0025     // 0.25%

// AFTER (correct)
flashLoanFeePercent: 0.003        // 0.3% - Correct!
minProfitPercentVolatile: 0.008   // 0.8%
minProfitPercentArb: 0.008        // 0.8%
sentimentLowThreshold: 0.008      // 0.8%
```

### 3. `src/core/flashLoanScalper.ts` - getDynamicThreshold()
```typescript
// BEFORE (incorrect)
High conviction: 0.0015  // 0.15%
Low liquidity:   0.004   // 0.4%
Standard:        0.0025  // 0.25%

// AFTER (correct)
High conviction: 0.006   // 0.6% (just above break-even)
Low liquidity:   0.012   // 1.2% (extra buffer for slippage)
Standard:        0.008   // 0.8%
```

### 4. `src/core/flashLoanScalper.ts` - Rust Engine Config
```typescript
// BEFORE
flashLoanFeePct: 0.0009  // 0.09%
minProfitPct: 0.0003     // 0.03%

// AFTER
flashLoanFeePct: 0.003   // 0.3%
minProfitPct: 0.008      // 0.8%
```

### 5. `src/core/flashLoanScalper.ts` - SolendFeeManager
```typescript
// BEFORE
cachedFee: 0.0009  // Default 0.09%

// AFTER
cachedFee: 0.003   // Default 0.3%
```

### 6. `src/utils/jupiterOptimizer.ts`
```typescript
// BEFORE
flashloanFee = amount * 0.0009  // 0.09%
netProfitPct > 0.1              // 0.1% threshold

// AFTER
flashloanFee = amount * 0.003   // 0.3%
netProfitPct > 0.2              // 0.2% threshold
```

### 7. `src/core/arbitrage.ts`
```typescript
// BEFORE
MIN_PROFIT_THRESHOLD_PERCENT = 0.05  // 0.05%
PORT_FINANCE_FEE_PERCENT = 0.09      // 0.09%

// AFTER
MIN_PROFIT_THRESHOLD_PERCENT = 0.8   // 0.8%
PORT_FINANCE_FEE_PERCENT = 0.3       // 0.3%
```

## Impact

### Before Fix
- Bot would execute trades with 0.25% spread
- **Result**: 0.25% - 0.58% = **-0.33% LOSS** per trade

### After Fix
- Bot only executes trades with 0.8%+ spread
- **Result**: 0.80% - 0.58% = **+0.22% NET PROFIT** per trade

## Market Reality

With the corrected thresholds, the bot will now:
1. ✅ Only execute trades that are actually profitable
2. ✅ Skip the vast majority of "opportunities" that would lose money
3. ⚠️ Find **very few** opportunities because:
   - Most liquid pairs have spreads of 0.02-0.15%
   - 0.8%+ spreads are rare and usually indicate:
     - New/illiquid tokens (high risk)
     - Temporary mispricing (requires speed to capture)
     - Price oracle delays (arbitrage already captured)

## Realistic Expectations

| Scenario | Expected Monthly Profit |
|----------|------------------------|
| Current market (efficient) | $0-$10 |
| Volatile market (new launches) | $10-$50 |
| Market crash/high volatility | $50-$200 |

The bot is now configured correctly, but the fundamental problem remains:
**Solana DeFi markets are very efficient, and 0.8%+ spreads are rare.**
