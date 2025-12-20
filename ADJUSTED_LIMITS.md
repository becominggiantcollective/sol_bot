# 🎚️ Adjusted Honeypot Detector Limits

## Summary

The honeypot detector has been adjusted to be **MORE LENIENT** while keeping critical safety checks intact.

## Changes Made

### ✅ Bot Configuration ([sniper-safe.mjs](sniper-safe.mjs:28))
```javascript
maxRiskScore: 70    // Increased from 40 (more aggressive)
```

### ✅ Detector Scoring ([honeypot-detector.mjs](honeypot-detector.mjs))

| Check | OLD | NEW | Change |
|-------|-----|-----|--------|
| **Mint Authority** | +15 points | +10 points | ✅ More lenient |
| **Freeze Authority** | +25 points | +20 points | ✅ More lenient |
| **High Tax Threshold** | >15% | >20% | ✅ More lenient |
| **High Tax Penalty** | +15 points | +10 points | ✅ More lenient |
| **Low Liquidity Threshold** | <$500 | <$250 | ✅ More lenient |
| **Low Liquidity Penalty** | +10 points | +8 points | ✅ More lenient |
| **Top Holder Threshold** | >90% | >95% | ✅ More lenient |
| **Top Holder Penalty** | +15 points | +10 points | ✅ More lenient |
| **Very New Token** | <30 min | <10 min | ✅ Much more lenient |
| **New Token Penalty** | +8 points | +5 points | ✅ More lenient |
| **Suspicious Name** | +10 points | +5 points | ✅ More lenient |
| **Sell Blocked** | +100 points | +100 points | ⚠️ KEPT (Critical!) |

## Risk Scenarios

### Worst Case (All Flags Triggered):
```
Mint Authority:     +10
Freeze Authority:   +20
High Tax:           +10
Low Liquidity:      +8
Top Holders:        +10
Very New:           +5
Suspicious Name:    +5
─────────────────────
TOTAL:              68/100 ✅ PASSES (< 70)
```

**Before adjustment**: Would have been **88/100** ❌ REJECTED

### Typical New Token:
```
Mint Authority:     +10
Low Liquidity:      +8
Very New:           +5
─────────────────────
TOTAL:              23/100 ✅ EASILY PASSES
```

### Definite Honeypot (Sell Blocked):
```
Sell Blocked:       +100
─────────────────────
TOTAL:              100/100 ❌ ALWAYS REJECTED
```

## What This Means

### ✅ More Tokens Will Pass:
- **New tokens** with mint authority are now acceptable
- Tokens with **low liquidity** ($250+) can still trade
- **Brand new tokens** (10+ min old) won't be penalized as much
- **Moderate taxes** (up to 20%) are now acceptable

### 🛡️ Critical Protection Remains:
- **Sell simulation** still blocks actual honeypots
- Tokens that **can't be sold** are always rejected
- **requireSellable: true** is still enforced

## Expected Impact

### Before (maxRiskScore: 40, strict limits):
```
100 tokens scanned
├─ 50 honeypots blocked (can't sell)
├─ 35 rejected (high risk score)
└─ 15 passed (15% pass rate)
```

### After (maxRiskScore: 70, lenient limits):
```
100 tokens scanned
├─ 50 honeypots blocked (can't sell - SAME)
├─ 15 rejected (high risk score)
└─ 35 passed (35% pass rate) ✅ 2.3x more!
```

## Testing

Run the preflight check to verify:
```bash
node preflight-check.mjs
```

Test with a known token:
```bash
node honeypot-detector.mjs So11111111111111111111111111111111111111112
```

## Risk Assessment

**Risk Level**: **MODERATE** ⚠️

**Why it's safer than it seems:**
1. Sell simulation still catches actual honeypots
2. You're trading tiny amounts (0.001 SOL)
3. Stop-loss at -15% limits damage
4. Max 1 position at a time

**Potential downsides:**
- May buy tokens with freeze authority (can be frozen)
- May buy very new tokens (higher rug risk)
- May buy low liquidity (harder to exit)

**Recommended safety:**
- Keep `tradeAmountSol: 0.001` (very small)
- Keep `requireSellable: true` (critical!)
- Monitor first 10-20 trades closely
- Be ready to hit Ctrl+C if needed

## Fine-Tuning

If you find you're still rejecting too many tokens, you can:

### Make Even More Lenient:
```javascript
// In sniper-safe.mjs
maxRiskScore: 80    // Very aggressive
```

### Or adjust individual checks in honeypot-detector.mjs:
```javascript
// Line 102: Mint authority
result.riskScore += 5;  // Even lighter

// Line 127: Liquidity
if (liquidity.totalLiquidityUsd < 100) {  // Allow $100+

// Line 145: Token age
if (age.ageMinutes < 5) {  // Only flag < 5 min old
```

### Make More Conservative:
If you get burned by risky tokens:
```javascript
// In sniper-safe.mjs
maxRiskScore: 50    // More conservative
```

## Current Configuration Summary

```
🎚️ LENIENT SETTINGS (Good for finding opportunities)
═══════════════════════════════════════════════════

Bot Level:
  maxRiskScore: 70/100
  requireSellable: true ✅

Detector Level:
  Mint Authority: +10 (was +15)
  Freeze Authority: +20 (was +25)
  High Tax (>20%): +10 (was >15%, +15)
  Low Liquidity (<$250): +8 (was <$500, +10)
  Top Holders (>95%): +10 (was >90%, +15)
  Very New (<10min): +5 (was <30min, +8)
  Suspicious Name: +5 (was +10)

Critical Safety:
  Sell Blocked: +100 ⚠️ ALWAYS REJECTS
```

## Ready to Test!

Start the bot:
```bash
node sniper-safe.mjs
```

With these settings, you should see:
- ✅ More tokens passing safety checks
- ✅ Sell simulation still protecting you
- ✅ Small positions limiting risk

Good luck and trade carefully! 🚀
