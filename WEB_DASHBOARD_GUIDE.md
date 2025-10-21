# 🎛️ Web Dashboard - Complete Guide

## Overview

The **Web Dashboard** is a full-featured control panel for your Solana arbitrage bot with:

✅ **Live Price Monitoring** - Real-time token prices updating every 5 seconds  
✅ **Start/Stop Controls** - Click buttons to control the bot  
✅ **Real-Time Logging** - See every action the bot takes  
✅ **Attempt Tracking** - Total attempts, successes, failures  
✅ **Profit Tracking** - Live profit counter in SOL  
✅ **Settings Editor** - Adjust gas fees, flashloan amounts, thresholds  
✅ **Beautiful UI** - Modern, responsive design  

---

## Quick Start

### 1. Start the Dashboard Server

```bash
npm run web-dashboard
```

You'll see:
```
╔═══════════════════════════════════════════════════════════════════════════╗
║                   🎛️  SOLANA ARBITRAGE BOT DASHBOARD                      ║
╚═══════════════════════════════════════════════════════════════════════════╝

🌐 Dashboard URL: http://localhost:3000
📊 API Endpoint: http://localhost:3000/api
🔌 WebSocket: Connected
```

### 2. Open Your Browser

Navigate to: **http://localhost:3000**

### 3. Control Your Bot

- Click **▶️ Start Bot** to begin trading
- Click **⏹️ Stop Bot** to stop trading
- Click **🔄 Reset Stats** to clear counters
- Click **⚙️ Settings** to adjust parameters

---

## Dashboard Features

### 📊 Statistics Display

**Six Real-Time Metrics:**

1. **⏱️ Uptime** - How long the bot has been running
2. **🎯 Total Attempts** - Opportunities detected
3. **✅ Successful** - Trades that executed successfully
4. **❌ Failed** - Trades that failed to execute
5. **📊 Success Rate** - Percentage of successful trades
6. **💰 Total Profit** - Net earnings in SOL (green = profit, red = loss)

All update in real-time as the bot runs!

### 📈 Live Prices

Real-time price table showing:
- **Token** - Symbol (SOL, USDC, BONK)
- **Price** - Current USD price
- **24h Change** - ▲ Green (up) or ▼ Red (down)

Updates every 5 seconds from Jupiter API.

### 🎯 Recent Opportunities

Shows the last 20 opportunities with:
- **Route** - Trading pair (e.g., "SOL→USDC")
- **Spread** - Profit percentage
- **Profit** - Expected profit in SOL
- **Status** - DETECTED → EXECUTING → SUCCESS/FAILED

Color-coded:
- 🔵 Blue - Detected
- 🟠 Orange - Executing (pulsing animation)
- 🟢 Green - Success
- 🔴 Red - Failed

### 📝 Live Logs

Scrollable log window showing:
- **Info** (blue) - General updates
- **Success** (green) - Successful trades
- **Warning** (yellow) - Warnings
- **Error** (red) - Errors

Auto-scrolls to show newest logs first. Stores last 100 entries.

### ⚙️ Settings Editor

Click **⚙️ Settings** to open the settings panel where you can adjust:

| Setting | Description | Example |
|---------|-------------|---------|
| **Max Gas Fee** | Maximum gas you'll pay per transaction | 0.02 SOL |
| **Max Flashloan Amount** | Maximum capital to borrow | 500000 |
| **Min Profit Threshold** | Minimum profit % to attempt trade | 0.002 (0.2%) |
| **Max Slippage** | Maximum price slippage allowed | 0.005 (0.5%) |
| **Priority Fee Multiplier** | Multiplier for priority fees to win races | 3.0 |

**Changes take effect immediately** and are saved to `.env` file.

---

## How to Use

### Typical Workflow

**1. Start Dashboard Server**
```bash
npm run web-dashboard
```

**2. Open Browser**
Go to http://localhost:3000

**3. Check Settings** (Optional)
- Click **⚙️ Settings**
- Adjust gas fees, profit thresholds, etc.
- Click **💾 Save Settings**

**4. Start Bot**
- Click **▶️ Start Bot**
- Status badge changes to **▶️ RUNNING** (green)
- Logs start appearing
- Statistics begin updating

