# Production Deployment Guide
## Solana Arbitrage Bot

This guide provides step-by-step instructions for deploying the Solana Arbitrage Bot to production safely and effectively.

---

## Prerequisites

Before deploying to production, ensure you have:

- [ ] Read and understood the `PRE_GO_LIVE_ASSESSMENT.md` document
- [ ] Completed all Phase 1 critical fixes from the assessment
- [ ] Successfully run the bot on Solana devnet for 48+ hours
- [ ] Set up a dedicated RPC provider (Helius, QuickNode, or Triton)
- [ ] Prepared a secure secrets management solution
- [ ] Set up monitoring and alerting infrastructure
- [ ] Allocated starting capital ($100-500 recommended for initial deployment)
- [ ] Reviewed and understood the legal/ethical implications

---

## Phase 1: Pre-Deployment Setup

### 1.1 Security Fixes

**Fix npm vulnerabilities:**
```bash
cd /path/to/sol_bot
npm audit fix
```

**Review the audit report:**
```bash
npm audit
```

If high-severity issues remain (like bigint-buffer), evaluate the risk and consider upgrading with breaking changes:
```bash
npm audit fix --force  # Use with caution, test thoroughly
```

### 1.2 RPC Provider Setup

**Sign up for a dedicated RPC provider:**

1. **Helius** (Recommended for beginners):
   - Go to https://helius.dev
   - Create account and get API key
   - Free tier: 100 requests/second

2. **QuickNode** (High performance):
   - Go to https://quicknode.com
   - Free trial available
   - Solana mainnet endpoint

3. **Triton** (MEV-focused):
   - Go to https://triton.one
   - Specialized for MEV bots
   - gRPC support

**Configure endpoints:**
```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### 1.3 Secrets Management

**Option A: Environment Variables (Simple, for small deployments)**

Create a secure `.env.production` file:
```bash
cp .env.example .env.production
chmod 600 .env.production  # Restrict file permissions
```

**Option B: Cloud Secrets Manager (Recommended for production)**

Example with AWS Secrets Manager:
```bash
# Install AWS CLI
aws configure

# Store private key
aws secretsmanager create-secret \
  --name solbot/wallet/private-key \
  --secret-string '[your,private,key,array]'

# Store in application
# Retrieve in code using AWS SDK
```

### 1.4 Wallet Setup

**Create a dedicated trading wallet:**

```bash
# Generate new keypair (do this securely offline if possible)
solana-keygen new --outfile ~/trading-wallet.json

# Get the address
solana-keygen pubkey ~/trading-wallet.json

# Fund the wallet (start with minimal amount)
# Transfer 0.5-1 SOL for gas fees
# Transfer $100-500 worth of trading capital
```

**CRITICAL: Backup your wallet:**
- Store keypair in multiple secure locations
- Never commit to version control
- Use hardware wallet for larger amounts

---

## Phase 2: Configuration

### 2.1 Production Environment File

Create `.env.production` with hardened settings:

```env
# ================================
# PRODUCTION CONFIGURATION
# ================================

# Network Configuration
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_COMMITMENT=confirmed

# Wallet (NEVER commit these values)
WALLET_PRIVATE_KEY=[your,array,from,secure,storage]
WALLET_PUBLIC_KEY=YourPublicKeyHere

# Trading Parameters - CONSERVATIVE SETTINGS FOR START
MAX_SLIPPAGE=0.005              # 0.5%
MAX_GAS_FEE=0.02                # 0.02 SOL
MIN_PROFIT_THRESHOLD=0.005      # 0.5%
MAX_POSITION_SIZE=500           # Start small: $500

# Flashloan Settings
MAX_FLASHLOAN_AMOUNT=10000      # Start conservative: $10k

# Liquidation Settings
MAX_CONCURRENT_LIQUIDATIONS=2   # Start with 2
LIQUIDATION_MIN_PROFIT=0.03     # 3% minimum (conservative)
PRIORITY_FEE_MULTIPLIER=3.0     # Competitive priority fees

# Strategy Toggles
ENABLE_LIQUIDATIONS=true        # Safest strategy
ENABLE_FLASHLOAN_ARBITRAGE=false  # Enable after testing
ENABLE_SANDWICH_ATTACKS=false   # Consider ethical implications

# Operational
NODE_ENV=production
LOG_LEVEL=info

# Monitoring (if implemented)
ENABLE_METRICS=true
METRICS_PORT=9090
HEALTH_CHECK_PORT=3000

