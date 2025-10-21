# 📊 Live Price Dashboard - User Guide

## Overview

The **Live Price Dashboard** gives you a real-time visual representation of:
- ✅ Current token prices (updating every 5 seconds)
- ✅ 24-hour price changes and volume
- ✅ Live arbitrage opportunities
- ✅ Profit spreads between trading pairs
- ✅ What's working vs what isn't

This helps you **see exactly what your bot sees** and understand why it's making (or not making) trades.

---

## Quick Start

### Run the Dashboard

```bash
npm run dashboard
```

That's it! The dashboard will start updating every 5 seconds.

### To Stop

Press `Ctrl+C`

---

## What You'll See

### Example Dashboard Output

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    🚀 SOLANA ARBITRAGE BOT - LIVE FEED                    ║
╚═══════════════════════════════════════════════════════════════════════════╝
📊 Updates: 42 | ⏱️  Uptime: 3m 30s | 🔄 Refresh: 5s

┌─────────────────────────────── LIVE PRICES ───────────────────────────────┐
│ Token      Price (USD)      24h Change      24h Volume      Last Update   │
├───────────────────────────────────────────────────────────────────────────┤
│ SOL           $143.2500    🟢      +2.34%    $1.2B              5s ago   │
│ USDC            $1.0001    🟢      +0.01%    $800M              5s ago   │
│ BONK       $0.00002145    🔴      -5.67%    $250M              5s ago   │
└───────────────────────────────────────────────────────────────────────────┘

┌────────────────────────── ARBITRAGE OPPORTUNITIES ────────────────────────┐
│ Route           Buy Price       Sell Price      Spread      Status        │
├───────────────────────────────────────────────────────────────────────────┤
│ SOL→USDC         0.006978        143.250      +0.450%    ✅ PROFIT       │
│ BONK→SOL    46623.123000          0.000      +0.320%    ✅ PROFIT       │
│ USDC→BONK        1.000100     46589.234      -0.150%    ❌ NO PROFIT    │
│ SOL→BONK         0.006980          0.000      -0.210%    ❌ NO PROFIT    │
│ USDC→SOL         1.000050        143.180      -0.280%    ❌ NO PROFIT    │
│ BONK→USDC   46650.000000          1.000      -0.340%    ❌ NO PROFIT    │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────── STATISTICS ───────────────────────────────┐
│ Total Routes:   6 | Profitable:   2 | Avg Spread:   -0.035%              │
└───────────────────────────────────────────────────────────────────────────┘

🎯 Profitable opportunities detected! Bot should be executing trades.

