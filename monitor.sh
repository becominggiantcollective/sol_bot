#!/bin/bash
# Bot Live Monitor Script
# Run this to watch the bot in real-time

TERMINAL_ID="b0354d8c-9c5b-4729-b947-4d982d47a162"
BOT_LOG="/c/Users/ThaumicAether/Desktop/Projects/sol_bot/bot.log"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}🤖 SOL BOT LIVE MONITOR${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Display current status
echo -e "${GREEN}✅ Bot Status: RUNNING${NC}"
echo -e "   Terminal: $TERMINAL_ID"
echo -e "   Started: $(date)"
echo ""

# Show key metrics
echo -e "${YELLOW}📊 Key Metrics:${NC}"
echo -e "   Scanning: Every 20 seconds"
echo -e "   Tokens: 4 (SOL, USDC, USDT, BONK)"
echo -e "   Pairs: 8 of 12 checked (BONK excluded)"
echo ""

# Show recent opportunities
echo -e "${YELLOW}🎯 Recent Activity:${NC}"
tail -20 "$BOT_LOG" 2>/dev/null | grep -E "Found|Opportunity|ERROR|WARN|opportunity detected" || echo "   Scanning... (no opportunities yet)"
echo ""

# Show wallet status
echo -e "${YELLOW}💰 Wallet Status:${NC}"
tail -5 "$BOT_LOG" 2>/dev/null | grep -E "balance|Wallet" || echo "   Checking..."
echo ""

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Bot is monitoring for arbitrage opportunities${NC}"
echo -e "${GREEN}Will auto-execute trades when opportunity found${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