# Alerting (configure your webhook)
ENABLE_ALERTS=true
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK
# Or Telegram: https://api.telegram.org/botYOUR_TOKEN/sendMessage?chat_id=YOUR_CHAT_ID
```

### 2.2 Build for Production

```bash
# Clean previous builds
rm -rf dist/

# Install dependencies (production only)
npm ci --only=production

# Build TypeScript
npm run build

# Verify build
ls -la dist/
node dist/index.js --version  # If version command implemented
```

---

## Phase 3: Devnet Testing

Before touching mainnet, thoroughly test on devnet.

### 3.1 Devnet Configuration

```bash
cp .env.devnet .env
```

Update `.env.devnet`:
```env
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
SOLANA_COMMITMENT=confirmed

# Use devnet wallet with test SOL
WALLET_PRIVATE_KEY=[devnet,test,wallet]
WALLET_PUBLIC_KEY=DevnetPublicKey

# More aggressive settings for testing
MIN_PROFIT_THRESHOLD=0.001  # Accept lower profits for testing
MAX_POSITION_SIZE=10000
```

### 3.2 Run Devnet Tests

```bash
# Terminal 1: Start the bot
npm run dev

# Terminal 2: Monitor logs
tail -f bot.log  # If logging to file

# Let it run for 48 hours minimum
# Monitor for:
# - Errors and crashes
# - Memory leaks (check with `top` or `htop`)
# - Execution success rate
# - Profit calculations
```

### 3.3 Devnet Validation Checklist

- [ ] Bot runs for 48+ hours without crashing
- [ ] All strategies execute without errors
- [ ] Profit calculations are accurate
- [ ] No memory leaks detected
- [ ] Gas fee estimates are reasonable
- [ ] Slippage protection works correctly
- [ ] Error recovery works properly
- [ ] Graceful shutdown on SIGINT/SIGTERM

---

## Phase 4: Deployment Options

### Option A: Simple Deployment (VPS/Local Server)

**1. Set up server:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2
```

**2. Deploy application:**
```bash
# Clone repository (or rsync files)
git clone https://github.com/becominggiantcollective/sol_bot.git
cd sol_bot

# Install and build
npm ci --only=production
npm run build

# Copy production environment file
cp .env.production .env

# Start with PM2
pm2 start dist/index.js --name solbot

# Configure PM2 to restart on boot
pm2 startup
pm2 save

# Monitor
pm2 logs solbot
pm2 monit
```

**3. Set up log rotation:**
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

### Option B: Docker Deployment (Recommended)

**1. Create Dockerfile:**

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built application
COPY dist ./dist

# Copy environment file (will be overridden by docker-compose)
COPY .env.production .env

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "console.log('healthy')" || exit 1

# Run the bot
CMD ["node", "dist/index.js"]
```

**2. Create docker-compose.yml:**

```yaml
version: '3.8'

services:
  solbot:
    build: .
    container_name: solana-arbitrage-bot
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    # Optional: metrics endpoint
    # ports:
    #   - "9090:9090"
```

**3. Deploy:**

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f solbot

# Stop
docker-compose down
```

### Option C: Kubernetes Deployment (Advanced)

For high-availability production deployment with multiple replicas, refer to `k8s/` directory (not included in basic setup).

---

## Phase 5: Initial Production Deployment

### 5.1 Pre-Launch Checklist

- [ ] All devnet tests passed
- [ ] Production wallet funded with minimal capital ($100-500)
- [ ] Production `.env` configured and secured
- [ ] Monitoring/alerting set up (even if basic)
- [ ] Emergency shutdown procedure documented
- [ ] Team notified and ready to monitor
- [ ] Backup and recovery plan in place

### 5.2 Launch Procedure

**Step 1: Final verification**
```bash
# Verify configuration
node -e "require('dotenv').config({path: '.env.production'}); console.log('RPC:', process.env.SOLANA_RPC_URL.substring(0, 40) + '...'); console.log('Wallet:', process.env.WALLET_PUBLIC_KEY);"

# Check wallet balance
solana balance YOUR_PUBLIC_KEY

# Verify RPC connectivity
curl -X POST YOUR_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

**Step 2: Start with liquidations only**
```env
# .env.production - Conservative start
ENABLE_LIQUIDATIONS=true
ENABLE_FLASHLOAN_ARBITRAGE=false
ENABLE_SANDWICH_ATTACKS=false
```

**Step 3: Launch**
```bash
# Using PM2
pm2 start dist/index.js --name solbot --env production

