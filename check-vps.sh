#!/bin/bash
# Check VPS Jupiter connectivity and bot logs
# Usage: VPS_IP=<ip> VPS_USER=<user> ./check-vps.sh

VPS_IP="${VPS_IP:?VPS_IP environment variable is required}"
VPS_USER="${VPS_USER:-deploy}"

echo "🔍 Checking VPS Status"
echo "======================"
echo ""

echo "1️⃣ Testing Jupiter API access from VPS..."
ssh "${VPS_USER}@${VPS_IP}" "curl -s https://quote-api.jup.ag/v6/health" && echo "✅ Jupiter API accessible" || echo "❌ Jupiter API blocked"

echo ""
echo "2️⃣ Checking if bot is running..."
ssh "${VPS_USER}@${VPS_IP}" "pm2 status"

echo ""
echo "3️⃣ Recent bot logs (last 30 lines)..."
ssh "${VPS_USER}@${VPS_IP}" "pm2 logs solana-arb-bot --lines 30 --nostream"

echo ""
echo "4️⃣ Checking for Jupiter errors..."
ssh "${VPS_USER}@${VPS_IP}" "pm2 logs solana-arb-bot --lines 100 --nostream | grep -i jupiter || echo 'No Jupiter errors found'"

echo ""
echo "5️⃣ Checking .env configuration..."
ssh "${VPS_USER}@${VPS_IP}" "cd ~/sol_bot && echo 'ALCHEMY_RPC_URL:' && grep '^ALCHEMY_RPC_URL' .env | cut -c1-60"
