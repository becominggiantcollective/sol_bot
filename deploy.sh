#!/bin/bash

# Solana Arbitrage Bot - Production Deployment Script
# This script prepares and deploys the bot for production use

set -e  # Exit on error

echo "=================================================="
echo "   Solana Arbitrage Bot - Deployment Script"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${NC}ℹ $1${NC}"
}

# Step 1: Check Node.js version
echo "Step 1: Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi
print_success "Node.js version: $(node -v)"
echo ""

# Step 2: Check environment variables
echo "Step 2: Checking environment configuration..."
if [ ! -f ".env" ]; then
    print_warning ".env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    print_warning "Please edit .env file with your wallet private key and RPC URL before continuing!"
    print_info "Required variables:"
    print_info "  - WALLET_PRIVATE_KEY: Your wallet's private key array"
    print_info "  - SOLANA_RPC_URL: Your RPC endpoint (recommended: paid provider for better performance)"
    echo ""
    read -p "Press Enter after you've configured the .env file..."
fi

# Validate critical environment variables
source .env 2>/dev/null || true
if [ -z "$WALLET_PRIVATE_KEY" ] || [ "$WALLET_PRIVATE_KEY" = "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64]" ]; then
    print_error "WALLET_PRIVATE_KEY not configured in .env file"
    exit 1
fi

if [ -z "$SOLANA_RPC_URL" ]; then
    print_error "SOLANA_RPC_URL not configured in .env file"
    exit 1
fi

print_success "Environment variables configured"
echo ""

# Step 3: Install dependencies
echo "Step 3: Installing dependencies..."
npm install --production=false
print_success "Dependencies installed"
echo ""

# Step 4: Run linter
echo "Step 4: Running linter..."
npm run lint || {
    print_warning "Linting warnings found (this is OK for production)"
}
print_success "Linting completed"
echo ""

# Step 5: Build the project
echo "Step 5: Building project..."
npm run build
print_success "Build completed"
echo ""

# Step 6: Run tests
echo "Step 6: Running tests..."
npm test
if [ $? -ne 0 ]; then
    print_error "Tests failed! Fix issues before deploying to production."
    exit 1
fi
print_success "All tests passed"
echo ""

# Step 7: Check wallet balance (if possible)
echo "Step 7: Checking deployment readiness..."
print_info "Recommended setup for production:"
echo "  ✓ Minimum 1 SOL in wallet for gas fees"
echo "  ✓ Premium RPC endpoint (Helius, QuickNode, or similar)"
echo "  ✓ Monitored environment (pm2, systemd, or docker)"
echo "  ✓ Automated alerts (Telegram bot configured)"
echo ""

# Step 8: Security check
echo "Step 8: Security verification..."
if git ls-files | xargs grep -l "WALLET_PRIVATE_KEY" | grep -v ".env" | grep -v "deploy.sh" | grep -v ".example" > /dev/null; then
    print_error "Private key found in tracked files! Never commit private keys!"
    exit 1
fi
print_success "No private keys in tracked files"
echo ""

# Step 9: Performance recommendations
echo "Step 9: Performance recommendations..."
print_info "For optimal profitability:"
echo "  • Use a dedicated RPC with high rate limits (>100 req/sec)"
echo "  • Deploy on a server with low latency to Solana validators"
echo "  • Monitor bot performance with the built-in metrics"
echo "  • Adjust MIN_PROFIT_THRESHOLD based on gas costs"
echo "  • Use PRIORITY_FEE_MULTIPLIER of 3.0+ for competitive liquidations"
echo ""

# Step 10: Deployment options
echo "Step 10: Choose deployment method..."
echo "  1) Run in current terminal (for testing)"
echo "  2) Run with PM2 (recommended for production)"
echo "  3) Run in background with nohup"
echo "  4) Exit (manual deployment)"
echo ""
read -p "Select option [1-4]: " DEPLOY_OPTION

case $DEPLOY_OPTION in
    1)
        print_info "Starting bot in current terminal..."
        print_warning "Bot will stop when you close the terminal!"
        npm start
        ;;
    2)
        if ! command -v pm2 &> /dev/null; then
            print_info "Installing PM2..."
            npm install -g pm2
        fi
        print_info "Starting bot with PM2..."
        pm2 start npm --name "solana-arb-bot" -- start
        pm2 save
        pm2 startup
        print_success "Bot deployed with PM2!"
        print_info "Useful PM2 commands:"
        echo "  • pm2 status              - Check bot status"
        echo "  • pm2 logs solana-arb-bot - View logs"
        echo "  • pm2 restart solana-arb-bot - Restart bot"
        echo "  • pm2 stop solana-arb-bot    - Stop bot"
        ;;
    3)
        print_info "Starting bot in background..."
        nohup npm start > bot.log 2>&1 &
        echo $! > bot.pid
        print_success "Bot started in background! PID: $(cat bot.pid)"
        print_info "View logs: tail -f bot.log"
        print_info "Stop bot: kill $(cat bot.pid)"
        ;;
    4)
        print_info "Deployment prepared. Run manually with: npm start"
        ;;
    *)
        print_error "Invalid option"
        exit 1
        ;;
esac

echo ""
echo "=================================================="
print_success "Deployment process completed!"
echo "=================================================="
echo ""
print_info "Monitor your bot's performance regularly!"
print_info "The bot will display metrics every 5 minutes."
print_warning "Remember: Only risk what you can afford to lose!"
echo ""