# Or Docker
docker-compose up -d

# Watch logs intensively for first hour
pm2 logs solbot --lines 100
# or
docker-compose logs -f
```

**Step 4: Monitor intensively (First 24 Hours)**

Watch for:
- Any errors or crashes
- Trade executions and results
- Profit/loss in real-time
- Wallet balance changes
- Gas fee consumption
- Network connectivity issues

**Critical: Set alarms for:**
- Next 1 hour: Check every 15 minutes
- Next 3 hours: Check every 30 minutes  
- Next 24 hours: Check every 2 hours
- After 24 hours: Check every 6-12 hours

### 5.3 First Trade Verification

When the first trade executes:

1. **Check Solana Explorer:**
   - Go to https://solscan.io
   - Search for your wallet address
   - Verify transaction details
   - Check actual profit vs. estimated

2. **Verify Profit Calculation:**
   ```
   Expected: [logged estimate]
   Actual: [from transaction]
   Difference: [calculate]
   
   If difference > 20%, investigate immediately
   ```

3. **Check for Errors:**
   - Failed transactions cost gas
   - High failure rate indicates problems
   - Success rate should be >60%

---

## Phase 6: Scaling Up

### 6.1 Performance Monitoring (Week 1)

Track these metrics daily:
```
Day 1:
- Trades attempted: X
- Trades successful: Y
- Success rate: Y/X = %
- Gross profit: $XXX
- Gas fees: $XX
- Net profit: $XXX
- Largest win: $XX
- Largest loss: $XX
- Wallet balance: $XXX
```

### 6.2 Gradual Scaling

**Week 1: Liquidations only, $100-500**
- Goal: Validate functionality
- Target: Break even or small profit
- Success criteria: Zero critical errors, >50% success rate

**Week 2-3: Add arbitrage, increase to $1,000-2,000**
```env
ENABLE_LIQUIDATIONS=true
ENABLE_FLASHLOAN_ARBITRAGE=true  # Enable!
MAX_POSITION_SIZE=1000
```

**Week 4+: Full deployment, scale to $5,000+**
```env
MAX_POSITION_SIZE=5000
MIN_PROFIT_THRESHOLD=0.003  # Can reduce threshold
PRIORITY_FEE_MULTIPLIER=4.0  # More aggressive
```

### 6.3 Optimization Based on Data

After 2 weeks of operation, analyze performance:

**If profit is consistently positive:**
- Increase capital allocation
- Reduce profit threshold slightly
- Increase priority fees for more wins

**If success rate is low (<40%):**
- Increase profit threshold (be more selective)
- Check if competition has increased
- Verify latency to Solana network
- Consider faster RPC endpoint

**If gas fees are eating profits:**
- Increase minimum profit threshold
- Optimize transaction construction
- Bundle multiple operations
- Use compute unit price optimization

---

## Phase 7: Ongoing Operations

### 7.1 Daily Monitoring Routine

**Morning Check (10 min):**
```bash
# Check bot status
pm2 list
# or
docker ps

# View today's summary
pm2 logs solbot --lines 100 | grep -E "profit|executed|failed"

# Check wallet balance
solana balance YOUR_PUBLIC_KEY

# Review alerts (if any)
```

**Evening Review (20 min):**
- Analyze daily P&L
- Review failed transactions
- Check for any errors
- Verify strategy performance
- Adjust parameters if needed

### 7.2 Weekly Maintenance

**Performance Review:**
- Calculate weekly ROI
- Compare to previous week
- Identify best-performing strategies
- Analyze worst-performing trades

**Configuration Updates:**
```bash
# Pull latest code (if updates available)
git pull origin main

# Review changes
git log --oneline -10

# If safe, rebuild
npm install
npm run build

# Restart with zero downtime
pm2 reload solbot
# or
docker-compose up -d --build
```

**Security:**
- Rotate API keys monthly
- Review access logs
- Check for unusual activity
- Update dependencies

### 7.3 Emergency Procedures

**If bot is losing money rapidly:**
```bash
# Immediate shutdown
pm2 stop solbot
# or
docker-compose down

# Check logs for cause
pm2 logs solbot --lines 500

# Check wallet balance
solana balance YOUR_PUBLIC_KEY

