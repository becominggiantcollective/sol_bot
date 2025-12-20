# Phase 2: MEV Armor + Latency Optimization

## Overview
Transform your bot from "finding opportunities" to "capturing them first" with MEV protection and low-latency infrastructure.

**Timeline:** 2 days  
**Cost:** ~$50/month RPC  
**Expected Improvement:** +40% inclusion rate, -80% sandwich attacks, 10-50 micro-edges captured/hour

---

## 🚀 Step 1: Jito Turbo Bundles (Day 1 Morning)

### Why Jito?
- **Atomic execution**: All 3 legs execute or none (no partial fills)
- **MEV protection**: Your trades are private until included
- **Priority inclusion**: Tips go to validators, not sandwich bots

### Implementation

**1. Update flashLoanScalper.ts:**

```typescript
// Add at top
import { Bundle } from 'jito-ts';

// In executeFlashLoanTrade():
const bundle = new Bundle([], 3); // Max 3 transactions

// Add all swap transactions to bundle
bundle.addTipTx(
  yourWallet.publicKey,
  500_000n, // 500k lamports tip (~$0.11 at $230 SOL)
  jitoTipAccounts[Math.floor(Math.random() * jitoTipAccounts.length)]
);

// Submit atomically
const bundleId = await jitoClient.sendBundle(bundle);
```

**2. Jito Tip Accounts (mainnet):**
```typescript
const jitoTipAccounts = [
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
];
```

**3. Config Update:**

```bash
# .env
JITO_ENABLED=true
JITO_TIP_LAMPORTS=500000  # 0.0005 SOL (~$0.11)
JITO_BUNDLE_ENDPOINT=https://mainnet.block-engine.jito.wtf/api/v1/bundles
```

**Deployment:**
```bash
npm install jito-ts
./deploy-to-vps.sh  # Redeploy with Jito support
```

---

## 📡 Step 2: Helius Pro RPC (Day 1 Afternoon)

### Why Helius?
- **<50ms WebSocket latency** vs 200-500ms public RPC
- **Pool event subscriptions**: Know instantly when prices change
- **99.9% uptime**: No missed opportunities due to RPC downtime

### Setup

**1. Get Helius API Key:**
- Sign up: https://helius.dev
- Plan: Pro ($50/mo) - 1M requests/day
- Get API key from dashboard

**2. Update .env:**
```bash
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
```

**3. Enable WebSocket Monitoring:**

```typescript
// In flashLoanScalper.ts or new file: src/utils/poolMonitor.ts

import { Connection } from '@solana/web3.js';

const wsConnection = new Connection(
  process.env.HELIUS_WS_URL!,
  { commitment: 'confirmed', wsEndpoint: process.env.HELIUS_WS_URL }
);

// Subscribe to Raydium pool updates
const RAYDIUM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

wsConnection.onProgramAccountChange(
  RAYDIUM_PROGRAM,
  (accountInfo) => {
    // Pool state changed - recheck arbitrage
    console.log('🔔 Raydium pool update detected');
    detectOpportunities(); // Your function
  },
  'confirmed'
);

// Subscribe to Orca Whirlpools
const ORCA_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
wsConnection.onProgramAccountChange(ORCA_PROGRAM, ...);
```

**Benefit:** React to price changes in <100ms instead of 10s polling intervals.

---

## 🤖 Step 3: AI Mempool Watch (Day 2)

### Strategy: Snipe New Token Launches

**Goal:** Catch pump.fun launches BEFORE they migrate to Raydium, buy cheap, sell high on DEX.

### Implementation

**1. Install Yellowstone gRPC:**

```bash
# Already in your Cargo.toml, just build it
cd src
cargo build --release
```

**2. Create Mempool Scanner:**

```typescript
// src/utils/mempoolScanner.ts

import { YellowstoneGrpcClient } from 'yellowstone-grpc';
import { poolHunter } from './sentimentPoolHunter.js'; // Your existing sentiment

const client = new YellowstoneGrpcClient(
  'https://grpc.mainnet.rpcpool.com:443', // Or Helius gRPC
  process.env.GRPC_TOKEN
);

async function watchPumpFunLaunches() {
  const stream = await client.subscribe({
    accounts: {
      pumpfun: {
        account: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'], // pump.fun program
        owner: [],
        filters: [],
      },
    },
  });

  for await (const msg of stream) {
    if (msg.account) {
      const tokenMint = parseTokenMint(msg.account.data);
      
      // Check sentiment
      const sentiment = await poolHunter.analyzeSentiment(tokenMint);
      
      if (sentiment.score > 0.7 && sentiment.volumeSpike > 0.1) {
        console.log(`🎯 HIGH CONVICTION LAUNCH: ${tokenMint}`);
        console.log(`   Sentiment: ${sentiment.score}`);
        console.log(`   Volume Spike: ${(sentiment.volumeSpike * 100).toFixed(1)}%`);
        
        // Execute snipe buy
        await executeSniperBuy(tokenMint, 0.5); // 0.5 SOL position
      }
    }
  }
}

watchPumpFunLaunches();
```

**3. Sentiment Integration:**

Your bot already has `sentimentPoolHunter.ts` - just connect it:

```typescript
// In poolHunter.analyzeSentiment():
async analyzeSentiment(tokenMint: string) {
  // 1. Check HuggingFace sentiment model (you have this)
  const twitterSentiment = await this.hfClient.sentiment(tokenMint);
  
  // 2. Volume spike detection
  const volumeData = await fetchTokenVolume(tokenMint);
  const volumeSpike = (volumeData.current - volumeData.avg) / volumeData.avg;
  
  // 3. Holder concentration (whale detection)
  const holderData = await fetchHolders(tokenMint);
  const whaleDominance = holderData.top10Percent;
  
  return {
    score: twitterSentiment * 0.5 + (volumeSpike > 0.2 ? 0.3 : 0) + (whaleDominance < 0.4 ? 0.2 : 0),
    volumeSpike,
    whaleDominance,
    signal: twitterSentiment > 0.6 && volumeSpike > 0.1 ? 'BUY' : 'SKIP',
  };
}
```

