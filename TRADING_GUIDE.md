# 🤖 Live Trading Guide - $20 Loss Limit Protection

## Quick Start

### 1. Start the Live Trader
```bash
node live-trader.mjs
```

This will:
- ✅ Scan for tokens from 3 sources (DexScreener, GeckoTerminal, trending)
- ✅ Use ML model to score each token (50%+ confidence required)
- ✅ Run Rug Shield protection on candidates
- ✅ Enter trades up to 3 positions max
- ✅ Auto-exit on +30% profit, -20% stop, or -12% trailing stop
- ✅ **STOP TRADING** when total losses reach $20

### 2. Monitor with Dashboard
```bash
node dashboard.mjs
```

Then press `[S]` to start monitoring.

The dashboard shows:
- 💼 Your active holdings with live P&L
- 📊 Win/Loss stats with average sizes
- 🚨 **Loss Limit Tracker**: $X.XX / $20.00 (XX%)
- 🤖 ML scores and confidence
- ⚡ Performance metrics

## Loss Limit Protection

### How It Works

1. **$20 Total Loss Cap**: Once you've lost $20 total, the bot STOPS trading
2. **$5 Max Per Trade**: Each trade risks max $5 (~0.01 SOL @ $120)
3. **Tracked in Real-Time**: Every closed losing trade adds to the counter
4. **Auto-Shutdown**: Bot exits when limit is reached

### Current Status

Check your current loss:
```bash
cat live-trader-stats.json
```

Look for `totalLossUSD` in the output.

### Reset Loss Counter (if needed)

**WARNING**: Only do this if you want to reset and start fresh:
```bash
rm live-trader-stats.json
```

## Why No Tokens Found?

### Common Reasons:

1. **ML Rejecting Tokens** (too risky)
   - Solution: Lower `MIN_ML_SCORE` from 0.5 to 0.4 in `live-trader.mjs`
   - Line 31: `MIN_ML_SCORE: 0.4,  // Lower to 40%`

2. **Rug Shield Blocking** (honeypots, freeze authority)
   - Solution: This is GOOD - keeps you safe
   - Check logs for "🛡️ RUG SHIELD BLOCKED"

3. **Low Liquidity**
   - Solution: Lower `MIN_LIQUIDITY_USD` from 500 to 200
   - Line 30: `MIN_LIQUIDITY_USD: 200,`

4. **Already at Max Positions**
   - Current: 3 positions max
   - Wait for trades to close before new entries

5. **Market Conditions**
   - Solution: Wait for more active trading hours (8am-6pm EST)
   - Peak memecoin activity is typically US market hours

### Debug Mode

See what's happening:
```bash
node live-trader.mjs 2>&1 | tee trader.log
```

This saves all output to `trader.log` for review.

Look for these messages:
- `🤖 Running ML analysis...` - ML is working
- `📊 ML Score: XX%` - See actual scores
- `❌ ML score too low: XX%` - Token rejected (lower MIN_ML_SCORE)
- `🚫 RUG SHIELD BLOCKED` - Honeypot detected (good!)
- `✅ PASSED ALL CHECKS` - Trade will be entered

## Adjusting Settings

### Make Bot More Aggressive (find more trades)

Edit `live-trader.mjs`:

```javascript
// Line 30-32
MIN_LIQUIDITY_USD: 200,     // Was 500 - allows smaller tokens
MIN_ML_SCORE: 0.4,          // Was 0.5 - 40% confidence
MAX_RUG_RISK: 0.8,          // Was 0.7 - tolerate more risk
```

### Make Bot More Conservative (safer but fewer trades)

```javascript
MIN_LIQUIDITY_USD: 2000,    // Higher liquidity requirement
MIN_ML_SCORE: 0.65,         // 65% confidence minimum
MAX_RUG_RISK: 0.5,          // Lower rug tolerance
```

### Adjust Trade Sizes

```javascript
// Line 29
TRADE_SIZE_SOL: 0.02,       // Increase to 0.02 SOL (~$2.40)
```

**Note**: Larger trades = hit loss limit faster!

