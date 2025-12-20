#!/bin/bash

echo "=== Checking VPS Bot Status ==="
echo ""

echo "1. PM2 Status:"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 status"

echo ""
echo "2. Flash Loan Fee (last 50 lines):"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 logs solana-arb-bot --lines 50 --nostream" 2>&1 | grep -i "solend fee"

echo ""
echo "3. Rust Router Activity (last 50 lines):"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 logs solana-arb-bot --lines 50 --nostream" 2>&1 | grep -E "(⚡|Rust|low-fee)"

echo ""
echo "4. Fee Breakdown (last 50 lines):"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 logs solana-arb-bot --lines 50 --nostream" 2>&1 | grep -i "fee breakdown"

echo ""
echo "5. Opportunities Found (last 50 lines):"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 logs solana-arb-bot --lines 50 --nostream" 2>&1 | grep -E "(profit|spread|opportunity)" | tail -20

echo ""
echo "6. Latest Log Entries:"
ssh -o StrictHostKeyChecking=no root@83.229.86.150 "pm2 logs solana-arb-bot --lines 30 --nostream" 2>&1 | tail -30
