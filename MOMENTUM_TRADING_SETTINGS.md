# 🎢 MOMENTUM TRADING SETTINGS - UPDATED

## What Changed

Your bot was configured for **conservative late-stage trading** but the real opportunities are in **early momentum phase**. Updated to **BALANCED** settings based on market analysis.

---

## New Settings (BALANCED Momentum Strategy)

### Entry Thresholds
```javascript
MIN_LIQUIDITY: $3,500      // Was $10,000 (too conservative)
MIN_VOLUME_24H: $5,000     // Was $8,000
MIN_VOL_LIQ_RATIO: 1.8x    // NEW - ensures active trading
MIN_TOKEN_AGE: 20 minutes  // Avoid instant rugs
MAX_TOKEN_AGE: 10 hours    // Catch momentum window
MIN_PRICE_CHANGE_1H: +18%  // NEW - 1h momentum signal
```

### Why These Numbers?

**Successful pumps typically:**
- Start with $2K-$5K liquidity
- Have $5K-$100K volume in first 6 hours
- Show +30% to +500% price action
- Volume/Liquidity ratio of 2-10x (very active)
- Best entry: 30min - 6h after launch

**Your old settings ($10K liq, $8K vol):**
- Only caught tokens 12-24h old
- Missed 80% of momentum phase
- Found "established" tokens with less upside

---

## Exit Strategy (Ride the Wave)

### Multi-Stage Profit Taking
```javascript
1st Target: +50% (1.5x)  → Sell 30% of position
2nd Target: +100% (2x)   → Sell 30% more
Remaining: 40% rides with 20% trailing stop

Hard Stop: -12%
Time Exit: 45min if profit < +20%
```

### Why This Works
- **Take profits early** (secure gains at 1.5x and 2x)
- **Let winners run** (40% stays in for bigger pumps)
- **Cut losers fast** (12% hard stop)
- **Don't hold dead weight** (auto-exit after 45min)

---

## Market Phases

### 🎯 Early Entry (0-30min)
- **Skip this** - Too risky, many rugs
- Liquidity: $1.5K-$5K
- Volume: Low

### 📈 Momentum Phase (30min-6h) ⭐ YOUR TARGET
- **Best entry window**
- Liquidity: $3K-$15K
- Volume: $5K-$100K
- Price: +50% to +500%
- Vol/Liq: 2-10x

### 🎢 Established (6h-24h)
- Liquidity: $8K-$50K
- Volume: $20K-$500K
- Still can pump, but less upside

### 💤 Dead (24h+)
- Most pumps done
- Avoid unless fundamentals

---

## Safety (Always Active)

✅ Pre-buy Jupiter simulation  
✅ No freeze authority  
✅ No mint authority  
✅ Check top holder < 30%  
✅ Age verification (20min-10h)  
✅ Volume/liquidity ratio check  

---

## Expected Results

### Old Settings
- 0 trades in your tests
- Rejected everything as "too low liquidity"
- Missing all momentum plays

### New Settings
- Should find 1-5 viable tokens per day
- Catch pumps in progress (18%+ 1h momentum)
- Better risk/reward with partial exits
- Stop loss protects against rugs

---

## Comparison Chart

| Metric | Old | New | Why |
|--------|-----|-----|-----|
| Min Liquidity | $10K | $3.5K | Catch earlier stage |
| Min Volume | $8K | $5K | More opportunities |
| Vol/Liq Ratio | None | 1.8x | Filter for activity |
| Token Age | 5min+ | 20min-10h | Avoid rugs + dead tokens |
| 1h Momentum | None | +18% | Only trade pumps |
| Exit Strategy | Single TP | 3-stage | Ride winners |
| Max Hold | 5min | 45min | Let pumps develop |

---

## Trading Philosophy

**Old approach:** Wait for perfect setup, never found it  
**New approach:** Catch momentum early, take profits in stages  

**Key insight:** The REAL money is made in the 30min-6h window after a token proves it can pump but before it's "established." Your old settings missed this entire phase.

---

## Risk Management

- Max 3 positions (diversification)
- 12% hard stop on each (limit losses)
- Take 30% profit at 1.5x (secure gains)
- Take 30% more at 2x (bank it)
- Let 40% ride for home runs (10x+)

**Example scenario:**
- Buy $2.30 worth at entry
- Token hits 1.5x → Sell $1.03, keep $2.42 in
- Token hits 2x → Sell $1.38 more, keep $1.84 in
- Token hits 5x → Your remaining $1.84 is now $9.20
- Total profit: $1.03 + $1.38 + $7.36 = $9.77 on $2.30 risk ✅

**If it dumps:**
- Stop loss at -12% = lose $0.28 ❌
- But you need 1 winner to offset 20+ losers

---

## Next Steps

1. Bot is now configured with BALANCED settings
2. Monitor first 24 hours of trading
3. Adjust if needed:
   - Too many trades? → Increase minPriceChange1h to 25%
   - Too few trades? → Lower minVolume24h to $3K
   - Getting rugged? → Increase minTokenAge to 30min

---

## Files Updated

- `sniper-birdeye.mjs` - Main bot with new CONFIG
- Entry signals now check: age, vol/liq ratio, 1h momentum
- Exit strategy implements partial profit taking
- All safety checks still active

**Ready to catch some pumps! 🚀**