**5. Monitor Activity**
- Watch **Live Prices** for market conditions
- Check **Recent Opportunities** for detected trades
- Review **Live Logs** for detailed activity
- Track **Statistics** for performance metrics

**6. Stop Bot** (When Done)
- Click **⏹️ Stop Bot**
- Bot stops immediately
- Statistics remain visible
- Click **🔄 Reset Stats** if you want to clear them

---

## Understanding the Interface

### Bot Status Indicators

**Status Badge (Top):**
- **⏸️ STOPPED** (red) - Bot is not running
- **▶️ RUNNING** (green) - Bot is actively trading

**Connection Status:**
- **🟢 Connected** (green dot) - Dashboard connected to server
- **🔴 Disconnected** (red dot) - Connection lost, try refreshing

### Opportunity Status Colors

**Opportunity cards show different colors based on status:**

1. **Blue Border - DETECTED**
   - Opportunity found, analyzing profitability
   - Not yet executing

2. **Orange Border - EXECUTING** (Pulsing)
   - Trade is being executed right now
   - Transaction being built and sent

3. **Green Border - SUCCESS**
   - Trade executed successfully
   - Profit realized and added to total

4. **Red Border - FAILED**
   - Trade failed to execute
   - See error message for reason
   - Common reasons:
     - Opportunity disappeared (another bot got it)
     - Insufficient funds
     - Transaction timeout
     - Rate limiting

### Log Levels

**Different log types for different events:**

- **ℹ️ Info** (Blue) - Normal operations
  ```
  [14:23:15] Bot started
  [14:23:18] Checking 3 tokens for opportunities
  ```

- **✅ Success** (Green) - Successful actions
  ```
  [14:25:32] Trade executed successfully: SOL→USDC
  [14:25:32] Profit: +0.0045 SOL
  ```

- **⚠️ Warning** (Yellow) - Non-critical issues
  ```
  [14:26:10] Rate limit approaching, slowing down
  [14:26:45] Price feed delayed
  ```

- **❌ Error** (Red) - Errors and failures
  ```
  [14:27:01] Trade failed: SOL→USDC
  [14:27:01] Error: Transaction timeout
  ```

---

## Settings Configuration

### Key Settings Explained

#### Max Gas Fee
**What it does:** Maximum SOL you'll pay in gas fees per transaction  
**Default:** 0.02 SOL (~$2.86 at $143/SOL)  
**Recommendations:**
- **Low activity:** 0.01 SOL (saves money, slower execution)
- **Medium activity:** 0.02 SOL (balanced)
- **High competition:** 0.05 SOL (expensive but wins races)

#### Max Flashloan Amount
**What it does:** Maximum amount you can borrow from MarginFi  
**Default:** 500,000 (in token units)  
**Recommendations:**
- **Testing:** 10,000 (small, safe)
- **Production:** 500,000 (standard)
- **High volume:** 1,000,000 (if you have success)

#### Min Profit Threshold
**What it does:** Minimum profit percentage to attempt a trade  
**Default:** 0.002 (0.2%)  
**Recommendations:**
- **Aggressive:** 0.0015 (0.15%) - More opportunities, lower profits
- **Balanced:** 0.002 (0.2%) - Good balance
- **Conservative:** 0.003 (0.3%) - Fewer opportunities, higher profits

#### Max Slippage
**What it does:** Maximum price movement you'll accept during trade  
**Default:** 0.005 (0.5%)  
**Recommendations:**
- **Stable tokens:** 0.001 (0.1%) - USDC, USDT
- **Volatile tokens:** 0.01 (1%) - BONK, WIF
- **Very volatile:** 0.02 (2%) - High risk

#### Priority Fee Multiplier
**What it does:** How much extra to pay to get faster execution  
**Default:** 3.0 (3x base fee)  
**Recommendations:**
- **No competition:** 1.0 (normal fees)
- **Some competition:** 3.0 (3x faster)
- **High competition:** 5.0-10.0 (much faster, expensive)

### When to Adjust Settings

**Scenario 1: Too Many Failed Trades**
```
Problem: Success rate < 20%
Cause: Opportunities disappearing before execution
Solution:
  - Increase Priority Fee Multiplier (3.0 → 5.0)
  - Increase Max Gas Fee (0.02 → 0.05)
```

