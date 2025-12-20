# 🏗️ Optimization Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLASH LOAN SCALPER BOT                        │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  Token       │  │  Safety      │  │  Volatility         │   │
│  │  Scanner     │  │  Checker     │  │  Tracker            │   │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────────────┴──────────────────────┘               │
│                           │                                      │
│                           ▼                                      │
│         ┌─────────────────────────────────────┐                 │
│         │   OPPORTUNITY ANALYZER               │                 │
│         │   - Real Jupiter API quotes          │                 │
│         │   - Triangular arbitrage             │                 │
│         │   - Profit calculation               │                 │
│         └──────────────┬──────────────────────┘                 │
│                        │                                         │
│          ┌─────────────┴────────────────┐                       │
│          │                               │                       │
│          ▼                               ▼                       │
│  ┌───────────────────┐         ┌─────────────────────┐         │
│  │ ML ROUTE SELECTOR │         │ DYNAMIC FEE MANAGER │         │
│  │ 🤖 NEW!           │         │ ⚡ NEW!              │         │
│  └───────┬───────────┘         └──────────┬──────────┘         │
│          │                                 │                     │
│          └─────────────┬───────────────────┘                     │
│                        │                                         │
│                        ▼                                         │
│         ┌──────────────────────────────┐                        │
│         │   EXECUTION ENGINE            │                        │
│         │   - Build transaction         │                        │
│         │   - Jito bundle               │                        │
│         │   - MEV protection            │                        │
│         └──────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
1. TOKEN DISCOVERY
   ┌─────────────────┐
   │ Jupiter API     │──┐
   │ Birdeye API     │  │
   │ DexScreener API │  ├──► Token List
   │ Pump.fun API    │  │
   │ New Pair Scanner│──┘
   └─────────────────┘
            │
            ▼
2. OPPORTUNITY ANALYSIS
   ┌─────────────────────────────────────┐
   │ For each token:                      │
   │  1. Check age, liquidity, holders   │
   │  2. Simulate flash loan trade       │
   │  3. Calculate profit                │
   │  4. Assess risk                     │
   └────────────┬────────────────────────┘
                │
                ▼
3. ML ROUTE OPTIMIZATION 🤖
   ┌──────────────────────────────────────┐
   │ MLRouteSelector.predictOptimalRoute() │
   │                                       │
   │ Input:                                │
   │  - Token pair (SOL/USDC)             │
   │  - Trade amount ($1000)              │
   │  - Market volatility (0.5)           │
   │  - Time of day (14)                  │
   │                                       │
   │ Process:                              │
   │  1. Check historical data            │
   │  2. Score routes by:                 │
   │     - Fee efficiency (35%)           │
   │     - Slippage (25%)                 │
   │     - Success rate (25%)             │
   │     - Speed (10%)                    │
   │     - Confidence (5%)                │
   │  3. Apply heuristics if needed       │
   │                                       │
   │ Output:                               │
   │  - Recommended DEXs: [Raydium, Orca]│
   │  - Estimated fee: 0.275%             │
   │  - Confidence: 0.87                  │
   └────────────┬─────────────────────────┘
                │
                ▼
4. DYNAMIC FEE CALCULATION ⚡
   ┌──────────────────────────────────────┐
   │ DynamicPriorityFeeManager            │
   │  .getOptimalFee(connection, urgency) │
   │                                       │
   │ Helius API Route:                    │
   │  1. Query getPriorityFeeEstimate     │
   │  2. Get all fee levels               │
   │  3. Analyze market state:            │
   │     - Calm:      low fees            │
   │     - Moderate:  medium fees         │
   │     - Congested: high fees           │
   │     - Extreme:   adaptive pricing    │
   │  4. Apply urgency multiplier         │
   │  5. Cache for 3 seconds              │
   │                                       │
   │ Fallback (Standard RPC):             │
   │  1. getRecentPrioritizationFees()    │
   │  2. Calculate 75th percentile        │
   │  3. Apply premium                    │
   │                                       │
   │ Output:                               │
   │  - Optimal fee: 12000 µSOL           │
   │  - Market trend: stable              │
   │  - Savings: 97.6%                    │
   └────────────┬─────────────────────────┘
                │
                ▼
5. EXECUTION
   ┌─────────────────────────────────────┐
   │ Build transaction with:              │
   │  - ML-optimized route                │
   │  - Dynamic priority fee              │
   │  - Compute budget instructions       │
   │  - Flash loan instructions           │
   │  - Jito tip                          │
   └────────────┬────────────────────────┘
                │
                ▼
6. FEEDBACK LOOP 🔄
   ┌─────────────────────────────────────┐
   │ MLRouteSelector.recordPerformance()  │
   │                                       │
   │ Record:                               │
   │  - Route: "Raydium->Orca"            │
   │  - Token pair: "SOL/USDC"            │
   │  - Actual fee: 0.00275               │
   │  - Actual slippage: 0.0015           │
   │  - Success: true                     │
   │  - Execution time: 487ms             │
   │                                       │
   │ Save to: data/route-performance.json │
   └──────────────────────────────────────┘
```

## Fee Optimization Flow

```
┌──────────────────────────────────────────────────────────────┐
│                      TRANSACTION COST                         │
└──────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                      │
        ▼                                      ▼