# Investigate before restarting
```

**If bot crashes repeatedly:**
```bash
# Check error logs
pm2 logs solbot --err --lines 100

# Common issues:
# - RPC rate limiting: Switch to paid tier
# - Memory leak: Restart with more RAM
# - Network issues: Check RPC endpoint
# - Wallet drained: Fund wallet
```

**Emergency Contacts:**
- Solana Discord: https://discord.gg/solana
- RPC Provider Support: [your provider]
- Development Team: [your contact]

---

## Phase 8: Advanced Optimizations

Once stable and profitable (Month 2+):

### 8.1 Speed Improvements

**Implement WebSocket Subscriptions:**
- Real-time block updates
- Reduce detection latency from 2s to <100ms

**Add Yellowstone gRPC:**
- Ultra-low latency updates
- Competitive advantage
- Requires Rust module integration

### 8.2 Strategy Enhancements

**Dynamic Priority Fees:**
```typescript
const priorityFee = opportunity.profitPercent > 0.05 
  ? baseFee * 5  // Aggressive for high-profit
  : baseFee * 2; // Standard for normal
```

**Position Sizing:**
```typescript
const positionSize = Math.min(
  opportunity.liquidity * 0.1,  // 10% of liquidity
  calculateRiskAdjustedSize(opportunity),
  config.maxPositionSize
);
```

**Machine Learning:**
- Log all opportunities and outcomes
- Train model to predict success probability
- Optimize parameter selection

### 8.3 Infrastructure Scaling

**High Availability:**
- Multiple bot instances
- Leader election for single-execution strategies
- Shared state management

**Geographic Distribution:**
- Deploy closer to Solana validators
- Reduce network latency
- Consider multiple regions

---

## Troubleshooting

### Common Issues and Solutions

**Issue: High failure rate (>60% failures)**
- Check RPC latency: `curl -w "@curl-format.txt" -o /dev/null -s YOUR_RPC_URL`
- Increase profit threshold (more selective)
- Verify slippage settings
- Check if MEV competition increased

**Issue: No opportunities detected**
- Verify RPC connectivity
- Check if token list is correct
- Verify DEX integrations are working
- Check market volatility (low vol = fewer opps)

**Issue: Profitable opportunities but not executing**
- Check wallet balance (out of SOL?)
- Verify gas fee limits not too low
- Check if priority fees are competitive
- Look for transaction simulation failures

**Issue: Bot consuming too much gas**
- Failed transactions still cost gas
- Increase profit threshold
- Improve opportunity filtering
- Optimize transaction construction

**Issue: RPC rate limiting**
- Upgrade to paid RPC tier
- Implement request caching
- Add rate limiting to bot
- Use multiple RPC endpoints

---

## Success Metrics

### Key Performance Indicators (KPIs)

**Profitability:**
- Daily/weekly/monthly P&L
- ROI percentage
- Profit factor (gross profit / gross loss)
- Sharpe ratio

**Execution:**
- Success rate (>60% target)
- Average execution time (<500ms target)
- Trades per day
- Capital efficiency

**Risk:**
- Maximum drawdown (<10% target)
- Consecutive losses (stop if >10)
- Daily loss limit compliance
- Position size adherence

**Operational:**
- Uptime percentage (>99% target)
- Error rate (<5% target)
- RPC latency (<100ms target)
- Gas fee efficiency

---

## Conclusion

Deploying a MEV bot to production requires careful planning, conservative initial parameters, and intensive monitoring. Start small, scale gradually, and continuously optimize based on real performance data.

**Key Principles:**
1. **Start Conservative:** Small capital, limited strategies, high thresholds
2. **Monitor Intensively:** Especially first 48 hours
3. **Scale Gradually:** Only increase after consistent profitability
4. **Preserve Capital:** Better to miss opportunities than take losses
5. **Continuous Improvement:** Optimize based on data, not hunches

**Remember:** The goal is sustainable, long-term profitability, not quick gains. Build slowly, manage risk carefully, and the profits will follow.

---

## Additional Resources

- **Solana Documentation:** https://docs.solana.com
- **Jupiter Aggregator:** https://docs.jup.ag
- **MEV on Solana:** https://www.jito.wtf/
- **Bot Security Best Practices:** [Add link]
- **Community Support:** [Add Discord/Telegram]

---

**Document Version:** 1.0  
**Last Updated:** October 14, 2025  
**Maintained By:** Development Team  
**Next Review:** [Schedule quarterly reviews]
