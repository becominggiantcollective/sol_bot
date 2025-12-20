#!/bin/bash
# BIRDEYE SNIPER QUICK START

echo "═══════════════════════════════════════════════════════════"
echo "🛡️ BIRDEYE-POWERED SAFE SNIPER - QUICK START"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "This bot will NEVER buy a token it can't sell!"
echo "It uses Birdeye API to test SELL capability before every buy."
echo ""
echo "📋 Pre-Flight Checks:"
echo ""

# Check if Birdeye API is working
echo "1️⃣ Testing Birdeye API connection..."
node -e "
fetch('https://public-api.birdeye.so/defi/v1/token/trending?sort_by=rank&sort_type=asc&offset=0&limit=1', {
  headers: { 'X-API-KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NjJkZmRlLTI2OTEtNDkwYy1hOGMwLWMzZjI4NmE4ZDJkZiIsImlhdCI6MTczNDM3NDU2NSwiZXhwIjoxNzM2OTY2NTY1fQ.VdZZPwR2pjH3xLZc8yHdxQQVPFzQHJXgEtZvPXRZxjU' }
}).then(r => r.json()).then(d => {
  if (d.success) {
    console.log('   ✅ Birdeye API is working');
  } else {
    console.log('   ❌ Birdeye API error:', d.message || 'Unknown error');
    process.exit(1);
  }
}).catch(e => {
  console.log('   ❌ Connection error:', e.message);
  process.exit(1);
});
" || exit 1

echo ""
echo "2️⃣ Checking wallet balance..."
node check-wallet.mjs 2>/dev/null | grep "Balance" || echo "   ⚠️ Run: node check-wallet.mjs"

echo ""
echo "3️⃣ Checking dependencies..."
if node -e "import('node-fetch')" 2>/dev/null; then
  echo "   ✅ node-fetch installed"
else
  echo "   ❌ Missing node-fetch - run: npm install"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "🚀 READY TO START"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Start the bot with:"
echo "  node sniper-birdeye.mjs"
echo ""
echo "Or test a specific token first:"
echo "  node pre-buy-simulator.mjs <TOKEN_MINT>"
echo ""
echo "View activity logs:"
echo "  tail -f sniper-birdeye.log"
echo "  node view-activity.mjs"
echo ""
echo "Check current positions:"
echo "  cat positions-birdeye.json | jq"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "⚠️ SAFETY FEATURES:"
echo "═══════════════════════════════════════════════════════════"
echo "✅ Pre-buy Birdeye simulation (tests if you can sell)"
echo "✅ Contract analysis (checks for freeze authority)"
echo "✅ Auto-removes honeypots after 2 failed sells"
echo "✅ Permanent avoid list (never buys same honeypot twice)"
echo "✅ Hard stop loss at -7%"
echo "✅ Trailing stop at -5% from peak"
echo "✅ Max hold time: 5 minutes"
echo "✅ Activity logging to sniper-birdeye.log"
echo "═══════════════════════════════════════════════════════════"