💡 Tip: This dashboard shows LIVE data. Your bot uses the same Jupiter API.
Press Ctrl+C to exit
```

---

## Understanding the Dashboard

### Section 1: Header

```
📊 Updates: 42 | ⏱️  Uptime: 3m 30s | 🔄 Refresh: 5s
```

- **Updates**: How many price refreshes have happened
- **Uptime**: How long the dashboard has been running
- **Refresh**: Update interval (5 seconds)

### Section 2: Live Prices

Shows real-time price data for each token:

| Column | Description |
|--------|-------------|
| **Token** | Token symbol (SOL, USDC, BONK) |
| **Price (USD)** | Current price in US dollars |
| **24h Change** | Price change over 24 hours (🟢 up, 🔴 down) |
| **24h Volume** | Trading volume in last 24 hours |
| **Last Update** | How long ago the price was fetched |

**What to look for:**
- 🟢 **Green (positive change)**: Token is trending up
- 🔴 **Red (negative change)**: Token is trending down
- **High volume** = More liquidity = Better for arbitrage

### Section 3: Arbitrage Opportunities

Shows potential profitable trades:

| Column | Description |
|--------|-------------|
| **Route** | Trading pair (e.g., SOL→USDC) |
| **Buy Price** | How much of Token B you need for 1 Token A |
| **Sell Price** | How much of Token B you get for 1 Token A |
| **Spread** | Profit percentage after fees |
| **Status** | ✅ Profitable or ❌ Not profitable |

**What the spread means:**
- **+0.450%** = You'd make 0.45% profit (GOOD!)
- **-0.150%** = You'd lose 0.15% (BAD - no trade)
- **Threshold**: Need >0.2% to cover fees and be profitable

**Status indicators:**
- ✅ **PROFIT** (Green): Spread > 0.2% - Bot should trade this
- ❌ **NO PROFIT** (Red): Spread < 0.2% - Bot ignores this

### Section 4: Statistics

Quick summary of opportunities:

- **Total Routes**: How many trading pairs checked (3 tokens = 6 routes)
- **Profitable**: How many routes have >0.2% spread
- **Avg Spread**: Average profit across all routes

### Section 5: Status Message

Real-time status:
- 🎯 **Green**: Profitable opportunities found - bot should be trading
- ⏳ **Yellow**: No opportunities - waiting for better prices

---

## How to Use This Dashboard

### 1. Check If Your Bot Is Seeing Opportunities

**Run the dashboard:**
```bash
npm run dashboard
```

**Look at "Profitable" count:**
- **Profitable: 0** → No opportunities right now (normal during stable markets)
- **Profitable: 1-3** → Good! Your bot should be attempting trades
- **Profitable: 5+** → Excellent! High volatility = many opportunities

### 2. Compare Dashboard vs Bot Output

**Open TWO terminals side-by-side:**

**Terminal 1 (Dashboard):**
```bash
npm run dashboard
```

**Terminal 2 (Bot):**
```bash
npm start
```

**What to check:**
- ✅ Dashboard shows profitable routes → Bot should log "Found X opportunities"
- ✅ Dashboard shows 0 profitable → Bot should log "Found 0 opportunities"
- ❌ Dashboard shows profitable but bot doesn't → Something's wrong!

### 3. Diagnose Issues

#### Problem: Dashboard shows opportunities but bot doesn't execute

**Possible causes:**
1. **Rate limiting**: Check bot logs for "rate limit hit"
2. **Insufficient funds**: Bot needs gas fees (~0.001 SOL per trade)
3. **Transaction failures**: Check for "0x1789" errors (opportunity disappeared)
4. **Flashloan issues**: Check for MarginFi errors

#### Problem: Dashboard shows 0 opportunities constantly

**Possible causes:**
1. **Normal market conditions**: Arbitrage isn't always available
2. **Low volatility**: SOL/USDC are stable right now
3. **Need more tokens**: Add WIF, POPCAT, etc. for more routes
4. **Jupiter API issues**: Check if prices are updating

#### Problem: Dashboard not updating

**Possible causes:**
1. **Rate limit hit**: You're making too many requests
2. **Network issue**: Check your internet connection
3. **Jupiter API down**: Wait and try again later

### 4. Monitor Price Movements

Watch the **24h Change** column:

**High volatility (good for arbitrage):**
```
BONK    🔴 -8.45%  ← Big price movement!
WIF     🟢 +12.30% ← Lots of volatility!
```

**Low volatility (harder for arbitrage):**
```
SOL     🟢 +0.15%  ← Very stable
USDC    🟢 +0.01%  ← Pegged to $1
```

**More volatility = More arbitrage opportunities**

### 5. Optimize Your Strategy

Based on what you see:

#### Scenario A: Lots of profitable routes (3-5+)
```
✅ Strategy is working!
✅ Consider adding priority fees to win races
✅ Consider increasing trade size
```

#### Scenario B: No profitable routes for hours
```
⚠️ Not enough volatility
⚠️ Consider adding more volatile tokens (WIF, POPCAT)
⚠️ Consider lowering profit threshold (0.15% instead of 0.2%)
```

#### Scenario C: Opportunities appear briefly then disappear
```
⚠️ Other bots are faster
⚠️ Add priority fees (0.001-0.01 SOL)
⚠️ Upgrade to faster RPC provider
```

---

## Advanced Usage

### Run Both Dashboard and Bot Simultaneously

**Option 1: Two Terminal Windows**

Terminal 1:
```bash
npm run dashboard
```

Terminal 2:
```bash
npm start
```

**Option 2: Split Terminal (VS Code)**
1. Open terminal
2. Click split terminal icon
3. Run dashboard in left pane, bot in right pane

### Monitor Specific Time Periods

Watch during high-activity times:
- **Market open/close**: 9:30 AM - 4:00 PM EST (US stock market)
- **Evening (US)**: 7:00 PM - 11:00 PM EST (Asian market activity)
- **Volatility events**: Token launches, major news, market dumps

### Record Dashboard Output

Save dashboard data to file:
```bash
npm run dashboard > dashboard-log.txt
```

Press `Ctrl+C` after 5-10 minutes to save the log.

---

## Interpreting Results

### Example 1: Working Correctly

**Dashboard shows:**
```
Profitable:   3 | Avg Spread: +0.350%
```

**Bot logs show:**
```
Found 3 total opportunities
🎯 Best opportunity: SOL→USDC (0.45% profit)
🏦 Building MarginFi flashloan transaction...
```

**Interpretation**: ✅ Everything working! Bot sees opportunities and attempts trades.

### Example 2: Rate Limited

**Dashboard shows:**
```
Last Update: 45s ago (price stuck, not updating)
```

**Bot logs show:**
```
⚠️ Jupiter rate limit hit (attempt 2) - cooling down for 30s
```

**Interpretation**: ⚠️ You're rate limited. Dashboard uses same API, so both are affected.

### Example 3: No Opportunities

**Dashboard shows:**
```
Profitable:   0 | Avg Spread: -0.120%
```

**Bot logs show:**
```
Found 0 total opportunities
```

**Interpretation**: ✅ Normal. Markets are stable right now. Wait for volatility.

### Example 4: High Competition

**Dashboard shows:**
```
SOL→USDC: +0.450% ✅ PROFIT
```

**Bot logs show:**
```
Found 1 opportunity
❌ Transaction failed: 0x1789 (custom program error)
```

**Interpretation**: ⚠️ Opportunity existed but another bot got it first. Add priority fees.

---

## Troubleshooting

### Dashboard won't start

**Error: "Cannot find module"**
```bash
npm install
npm run dashboard
```

### Prices not updating

**Check your rate limit status:**
- Dashboard paused? → Wait 30-60 seconds
- "Last Update" stuck? → You're rate limited
- All tokens showing $0? → Jupiter API issue

**Solution:**
```bash
# Stop dashboard (Ctrl+C)
# Wait 1 minute
npm run dashboard
```

### Can't see both dashboard and bot

**Use VS Code split terminal:**
1. Open terminal (`Ctrl+``)
2. Click split icon (top-right of terminal)
3. Left pane: `npm run dashboard`
4. Right pane: `npm start`