**Scenario 2: Not Enough Opportunities**
```
Problem: Total Attempts = 0 or very low
Cause: Profit threshold too high
Solution:
  - Decrease Min Profit Threshold (0.002 → 0.0015)
  - Increase Max Slippage (0.005 → 0.01)
```

**Scenario 3: Losing Money**
```
Problem: Total Profit is negative
Cause: Gas fees eating profits, or bad opportunities
Solution:
  - Increase Min Profit Threshold (0.002 → 0.003)
  - Decrease Max Gas Fee (0.02 → 0.01)
  - Decrease Priority Fee Multiplier (3.0 → 1.0)
```

---

## Monitoring Best Practices

### What to Watch

**1. Success Rate**
- **Goal:** >30% success rate
- **If < 20%:** Opportunities disappearing too fast (need priority fees)
- **If > 50%:** Excellent! Bot is competitive

**2. Total Profit Trend**
- **Positive and growing:** Bot is profitable ✅
- **Negative:** Adjust settings, may be losing to fees
- **Flat at zero:** Not finding opportunities or breaking even

**3. Opportunity Frequency**
- **1-3 per hour:** Normal during stable markets
- **5-10 per hour:** Good volatility
- **20+ per hour:** Excellent! High activity period

**4. Log Patterns**
- **Lots of "Detected":** Good (finding opportunities)
- **Lots of "Failed":** Bad (increase priority fees)
- **Lots of "Success":** Great! Bot is working
- **No logs for 5+ minutes:** Check if bot froze

### Recording Performance

Keep a log to optimize:

```
Session Log - October 17, 2025

Time: 2:00 PM - 4:00 PM (2 hours)
Settings:
  - Max Gas Fee: 0.02 SOL
  - Min Profit: 0.2%
  - Priority Multiplier: 3.0

Results:
  - Attempts: 15
  - Successful: 5 (33% success rate)
  - Failed: 10
  - Total Profit: +0.0234 SOL (~$3.35)
  
Observations:
  - Most failures: "Transaction timeout"
  - Best route: SOL→USDC (3 successes)
  - Worst route: BONK→USDC (0 successes)

Next steps:
  - Increase priority multiplier to 5.0
  - Focus on SOL→USDC route
  - Consider removing BONK (too volatile)
```

---

## Troubleshooting

### Dashboard Won't Load

**Problem:** Browser shows "Can't reach this page"

**Solutions:**
1. Check server is running:
   ```bash
   npm run web-dashboard
   ```
2. Try different port (if 3000 is taken):
   ```bash
   # Edit .env
   DASHBOARD_PORT=3001
   ```
3. Try different browser (Chrome, Firefox, Edge)
4. Clear browser cache (Ctrl+F5)

### Connection Status: Disconnected

**Problem:** Red dot showing "Disconnected"

**Solutions:**
1. Refresh browser (F5)
2. Restart dashboard server:
   ```bash
   # Stop: Ctrl+C
   # Start: npm run web-dashboard
   ```
3. Check firewall isn't blocking port 3000

### Bot Won't Start

**Problem:** Click "Start Bot" but status stays "STOPPED"

**Solutions:**
1. Check logs for error messages
2. Ensure you have SOL in wallet for gas fees
3. Verify `.env` settings are correct
4. Restart dashboard server

### No Prices Showing

**Problem:** Price table empty or stuck

**Solutions:**
1. **If immediately after starting:** Wait 10-15 seconds
2. **If still empty:** Check if you're rate-limited by Jupiter
3. **If rate-limited:** Wait 1 hour, then restart
4. Try running with fewer tokens (edit `src/utils/index.ts`)

### No Opportunities Detected

**Problem:** "Total Attempts" stays at 0

**Possible Reasons:**
1. **Rate limited** - Wait for cooldown (see logs)
2. **Stable market** - No arbitrage opportunities exist (normal)
3. **Threshold too high** - Lower Min Profit Threshold in settings
4. **Token selection** - Try adding more volatile tokens

**Not a problem if:**
- Logs show "Found 0 opportunities" (means bot is checking)
- Markets are stable (low volatility = fewer opportunities)
- During off-peak hours (2-6 AM US time)

### Settings Won't Save

**Problem:** Click "Save" but settings revert