**4. Deploy Sniper Strategy:**

```bash
# .env additions
SNIPER_ENABLED=true
SNIPER_POSITION_SIZE=0.5  # 0.5 SOL per snipe
MIN_SENTIMENT_SCORE=0.7   # 70%+ conviction only
MIN_VOLUME_SPIKE=0.1      # 10%+ volume spike
```

---

## 📊 Expected Results

### Before (Current State):
- Finding 0-5 opportunities/hour
- All showing negative profit (spreads too small)
- No execution (DRY_RUN=true)

### After Phase 2:
- **Micro-edges**: 10-50 captured/hour (0.02-0.15% each)
- **Jito bundles**: +40% inclusion rate (no sandwich attacks)
- **Helius WebSocket**: <100ms reaction time (vs 10s polling)
- **Sniper wins**: 2-5 pump.fun launches/day at +10-50% profit

### Revenue Projection:
```
Micro-arbitrage: 30 trades/day × 0.08% avg × 2 SOL avg = 0.048 SOL/day ($11/day)
Sniper trades:   3 launches/day × 20% avg × 0.5 SOL = 0.3 SOL/day ($69/day)
---
Total: ~$80/day - $50/mo RPC = ~$2,350/month profit
```

---

## 🛠️ Deployment Checklist

### Day 1 Morning: Jito Bundles
- [ ] Install `jito-ts` package
- [ ] Add bundle logic to `flashLoanScalper.ts`
- [ ] Update `.env` with Jito config
- [ ] Test bundle submission on devnet
- [ ] Deploy to VPS
- [ ] Monitor logs for "Bundle submitted" messages

### Day 1 Afternoon: Helius RPC
- [ ] Sign up for Helius Pro ($50/mo)
- [ ] Update `.env` with Helius URLs
- [ ] Add WebSocket subscriptions to Raydium/Orca
- [ ] Deploy to VPS
- [ ] Monitor logs for "<100ms" reaction times

### Day 2 Morning: Yellowstone gRPC
- [ ] Build Rust gRPC client (`cargo build --release`)
- [ ] Create `mempoolScanner.ts`
- [ ] Connect to sentiment agents
- [ ] Test pump.fun event detection

### Day 2 Afternoon: Integration Testing
- [ ] Enable `SNIPER_ENABLED=true`
- [ ] Monitor for 4 hours
- [ ] Verify micro-edges being captured
- [ ] Check Jito bundle inclusion rate
- [ ] Review profit calculations

---

## 🚨 Risk Management

### Jito Tips:
- Start with 100k lamports ($0.02) for testing
- Increase to 500k ($0.11) for competitive inclusion
- Only tip if profit > 0.5% (don't waste gas)

### Helius Costs:
- Pro plan: $50/mo for 1M requests
- Monitor usage dashboard
- If >1M/day, upgrade to Scale ($250/mo)

### Sniper Risk:
- Max position: 0.5 SOL per snipe ($115)
- Stop loss: -20% (exit if drops)
- Max daily exposure: 2 SOL ($460)
- Only trade >0.7 sentiment score

---

## 📝 Code Review Before Go-Live

**Critical checks:**
1. **Jito bundle size**: Max 3 transactions (swap1, swap2, swap3)
2. **Tip calculation**: Only tip if `netProfit > tipAmount * 2`
3. **WebSocket reconnection**: Handle disconnects gracefully
4. **Sentiment threshold**: Don't snipe <0.7 score (too risky)
5. **Position sizing**: Never exceed `MAX_POSITION_SIZE` from .env

---

## 🎯 Success Metrics (Week 1)

Track these in logs:

- **Micro-edge capture rate**: >60% of detected opportunities
- **Jito inclusion rate**: >80% of submitted bundles
- **Average latency**: <200ms from pool change to execution
- **Sniper win rate**: >50% profitable exits
- **Daily profit**: >$50 (covers RPC + buffer)

If any metric fails, debug before scaling up position sizes.

---

## 🔧 Troubleshooting

**"Bundle failed to include":**
- Increase tip to 1M lamports ($0.23)
- Check validator selection (rotate tip accounts)
- Verify bundle transaction validity

**"WebSocket disconnected":**
- Add reconnection logic (exponential backoff)
- Use Helius status page for outage alerts
- Have fallback to HTTP polling

**"Sniper bought but price dumped":**
- Tighten sentiment threshold (0.75+)
- Add whale detection (skip if top10 > 40%)
- Lower position size to 0.25 SOL

---

## Next Steps After Phase 2

**Phase 3 (Week 2):** Machine Learning Router
- Train model on profitable routes
- Auto-select best DEX combinations
- Predict price impact before execution

**Phase 4 (Week 3):** Multi-Strategy Portfolio
- 40% micro-arbitrage (stable, low risk)
- 30% flash loan scalping (medium risk)
- 20% sniper (high risk, high reward)
- 10% liquidations (opportunistic)

**Phase 5 (Month 2):** Scale to Production
- Increase position sizes (5-10 SOL)
- Multi-wallet deployment (avoid nonce conflicts)
- 24/7 monitoring with alerts
- Auto-rebalancing profit to stablecoins

**Target: $5,000-10,000/month by Month 2.**