### Adjust Exit Strategy

```javascript
// Lines 34-37
TAKE_PROFIT_PCT: 20,        // Take profit at +20% instead of +30%
STOP_LOSS_PCT: 15,          // Tighter stop at -15%
TRAILING_STOP_PCT: 8,       // Tighter trailing at -8%
MAX_HOLD_MINUTES: 5,        // Exit after 5 min regardless
```

## Token Discovery Sources

The bot scans 3 sources every 8 seconds:

1. **DexScreener Boosted** - Trending/promoted tokens
2. **GeckoTerminal New Pools** - Fresh launches
3. **DexScreener Trending** - High volume tokens

### Expanding Sources

Add more in `live-trader.mjs` line 50-54:

```javascript
TOKEN_SOURCES: [
  'https://api.dexscreener.com/token-boosts/latest/v1',
  'https://api.geckoterminal.com/api/v2/networks/solana/new_pools',
  'https://api.dexscreener.com/latest/dex/search?q=solana',
  // Add pump.fun API when available
  // Add Jupiter trending
]
```

## Statistics Tracking

### Win/Loss Analysis

Dashboard shows:
- **Win Rate**: % of profitable trades
- **Avg Win Size**: Average profit on winning trades
- **Avg Loss Size**: Average loss on losing trades

**Good Stats**:
- Win rate: 50%+
- Avg Win > Avg Loss (win $3, lose $2 = profitable even at 50%)

**Bad Stats**:
- Win rate: <40%
- Avg Win < Avg Loss (win $2, lose $4 = losing money even at 50%)

### Improve Stats

1. **Increase MIN_ML_SCORE** - More selective = higher win rate
2. **Tighter STOP_LOSS_PCT** - Cut losses faster
3. **Higher TAKE_PROFIT_PCT** - Let winners run longer

## Files Created

- `live-trader.mjs` - Main trading bot
- `positions-live.json` - Your active/closed positions
- `live-trader-stats.json` - Win/loss statistics
- `trader.log` - Debug output (if using tee command)

## Safety Features

✅ **Honeypot Detection** - Rug Shield tests if you can sell  
✅ **Freeze Authority Check** - Won't trade tokens that can be frozen  
✅ **ML Scoring** - Only trades 50%+ confidence tokens  
✅ **Loss Limit** - Hard stop at $20 total losses  
✅ **Position Limit** - Max 3 trades at once  
✅ **Auto Exits** - Stop loss, take profit, trailing stop, max hold  

## Common Issues

### "LOSS LIMIT REACHED"
- You've hit $20 in losses
- Reset: `rm live-trader-stats.json` (starts fresh counter)
- Or wait - bot won't trade until reset

### "Max positions reached"
- Already have 3 open trades
- Wait for one to close (profit target, stop loss, or max hold time)

### "No tokens found"
- See "Why No Tokens Found?" section above
- Try lowering MIN_ML_SCORE or MIN_LIQUIDITY_USD
- Check that Rug Shield isn't blocking everything (it should block honeypots)

### "ML prediction failed"
- Check that `ml-model.json` exists
- Run: `ls -la ml-*.json`
- If missing, ML will use fallback scoring

### Bot exits immediately
- Check if loss limit already hit: `cat live-trader-stats.json`
- Look for `"totalLossUSD": 20` or higher
- Reset to continue: `rm live-trader-stats.json`

## Next Steps

1. **Start Conservative**: Run with default settings first
2. **Monitor First Hour**: Watch logs to see what's being rejected
3. **Adjust**: Lower ML score or liquidity if too strict
4. **Track Stats**: Use dashboard to monitor win rate and loss limit
5. **Iterate**: Adjust take profit / stop loss based on results

## Emergency Stop

**CTRL+C** in the terminal running `live-trader.mjs`

Or use dashboard `[E]` key for emergency sell all positions.

---

**Current Balance**: $44.08  
**Loss Budget**: $20 (leaves you with $24+)  
**Max Risk Per Trade**: $5  
**Worst Case**: 4 losing trades = $20 loss = STOP  

Good luck! 🚀