**Solutions:**
1. Check `.env` file permissions (should be writable)
2. Run dashboard with admin privileges
3. Manually edit `.env` file instead
4. Restart dashboard after editing `.env`

---

## Advanced Usage

### Running Multiple Bots

You can run dashboard + multiple bot instances:

**Terminal 1: Dashboard**
```bash
npm run web-dashboard
```

**Terminal 2: Bot Instance 1** (Different wallet)
```bash
# Edit .env with different WALLET_PRIVATE_KEY
npm start
```

**Terminal 3: Bot Instance 2** (Different wallet)
```bash
# Edit .env with different WALLET_PRIVATE_KEY
npm start
```

Dashboard will show combined statistics from all instances.

### Custom Port

Change dashboard port in `.env`:
```
DASHBOARD_PORT=8080
```

Then access at: http://localhost:8080

### Remote Access

To access dashboard from other devices on your network:

1. Get your computer's local IP:
   ```bash
   # Windows
   ipconfig
   # Look for "IPv4 Address"
   ```

2. Allow port in firewall

3. Access from other device:
   ```
   http://YOUR_IP:3000
   # Example: http://192.168.1.100:3000
   ```

**⚠️ WARNING:** Only do this on trusted local networks!

### API Endpoints

Dashboard also exposes REST API:

**GET /api/status**
```json
{
  "running": true,
  "uptime": 3600,
  "totalAttempts": 25,
  "successfulTrades": 8,
  "failedTrades": 17,
  "totalProfit": 0.0456,
  "lastActivity": "Trade executed: SOL→USDC"
}
```

**GET /api/settings**
```json
{
  "MAX_GAS_FEE": "0.02",
  "MAX_FLASHLOAN_AMOUNT": "500000",
  "MIN_PROFIT_THRESHOLD": "0.002"
}
```

**POST /api/settings**
```json
{
  "key": "MAX_GAS_FEE",
  "value": "0.05"
}
```

**POST /api/bot/start** - Start bot  
**POST /api/bot/stop** - Stop bot  
**POST /api/bot/reset-stats** - Reset statistics

---

## Comparison: Terminal vs Web Dashboard

| Feature | Terminal (`npm start`) | Web Dashboard |
|---------|----------------------|---------------|
| **Start/Stop** | Ctrl+C only | Click buttons |
| **Logs** | Scrolling text | Filterable, color-coded |
| **Statistics** | Text summary every 30s | Live updating cards |
| **Prices** | Not shown | Real-time table |
| **Opportunities** | Text log | Visual cards with status |
| **Settings** | Edit .env file | Click and type |
| **Multiple Windows** | Can't see bot + monitor | Single view, everything |
| **Remote Access** | SSH only | Any browser |
| **User Friendly** | 3/10 | 10/10 |

**Use Terminal when:**
- Running on remote server (no GUI)
- Deploying to production
- Want minimal resource usage

**Use Web Dashboard when:**
- Developing and testing
- Want to see what's happening
- Need to adjust settings quickly
- Want beautiful visualization

---

## Security Notes

### Local Only

By default, dashboard only accepts connections from `localhost` (your computer). This is safe.

### Remote Access Risks

If you enable remote access:
- ❌ Anyone with URL can access your bot
- ❌ Anyone can start/stop your bot
- ❌ Anyone can change settings
- ❌ Anyone can see your wallet activity

**Recommendation:** Only use on trusted local networks, never expose to internet.

### Production Deployment

For production:
1. Add authentication (username/password)
2. Use HTTPS (SSL certificate)
3. Use firewall rules (whitelist IPs)
4. Or don't use web dashboard at all (use terminal)

---

## Summary

The Web Dashboard gives you:

✅ **Full bot control** - Start, stop, reset from browser  
✅ **Real-time monitoring** - See everything as it happens  
✅ **Easy settings** - No more editing `.env` files  
✅ **Beautiful UI** - Modern, responsive design  
✅ **Live statistics** - Track performance in real-time  
✅ **Detailed logs** - Color-coded, filterable logging  

**Perfect for:**
- Development and testing
- Understanding bot behavior
- Optimizing strategy
- Impressing friends 😎

**Commands:**
```bash
# Start web dashboard
npm run web-dashboard

# Open browser
http://localhost:3000

# Stop dashboard
Ctrl+C in terminal
```

**Happy trading! 🚀**
