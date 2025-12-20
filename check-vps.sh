#!/bin/bash
# Check VPS Jupiter connectivity and bot logs

VPS_IP="83.229.86.150"

echo "🔍 Checking VPS Status"
echo "======================"
echo ""

echo "1️⃣ Testing Jupiter API access from VPS..."
ssh root@${VPS_IP} "curl -s https://quote-api.jup.ag/v6/health" && echo "✅ Jupiter API accessible" || echo "❌ Jupiter API blocked"

echo ""
echo "2️⃣ Checking if bot is running..."
ssh root@${VPS_IP} "pm2 status"

echo ""
echo "3️⃣ Recent bot logs (last 30 lines)..."
ssh root@${VPS_IP} "pm2 logs solana-arb-bot --lines 30 --nostream"

echo ""
echo "4️⃣ Checking for Jupiter errors..."
ssh root@${VPS_IP} "pm2 logs solana-arb-bot --lines 100 --nostream | grep -i jupiter || echo 'No Jupiter errors found'"

echo ""
echo "5️⃣ Checking .env configuration..."
ssh root@${VPS_IP} "cd ~/sol_bot && echo 'ALCHEMY_RPC_URL:' && grep '^ALCHEMY_RPC_URL' .env | cut -c1-60"
