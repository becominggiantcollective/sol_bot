# 🍯 Honeypot Detector Guide

## Overview

The honeypot detector is a critical safety system that analyzes Solana tokens before purchase to identify scam tokens (honeypots) that prevent selling. It's integrated into `sniper-safe.mjs` and can be used standalone.

## How It Works

The detector performs **6 comprehensive checks** on each token:

### 1. **Token Authorities Check** (Risk: 15-25 points)
- **Mint Authority**: Can the creator mint unlimited tokens?
  - ✅ Good: Authority revoked
  - ⚠️ Risk: Authority enabled (+15 points)
- **Freeze Authority**: Can the creator freeze your wallet?
  - ✅ Good: Authority revoked
  - 🚨 High Risk: Authority enabled (+25 points)

### 2. **Sell Simulation** (Risk: 0-100 points)
- Tests if Jupiter can route a sell transaction
- **Blocked Sell**: Transaction fails → +100 points (DEFINITE HONEYPOT)
- **High Tax**: >15% slippage → +15 points
- Uses correct token decimals for accurate simulation

### 3. **Liquidity Check** (Risk: 0-10 points)
- Checks DexScreener for total liquidity
- **Low Liquidity**: <$500 → +10 points
- Low liquidity = easy manipulation

### 4. **Holder Distribution** (Risk: 0-15 points)
- Analyzes top 10 token holders
- **High Concentration**: >90% held by top 10 → +15 points
- Indicates potential rug pull risk

### 5. **Token Age** (Risk: 0-8 points)
- Checks when token was created
- **Very New**: <30 minutes old → +8 points
- Brand new tokens are higher risk

### 6. **Name Pattern Matching** (Risk: 0-10 points)
- Scans for known scam patterns:
  - Celebrity names (elon, trump, biden)
  - Hype words (1000x, moon, safe)
  - Copy tokens (doge2, pepe2, babyshib)
  - Scam terms (airdrop, free, giveaway)

## Risk Score Interpretation

| Score | Assessment | Action |
|-------|------------|--------|
| 0-14 | ✅ RELATIVELY SAFE | Low risk indicators |
| 15-34 | ⚡ MODERATE RISK | Trade with caution |
| 35-54 | ⚠️ CAUTION | Multiple risk factors |
| 55+ | 🚫 DO NOT BUY | HIGH HONEYPOT RISK |

## Configuration

### In sniper-safe.mjs

```javascript
const CONFIG = {
  maxRiskScore: 40,         // Max acceptable risk (0-100)
  requireSellable: true,    // Must pass sell simulation
  minLiquidity: 500,        // Minimum liquidity in USD
  minTokenAge: 2,           // Minimum age in minutes
};
```

### Adjusting Risk Tolerance

**Conservative (Recommended):**
```javascript
maxRiskScore: 30          // Very strict
minLiquidity: 1000        // Higher liquidity requirement
minTokenAge: 60           // Wait 1 hour
```

**Moderate:**
```javascript
maxRiskScore: 40          // Balanced (current default)
minLiquidity: 500
minTokenAge: 2
```

**Aggressive (Not Recommended):**
```javascript
maxRiskScore: 50          // More lenient
minLiquidity: 250
minTokenAge: 0
```

## Usage

### Standalone Testing

Test a specific token:
```bash
node honeypot-detector.mjs <TOKEN_MINT>
```

Example:
```bash
node honeypot-detector.mjs So11111111111111111111111111111111111111112
```

### Run Test Suite

Test with known safe tokens:
```bash
node test-honeypot-detector.mjs
```

### Integration in Your Bot

```javascript
import { quickCheck, detectHoneypot } from './honeypot-detector.mjs';

// Quick check (fast)
const result = await quickCheck(tokenMint, 40); // 40 = max risk score
if (result.safe && result.canSell) {
  // Safe to trade
  console.log(`Risk: ${result.riskScore}/100`);
}

// Full analysis (detailed)
const fullResult = await detectHoneypot(tokenMint);
console.log(fullResult.recommendation);
console.log(fullResult.flags); // Array of issues found
```

## Features

### ✅ Smart Improvements

1. **Retry Logic**: Automatically retries failed API calls with exponential backoff
2. **Dynamic Decimals**: Correctly handles tokens with any decimal precision
3. **Threshold Consistency**: Risk threshold properly passed between components
4. **Environment Variables**: API keys can be stored in .env file
5. **Whitelisting**: Major tokens (SOL, USDC, BONK, etc.) skip checks

