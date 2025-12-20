# VPS Deployment Guide - Hetzner CAX11

## Quick Setup (30 minutes)

### 1. Create Hetzner Account & VPS

1. Go to https://www.hetzner.com/cloud
2. Create account
3. Create new project: "solana-bot"
4. Create server:
   - **Location:** Ashburn, VA (US East - closest to Solana validators)
   - **Image:** Ubuntu 22.04 LTS
   - **Type:** CAX11 (2 vCPU ARM, 4GB RAM) - €4.51/month
   - **SSH Key:** Add your public key (generate with `ssh-keygen` if needed)
   - **Name:** solana-arb-bot

5. Wait for server creation (~1 minute)
6. Note the IP address

### 2. Initial Server Setup

```bash
# SSH into server (replace with your IP)
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install build tools for Rust
apt install -y build-essential pkg-config libssl-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Verify installations
node --version  # Should be v20.x
npm --version
cargo --version
```

### 3. Deploy Bot Code

```bash
# Create dedicated user (better security than running as root)
adduser solbot --disabled-password --gecos ""
usermod -aG sudo solbot
su - solbot

# Clone repository (or upload via scp/rsync)
# Option A: If using git
git clone https://github.com/becominggiantcollective/sol_bot.git
cd sol_bot

# Option B: Upload from local machine (run on your LOCAL machine)
# rsync -avz --exclude 'node_modules' --exclude 'target' /home/technocalypse/sol_bot/ solbot@YOUR_SERVER_IP:~/sol_bot/

# Install dependencies
npm install

# Build TypeScript
npm run build

# Build Rust modules
cargo build --release --lib --features napi
cp target/release/libsol_bot.so native/sol_bot.node
```

### 4. Configure Environment

```bash
# Create .env file
nano .env
```

Add this configuration:
```bash
# Alchemy RPC (replace with your API key)
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY

# Trading Configuration
DRY_RUN=true
LIVE_TRADING=false
USE_DEVNET=false

# Wallet (IMPORTANT: Use dedicated trading wallet, not main wallet)
WALLET_PRIVATE_KEY=YOUR_BASE58_PRIVATE_KEY_HERE
WALLET_PUBLIC_KEY=YOUR_PUBLIC_KEY_HERE

# Profit Thresholds (optimized for Rust low-fee routing)
MIN_PROFIT_THRESHOLD=0.0025

# Telegram Alerts (optional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Other settings
MAX_SLIPPAGE=0.005
MAX_GAS_FEE=0.02
```

Save with `Ctrl+X`, `Y`, `Enter`

### 5. Install PM2 Process Manager

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start bot with PM2
pm2 start npm --name "solana-arb-bot" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the command it outputs (will be specific to your system)

# Monitor bot
pm2 logs solana-arb-bot

# Check status
pm2 status
```

### 6. Security Hardening

```bash
# Setup firewall
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Disable root SSH login (after confirming solbot user works)
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd

# Regular security updates (auto)
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### 7. Monitoring & Maintenance

```bash
# View live logs
pm2 logs solana-arb-bot --lines 100

# Restart bot
pm2 restart solana-arb-bot

# Stop bot
pm2 stop solana-arb-bot

# Monitor system resources
htop

# Check disk space
df -h

# Check memory usage
free -h
```

## Automated Deployment Script

Create `deploy-to-vps.sh` on your LOCAL machine:

```bash
#!/bin/bash
# Deploy to VPS - Run from LOCAL machine

VPS_IP="YOUR_SERVER_IP"
VPS_USER="solbot"

echo "🚀 Deploying to VPS: $VPS_IP"

# Sync code (exclude large files)
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'target' \
  --exclude 'dist' \
  --exclude '.git' \
  ./ ${VPS_USER}@${VPS_IP}:~/sol_bot/

# Run build on VPS
ssh ${VPS_USER}@${VPS_IP} << 'EOF'
cd ~/sol_bot
npm install
npm run build
cargo build --release --lib --features napi
cp target/release/libsol_bot.so native/sol_bot.node
pm2 restart solana-arb-bot || pm2 start npm --name "solana-arb-bot" -- start
pm2 save
EOF

echo "✅ Deployment complete!"
echo "📊 View logs: ssh ${VPS_USER}@${VPS_IP} 'pm2 logs solana-arb-bot'"
```

Make executable: `chmod +x deploy-to-vps.sh`

## Cost Estimate

| Item | Cost/Month | Notes |
|------|------------|-------|
| Hetzner CAX11 VPS | €4.51 (~$5) | 2 vCPU, 4GB RAM |
| Alchemy RPC | $20-50 | Pay-as-you-go, ~300 req/sec |
| **Total** | **$25-55** | **Very affordable for 24/7 operation** |

## Performance Benefits

| Metric | Local | VPS (US East) | Improvement |
|--------|-------|---------------|-------------|
| **Latency to validators** | 100-200ms | 10-30ms | 3-6x faster |
| **Uptime** | Intermittent | 99%+ | Always running |
| **Network** | Home ISP | Datacenter | More stable |
| **Bandwidth** | Variable | Consistent | Better for high-frequency |

## Troubleshooting

### Bot won't start
```bash
# Check logs
pm2 logs solana-arb-bot --lines 50

# Common issues:
# 1. Missing .env file
ls -la .env

# 2. Rust module not built
ls -la native/sol_bot.node

# 3. Node modules not installed
npm install
```

### High memory usage
```bash
# Monitor memory
pm2 monit

# Restart if needed
pm2 restart solana-arb-bot
```

### RPC rate limiting
```bash
# Check if hitting Alchemy limits
grep "rate limit" ~/.pm2/logs/solana-arb-bot-error.log

# Solution: Upgrade Alchemy plan or reduce scan frequency
```

## Backup & Recovery

```bash
# Backup wallet keys (IMPORTANT!)
# Copy .env to secure local storage
scp solbot@YOUR_SERVER_IP:~/sol_bot/.env ./backups/.env.$(date +%Y%m%d)

# Backup profit data
scp -r solbot@YOUR_SERVER_IP:~/sol_bot/logs ./backups/logs.$(date +%Y%m%d)

# Full system snapshot (Hetzner)
# Go to Hetzner Cloud Console → Snapshots → Create Snapshot
```

## Next Steps

1. ✅ Deploy to VPS
2. ✅ Configure with Alchemy RPC
3. ⏳ Run real market backtest: `npm run backtest:real`
4. ⏳ Monitor for 24-48 hours in DRY_RUN mode
5. ⏳ Fund wallet with 2-5 SOL
6. ⏳ Enable live trading gradually

---

*Setup time: ~30 minutes*  
*Cost: ~$5/month for VPS + pay-as-you-go Alchemy*  
*Benefit: 24/7 operation, 3-6x lower latency*