┌────────────────┐                    ┌────────────────┐
│ PRIORITY FEES  │                    │  DEX ROUTING   │
│ (Network)      │                    │  (Swap Fees)   │
└────────┬───────┘                    └────────┬───────┘
         │                                     │
         │                                     │
    OLD: │ 500,000 µSOL                   OLD: │ 0.6% (multi-hop)
         │ Fixed high priority                 │ Jupiter auto-route
         │                                     │
         ▼                                     ▼
    NEW: │ 12,000 µSOL               ⚡   NEW: │ 0.275% (optimized) 🤖
         │ ├─ Query Helius API                 │ ├─ Historical analysis
         │ ├─ Detect market state              │ ├─ DEX fee tiers
         │ ├─ Calculate premium                │ ├─ Liquidity depth
         │ ├─ Apply urgency                    │ ├─ Success rates
         │ └─ Cache 3s                         │ └─ Score routes
         │                                     │
         ▼                                     ▼
   SAVE: 97.6%                           SAVE: 54%
   ────────────────────────────────────────────────
                 TOTAL SAVINGS: ~60-70%
```

## ML Training Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    ROUTE PERFORMANCE DATA                    │
│                                                               │
│  {                                                            │
│    "SOL/USDC:Raydium->Orca": {                              │
│      dexCombo: "Raydium->Orca",                             │
│      tokenPair: "SOL/USDC",                                 │
│      avgFeePercent: 0.00275,                                │
│      avgSlippage: 0.0015,                                   │
│      successRate: 0.92,                                     │
│      avgExecutionTime: 487,                                 │
│      sampleSize: 47,                                        │
│      lastUpdated: 1733788800000                             │
│    },                                                         │
│    ...                                                        │
│  }                                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │  PREDICTION ENGINE   │
        └─────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
     ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌──────────┐
│ < 5     │  │ 5-50    │  │ > 50     │
│ samples │  │ samples │  │ samples  │
├─────────┤  ├─────────┤  ├──────────┤
│ Use     │  │ Blend   │  │ Use ML   │
│ Heuris- │  │ ML +    │  │ Predic-  │
│ tics    │  │ Heuris- │  │ tions    │
│         │  │ tics    │  │          │
│ Conf:   │  │ Conf:   │  │ Conf:    │
│ 0.3-0.5 │  │ 0.5-0.8 │  │ 0.8-0.95 │
└─────────┘  └─────────┘  └──────────┘
```

## Heuristic Rules (Fallback)

```
Input: RouteFeatures {
  tokenA, tokenB,
  amountUSD,
  marketVolatility,
  timeOfDay,
  liquidityRatio
}
      │
      ▼
┌──────────────────────────────────┐
│ Is stablecoin pair?              │
│ (USDC/USDT/DAI/etc.)            │
└──────┬───────────────────────────┘
       │ YES
       ├──► Use: Saber, Mercurial (0.04% fees)
       │
       │ NO
       ▼
┌──────────────────────────────────┐
│ Trade size > $10,000?            │
└──────┬───────────────────────────┘
       │ YES
       ├──► Use: Orca Whirlpool + Raydium (deep liquidity)
       │
       │ NO
       ▼
┌──────────────────────────────────┐
│ Market volatility > 0.7?         │
└──────┬───────────────────────────┘
       │ YES
       ├──► Use: Single-hop Raydium (0.25%)
       │
       │ NO
       ▼
┌──────────────────────────────────┐
│ DEFAULT:                          │
│ Use: Raydium + Orca (avg 0.275%) │
└───────────────────────────────────┘
```

## State Management

```
┌────────────────────────────────────────────────────────────┐
│  DYNAMIC FEE MANAGER STATE                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ cachedFee: 12000                                      │  │
│  │ lastFetch: 1733788850123                              │  │
│  │ feeHistory: [10k, 11k, 12k, 12k, 11k, ...]           │  │
│  │ CACHE_TTL: 3000ms                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Methods:                                                   │
│  - getOptimalFee(connection, urgency) → Promise<number>    │
│  - getCachedFee() → number                                 │
│  - getFeeTrend() → 'rising' | 'falling' | 'stable'        │
│  - estimateSavings(fixedFee) → number                      │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  ML ROUTE SELECTOR STATE                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ performanceHistory: Map<string, RoutePerformance>    │  │
│  │   "SOL/USDC:Raydium->Orca" → {                       │  │
│  │     avgFeePercent: 0.00275,                          │  │
│  │     successRate: 0.92,                               │  │
│  │     sampleSize: 47,                                  │  │
│  │     ...                                              │  │
│  │   }                                                   │  │
│  │ HISTORY_FILE: data/route-performance.json            │  │
│  │ MIN_SAMPLES: 5                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Methods:                                                   │
│  - predictOptimalRoute(features) → Promise<Prediction>     │
│  - recordRoutePerformance(...)                            │
│  - getBestRoute(tokenPair) → string | null                │
│  - getPerformanceSummary() → string                        │
└────────────────────────────────────────────────────────────┘
```

## Error Handling & Fallbacks

```
┌───────────────────────────────────────────────────────────┐
│                    ERROR SCENARIOS                         │
└───────────────────────────────────────────────────────────┘

1. Helius API Failure
   ├─ Catch error
   ├─ Log warning
   ├─ Fallback to Standard RPC
   └─ Continue operation

2. Standard RPC Failure
   ├─ Use cached fee (if < 30s old)
   └─ Default to 50,000 µSOL

3. ML Model No Data
   ├─ Use heuristic rules
   ├─ Log confidence: low
   └─ Continue with safe defaults

4. Route Performance Error
   ├─ Skip recording
   ├─ Log warning
   └─ Continue trading

5. File I/O Error (ML data)
   ├─ Create directory if needed
   ├─ Initialize empty history
   └─ Start fresh training
```

---

**Architecture Version**: 1.0
**Last Updated**: December 9, 2025
**Status**: Production Ready ✅
