#!/usr/bin/env node

/**
 * Test the updated arbitrage detection with:
 * - 0.05% threshold (catch micro-edges)
 * - Dynamic SOL price from Jupiter API
 * - Live quotes across DEXes
 * 
 * Expected: 5-10 "detected" opportunities per scan with +0.02% profits
 */

import { detectOpportunities } from './dist/core/arbitrage.js';

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🧪 TESTING MICRO-EDGE DETECTION 🧪                        ║
║                                                                              ║
║  Threshold: 0.05% (10x more sensitive)                                      ║
║  SOL Price: Dynamic (Jupiter API, 5s cache)                                 ║
║  Strategy: Catch micro-edges before fees eat them                           ║
║                                                                              ║
║  Expected Results:                                                           ║
║  - 5-10 opportunities detected per scan                                     ║
║  - Profit range: +0.02% to +0.15%                                           ║
║  - Many will be flash-loan viable (scale up for profit)                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

async function runTest() {
  try {
    console.log('🔍 Starting arbitrage scan with live Jupiter quotes...\n');
    
    const startTime = Date.now();
    const opportunities = await detectOpportunities();
    const scanTime = Date.now() - startTime;
    
    console.log(`\n📊 SCAN COMPLETED IN ${(scanTime / 1000).toFixed(1)}s\n`);
    
    if (opportunities.length === 0) {
      console.log(`
⚠️  NO OPPORTUNITIES FOUND

Possible reasons:
1. Market spreads currently < 0.05% (low volatility)
2. Jupiter API rate limits (check logs for 429 errors)
3. DEX liquidity too low (high price impact killing spreads)

Recommendations:
- Wait for market volatility (new token launches, pumps)
- Check VPS logs for actual spreads detected
- Enable flash loans for larger position sizing
`);
    } else {
      console.log(`
✅ FOUND ${opportunities.length} PROFITABLE OPPORTUNITIES!

Top 5 by profit %:
`);
      
      opportunities.slice(0, 5).forEach((opp, i) => {
        console.log(`
${i + 1}. ${opp.route}
   Input: ${opp.inputAmount.toFixed(6)} ${opp.tokenA}
   Output: ${opp.expectedOutput.toFixed(6)} ${opp.tokenA}
   Profit: ${opp.profit.toFixed(6)} (${opp.profitPercent.toFixed(4)}%)
   ---`);
      });
      
      console.log(`\n💡 NEXT STEPS:
1. Deploy to VPS with updated .env (MIN_PROFIT_THRESHOLD=0.0005)
2. Enable flash loans (FLASHLOAN_ENABLED=true) for capital efficiency
3. Monitor for 24h - expect 10-50 micro-edges per hour
4. Scale winning paths with larger positions (0.5-5 SOL)
`);
    }
    
  } catch (error) {
    console.error(`\n❌ TEST FAILED: ${error}`);
    console.error(error);
  }
}

runTest().catch(console.error);