### Dashboard uses too much CPU

**Normal**: 2-5% CPU (refreshing every 5 seconds)
**High**: 20%+ CPU (you might be rate limited, API calls piling up)

**Solution:**
```bash
# Stop dashboard
# Edit live-dashboard.ts, change line 52:
await this.delay(10000); // Change from 5000 to 10000 (10 seconds)
```

---

## Dashboard vs Bot: Key Differences

| Feature | Dashboard | Bot |
|---------|-----------|-----|
| **Purpose** | Show what's happening | Execute trades |
| **Update Speed** | 5 seconds | 20 seconds (with 3s delays) |
| **API Calls** | ~4 per cycle (prices + quotes) | ~12 per cycle (all routes) |
| **Rate Limit Risk** | Low (fewer calls) | Higher (more calls) |
| **Shows Profits** | Theoretical (from API) | Actual (after execution) |

**Important**: Dashboard shows THEORETICAL profits. Actual profits may be lower due to:
- Slippage (price moves during execution)
- Gas fees (~0.001-0.005 SOL)
- Flashloan fees (0.01% with MarginFi)
- Network latency (opportunity disappears)

---

## Tips & Best Practices

### 1. Run Dashboard First

Before running your bot:
```bash
# 1. Check if opportunities exist
npm run dashboard

# 2. Wait 30 seconds, watch for profitable routes

# 3. If you see 2+ profitable routes, start bot
npm start
```

### 2. Use Dashboard to Optimize Token Selection

Try different token combinations:

**Current (3 tokens):**
```
SOL, USDC, BONK → 6 routes
Profitable: 0-1 typically
```

**Add WIF (4 tokens):**
```
SOL, USDC, BONK, WIF → 12 routes
Profitable: 1-3 typically
```

**Add more (6 tokens):**
```
SOL, USDC, BONK, WIF, POPCAT, JTO → 30 routes
Profitable: 3-7 typically
Risk: Higher rate limit chance
```

### 3. Watch During Volatility

Best times to find opportunities:
- Token launches
- Major news events
- Market-wide dumps/pumps
- Weekend trading (lower liquidity)

### 4. Document Your Findings

Take notes on what works:
```
Date: Oct 17, 2025
Time: 3:30 PM
Tokens: SOL, USDC, BONK
Profitable routes: 2
Best spread: SOL→USDC +0.45%
Bot executed: YES
Result: Success, 0.03 SOL profit
```

This helps you optimize strategy over time.

---

## Next Steps

### After Using Dashboard

1. **Understand current market**: Are opportunities available?
2. **Validate bot is working**: Does it see same opportunities?
3. **Optimize token selection**: Add/remove tokens based on profits
4. **Adjust thresholds**: Lower from 0.2% to 0.15% if competitive
5. **Upgrade tools**: Jupiter Pro, better RPC, priority fees

### Monitor Both Side-by-Side

Run for 30 minutes and compare:
- Dashboard shows X opportunities
- Bot attempts Y trades
- Z trades succeed

**Goal**: X ≈ Y (bot sees what dashboard sees)
**Goal**: Y → Z is high % (most attempts succeed)

If Z is much lower than Y, you need:
- Priority fees (to win races)
- Faster RPC (lower latency)
- Better timing (catch opportunities sooner)

---

## Summary

The Live Price Dashboard gives you **visual insight** into:
- ✅ What prices are doing in real-time
- ✅ Where arbitrage opportunities exist
- ✅ Whether your bot should be finding trades
- ✅ If things are working or broken

Use it to:
- 🎯 Validate your bot is seeing opportunities
- 🔍 Diagnose issues when trades aren't happening
- 📊 Understand market conditions
- ⚡ Optimize your token selection and strategy

**Remember**: Dashboard shows POTENTIAL. Your bot must execute FAST to capture profits!

---

**Happy trading! 🚀**