### 🛡️ Safety Mechanisms

- **Fail-Safe**: If detection fails, token is rejected
- **Timeout Protection**: 10-second timeout on sell simulation
- **Multiple Data Sources**: Cross-references DexScreener, Helius, Jupiter
- **Real Simulation**: Actually simulates sell on Jupiter router

## Common Scenarios

### Scenario 1: Definite Honeypot
```
🍯 HONEYPOT DETECTED! Skipping.
Reason: Sell simulation FAILED - likely honeypot
Risk Score: 100/100
```
**Action**: NEVER BUY - Cannot sell this token

### Scenario 2: High Risk but Not Honeypot
```
⚠️ Risk too high: 55/100 (max: 40)
⚠️ CAUTION - Multiple risk factors
Flags:
- Mint authority NOT revoked
- Very low liquidity
- Token created <1 hour ago
```
**Action**: Skip or wait for conditions to improve

### Scenario 3: Safe Token
```
✅ SAFE! Risk: 12/100
✅ RELATIVELY SAFE - Low risk indicators
```
**Action**: Proceed with trade

## Environment Setup

Create a `.env` file (copy from `.env.example`):

```bash
# Helius RPC (for fast reliable data)
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Jupiter API
JUPITER_API_URL=https://public.jupiterapi.com

# Your wallet (base58 encoded)
WALLET_PRIVATE_KEY=YOUR_PRIVATE_KEY
```

## Running the Safe Sniper Bot

### Prerequisites
```bash
npm install
```

### Start the Bot
```bash
node sniper-safe.mjs
```

### What to Expect
```
🛡️ SAFE SNIPER BOT v3 - Honeypot Protected
═══════════════════════════════════════════════════════════
💰 Balance: 0.12345 SOL (~$28.39)
📊 Scanned: 45 | 🍯 Honeypots: 12 | ❌ Rejected: 28
🛒 Bought: 3 | 💰 Sold: 2
⚙️  Risk Threshold: 40/100
───────────────────────────────────────────────────────────

📈 OPEN POSITIONS:
   TOKEN1: 1,000,000 tokens | Entry: 0.001 SOL | 5m ago

───────────────────────────────────────────────────────────
Press Ctrl+C to stop
═══════════════════════════════════════════════════════════
```

## Performance Tips

1. **Start Conservative**: Use maxRiskScore: 30 initially
2. **Monitor Results**: Track honeypots detected vs false positives
3. **Adjust Gradually**: Increase risk tolerance if too many good tokens are rejected
4. **Use Good RPC**: Helius or QuickNode for fast, reliable data
5. **Small Positions**: Even with detection, start with minimal amounts

## Known Limitations

1. **New Attack Vectors**: Scammers constantly evolve techniques
2. **False Positives**: Some legitimate tokens may have high risk scores
3. **API Dependency**: Relies on Jupiter, DexScreener, Helius availability
4. **Time Lag**: Detection takes 2-5 seconds per token
5. **No Guarantee**: Detection significantly reduces risk but cannot eliminate it

## Troubleshooting

### "Check failed" Error
- **Cause**: API timeout or rate limit
- **Solution**: Wait a moment, retry logic will handle it

### All tokens rejected
- **Cause**: Risk threshold too strict
- **Solution**: Increase `maxRiskScore` to 50

### Can't get quote
- **Cause**: Token has no Jupiter route or liquidity
- **Solution**: This is working as intended - token is likely not tradeable

### Detection too slow
- **Cause**: Network latency
- **Solution**: Use faster RPC (Helius, QuickNode with paid plan)

## Best Practices

1. ✅ **Always enable honeypot detection**
2. ✅ **Start with small trade amounts** (0.001 SOL)
3. ✅ **Use stop-loss** (bot has 15% stop-loss by default)
4. ✅ **Take profits quickly** (bot has 20% take-profit by default)
5. ✅ **Monitor positions actively**
6. ✅ **Keep API keys in .env** (never commit to git)
7. ❌ **Never trade more than you can afford to lose**

## Support

If you encounter issues:
1. Check the test suite: `node test-honeypot-detector.mjs`
2. Test a specific token: `node honeypot-detector.mjs <MINT>`
3. Review logs for specific error messages
4. Verify your RPC endpoint is working

---

**Remember**: No honeypot detector is 100% perfect. Always trade responsibly and never invest more than you can afford to lose.
