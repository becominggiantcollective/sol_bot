#!/bin/bash
# Deploy Solana Bot to VPS
# Run this from your LOCAL machine
#
# Required environment variables:
#   VPS_IP    - IP address of the target VPS (e.g. export VPS_IP=1.2.3.4)
#   VPS_USER  - SSH user on the VPS (defaults to 'deploy', NOT 'root')
#
# Example:
#   VPS_IP=1.2.3.4 VPS_USER=deploy ./deploy-to-vps.sh

if [ -z "${VPS_IP}" ]; then
    echo "❌ VPS_IP environment variable is not set."
    echo "   Usage: VPS_IP=<your-server-ip> VPS_USER=<user> ./deploy-to-vps.sh"
    exit 1
fi

VPS_USER="${VPS_USER:-deploy}"   # Default to non-root 'deploy' user
REMOTE_DIR="sol_bot"

echo "🚀 Deploying Solana Arbitrage Bot to VPS"
echo "========================================"
echo "VPS IP: $VPS_IP (user: $VPS_USER)"
echo ""

# Check if we can connect
echo "📡 Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 "${VPS_USER}@${VPS_IP}" "echo 'Connection successful'" 2>/dev/null; then
    echo "❌ Cannot connect to VPS. Please check:"
    echo "   1. VPS is running"
    echo "   2. SSH is enabled"
    echo "   3. IP address is correct: $VPS_IP"
    echo "   4. Try manually: ssh ${VPS_USER}@${VPS_IP}"
    exit 1
fi

echo "✅ SSH connection successful!"
echo ""

# Sync code to VPS
echo "📦 Syncing code to VPS..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'target' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '*.log' \
  ./ "${VPS_USER}@${VPS_IP}:~/${REMOTE_DIR}/"

if [ $? -ne 0 ]; then
    echo "❌ Failed to sync files"
    exit 1
fi

echo "✅ Files synced successfully!"
echo ""

# Install dependencies and build on VPS
echo "🔧 Installing dependencies on VPS..."
ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
cd ~/sol_bot

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    apt install -y build-essential pkg-config libssl-dev
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Install npm dependencies
echo "📦 Installing npm packages..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Build Rust modules
echo "🦀 Building Rust modules..."
source $HOME/.cargo/env
cargo build --release --lib --features napi
cp target/release/libsol_bot.so native/sol_bot.node

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "📥 Installing PM2..."
    npm install -g pm2
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  WARNING: .env file not found on VPS!"
    echo "   The deployment will complete, but you'll need to configure .env"
else
    echo "✅ .env file found"
fi

echo ""
echo "✅ VPS setup complete!"
echo ""
echo "📊 Versions installed:"
node --version
npm --version
cargo --version
pm2 --version

ENDSSH

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🎯 Next Steps:"
echo ""
echo "1. SSH into your VPS:"
echo "   ssh ${VPS_USER}@${VPS_IP}"
echo ""
echo "2. Start the bot:"
echo "   cd ~/sol_bot"
echo "   pm2 start npm --name 'solana-arb-bot' -- start"
echo "   pm2 save"
echo "   pm2 startup  # Follow the command it outputs"
echo ""
echo "3. Monitor logs:"
echo "   pm2 logs solana-arb-bot"
echo ""
echo "4. Check status:"
echo "   pm2 status"
echo ""
echo "🔗 Quick SSH: ssh ${VPS_USER}@${VPS_IP}"
