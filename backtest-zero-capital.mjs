#!/usr/bin/env node
/**
 * 📊 BACKTEST - Zero-Capital MEV Strategy
 * 
 * This tests the strategy against REAL current market conditions
 * by making actual API calls to Jupiter and checking for opportunities.
 * 
 * NOT a historical backtest (that would require historical price data),
 * but a LIVE SIMULATION showing what the bot would find right now.
 */

import fetch from 'node-fetch';

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const LAMPORTS = 1_000_000_000;
const SOL_PRICE = 230;

// Config (same as bot)
const CONFIG = {
  flashLoanFeePercent: 0.01,  // Mango
  maxFlashloanSOL: 10,
  triangularMinProfit: 0.08,
  crossDexMinProfit: 0.06,
  gasEstimateSOL: 0.002,
};

// Tokens
const TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', decimals: 9 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', decimals: 9 },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'jitoSOL', decimals: 9 },
];

const TRIANGULAR_PATHS = [
  ['SOL', 'USDC', 'BONK'],
  ['SOL', 'USDC', 'JUP'],
  ['SOL', 'USDC', 'WIF'],
  ['SOL', 'USDC', 'POPCAT'],
  ['SOL', 'USDT', 'BONK'],
  ['SOL', 'USDT', 'JUP'],
  ['SOL', 'mSOL', 'USDC'],
  ['SOL', 'jitoSOL', 'USDC'],
  ['SOL', 'jitoSOL', 'mSOL'],
  ['USDC', 'SOL', 'mSOL'],
  ['USDC', 'BONK', 'SOL'],
  ['USDC', 'JUP', 'SOL'],
];

function getMint(symbol) {
  return TOKENS.find(t => t.symbol === symbol)?.mint;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getQuote(inputMint, outputMint, amount) {
  try {
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`,
      { headers: { 'x-api-key': JUPITER_API_KEY } }
    );
    const data = await res.json();
    return data.outAmount ? parseInt(data.outAmount) : null;
  } catch {
    return null;
  }
}

// Results storage
const results = {
  triangular: [],
  crossDex: [],
  summary: {
    totalScanned: 0,
    profitableFound: 0,
    bestOpportunity: null,
    worstLoss: null,
  }
};

console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║            📊 BACKTEST - Zero-Capital MEV Strategy 📊                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  This tests REAL current market conditions via Jupiter API                   ║
║  Flash Loan: 10 SOL (Mango 0.01% fee)                                        ║
║  Gas Estimate: 0.002 SOL                                                     ║
║                                                                               ║
║  Running live simulation...                                                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

// === TEST 1: TRIANGULAR ARBITRAGE ===
async function testTriangular() {
  console.log('\n🔺 TRIANGULAR ARBITRAGE BACKTEST');
  console.log('━'.repeat(70));
  console.log(`Testing ${TRIANGULAR_PATHS.length} paths with ${CONFIG.maxFlashloanSOL} SOL flash loan...\n`);

  for (const [tokenA, tokenB, tokenC] of TRIANGULAR_PATHS) {
    const mintA = getMint(tokenA);
    const mintB = getMint(tokenB);
    const mintC = getMint(tokenC);
    
    if (!mintA || !mintB || !mintC) continue;
    
    // Start amount
    let startAmount;
    if (tokenA === 'SOL') {
      startAmount = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
    } else if (tokenA === 'USDC' || tokenA === 'USDT') {
      startAmount = Math.floor(CONFIG.maxFlashloanSOL * SOL_PRICE * 1000000);
    } else continue;
    
    process.stdout.write(`  ${tokenA} → ${tokenB} → ${tokenC} → ${tokenA}: `);
    
    // Get quotes
    const out1 = await getQuote(mintA, mintB, startAmount);
    if (!out1) { console.log('❌ Quote failed'); continue; }
    
    const out2 = await getQuote(mintB, mintC, out1);
    if (!out2) { console.log('❌ Quote failed'); continue; }
    
    const out3 = await getQuote(mintC, mintA, out2);
    if (!out3) { console.log('❌ Quote failed'); continue; }
    
    // Calculate
    const grossProfit = out3 - startAmount;
    const grossPct = (grossProfit / startAmount) * 100;
    
    // Costs
    const flashFee = startAmount * (CONFIG.flashLoanFeePercent / 100);
    const gasCost = CONFIG.gasEstimateSOL * LAMPORTS;
    const totalCost = flashFee + gasCost;
    
    const netProfit = grossProfit - totalCost;
    const netPct = (netProfit / startAmount) * 100;
    
    results.triangular.push({
      path: `${tokenA}→${tokenB}→${tokenC}→${tokenA}`,
      grossPct,
      netPct,
      netProfitSOL: tokenA === 'SOL' ? netProfit / LAMPORTS : netProfit / 1000000 / SOL_PRICE,
      profitable: netPct >= CONFIG.triangularMinProfit
    });
    
    results.summary.totalScanned++;
    
    if (netPct >= CONFIG.triangularMinProfit) {
      results.summary.profitableFound++;
      console.log(`✅ NET +${netPct.toFixed(4)}% ($${((netProfit / LAMPORTS) * SOL_PRICE).toFixed(2)})`);
      
      if (!results.summary.bestOpportunity || netPct > results.summary.bestOpportunity.netPct) {
        results.summary.bestOpportunity = { path: `${tokenA}→${tokenB}→${tokenC}`, netPct, type: 'triangular' };
      }
    } else if (netPct > -0.1) {
      console.log(`⚠️ NET ${netPct.toFixed(4)}% (close but not profitable)`);
    } else {
      console.log(`❌ NET ${netPct.toFixed(4)}%`);
      
      if (!results.summary.worstLoss || netPct < results.summary.worstLoss.netPct) {
        results.summary.worstLoss = { path: `${tokenA}→${tokenB}→${tokenC}`, netPct, type: 'triangular' };
      }
    }
    
    await sleep(300); // Rate limit
  }
}

// === TEST 2: CROSS-DEX ARBITRAGE ===
async function testCrossDex() {
  console.log('\n\n🔄 CROSS-DEX ARBITRAGE BACKTEST');
  console.log('━'.repeat(70));
  console.log(`Testing round-trip SOL → Token → SOL with ${CONFIG.maxFlashloanSOL} SOL...\n`);

  for (const token of TOKENS) {
    if (token.mint === SOL_MINT) continue;
    
    process.stdout.write(`  SOL → ${token.symbol} → SOL: `);
    
    const startAmount = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
    
    // Buy
    const buyAmount = await getQuote(SOL_MINT, token.mint, startAmount);
    if (!buyAmount) { console.log('❌ Quote failed'); continue; }
    
    // Sell back
    const sellAmount = await getQuote(token.mint, SOL_MINT, buyAmount);
    if (!sellAmount) { console.log('❌ Quote failed'); continue; }
    
    // Calculate
    const grossProfit = sellAmount - startAmount;
    const grossPct = (grossProfit / startAmount) * 100;
    
    const flashFee = startAmount * (CONFIG.flashLoanFeePercent / 100);
    const gasCost = CONFIG.gasEstimateSOL * LAMPORTS;
    const totalCost = flashFee + gasCost;
    
    const netProfit = grossProfit - totalCost;
    const netPct = (netProfit / startAmount) * 100;
    
    results.crossDex.push({
      token: token.symbol,
      grossPct,
      netPct,
      netProfitSOL: netProfit / LAMPORTS,
      profitable: netPct >= CONFIG.crossDexMinProfit
    });
    
    results.summary.totalScanned++;
    
    if (netPct >= CONFIG.crossDexMinProfit) {
      results.summary.profitableFound++;
      console.log(`✅ NET +${netPct.toFixed(4)}% ($${((netProfit / LAMPORTS) * SOL_PRICE).toFixed(2)})`);
      
      if (!results.summary.bestOpportunity || netPct > results.summary.bestOpportunity.netPct) {
        results.summary.bestOpportunity = { path: `SOL→${token.symbol}→SOL`, netPct, type: 'crossDex' };
      }
    } else if (netPct > -0.1) {
      console.log(`⚠️ NET ${netPct.toFixed(4)}% (close)`);
    } else {
      console.log(`❌ NET ${netPct.toFixed(4)}%`);
      
      if (!results.summary.worstLoss || netPct < results.summary.worstLoss.netPct) {
        results.summary.worstLoss = { path: `SOL→${token.symbol}→SOL`, netPct, type: 'crossDex' };
      }
    }
    
    await sleep(300);
  }
}

// === FINAL REPORT ===
function generateReport() {
  console.log(`

╔═══════════════════════════════════════════════════════════════════════════════╗
║                         📊 BACKTEST RESULTS 📊                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣`);

  console.log(`║                                                                               ║`);
  console.log(`║  SCAN SUMMARY:                                                                ║`);
  console.log(`║  • Total paths scanned: ${results.summary.totalScanned}                                                 `);
  console.log(`║  • Profitable opportunities: ${results.summary.profitableFound}                                           `);
  console.log(`║  • Success rate: ${((results.summary.profitableFound / results.summary.totalScanned) * 100).toFixed(1)}%                                                     `);
  
  if (results.summary.bestOpportunity) {
    console.log(`║                                                                               ║`);
    console.log(`║  🏆 BEST OPPORTUNITY:                                                         ║`);
    console.log(`║  • Path: ${results.summary.bestOpportunity.path.padEnd(30)}                         `);
    console.log(`║  • Net Profit: +${results.summary.bestOpportunity.netPct.toFixed(4)}%                                              `);
    console.log(`║  • Per 10 SOL: ~$${(results.summary.bestOpportunity.netPct * 0.01 * 10 * SOL_PRICE).toFixed(2)}                                               `);
  }
  
  if (results.summary.worstLoss) {
    console.log(`║                                                                               ║`);
    console.log(`║  📉 WORST LOSS (avoided):                                                     ║`);
    console.log(`║  • Path: ${results.summary.worstLoss.path.padEnd(30)}                         `);
    console.log(`║  • Net Loss: ${results.summary.worstLoss.netPct.toFixed(4)}%                                               `);
  }
  
  // Triangular breakdown
  console.log(`║                                                                               ║`);
  console.log(`║  🔺 TRIANGULAR RESULTS:                                                        ║`);
  const triProfit = results.triangular.filter(r => r.profitable).length;
  const triClose = results.triangular.filter(r => !r.profitable && r.netPct > -0.1).length;
  console.log(`║  • Profitable: ${triProfit} | Close: ${triClose} | Loss: ${results.triangular.length - triProfit - triClose}                                `);
  
  // Cross-DEX breakdown
  console.log(`║                                                                               ║`);
  console.log(`║  🔄 CROSS-DEX RESULTS:                                                         ║`);
  const cdProfit = results.crossDex.filter(r => r.profitable).length;
  const cdClose = results.crossDex.filter(r => !r.profitable && r.netPct > -0.1).length;
  console.log(`║  • Profitable: ${cdProfit} | Close: ${cdClose} | Loss: ${results.crossDex.length - cdProfit - cdClose}                                    `);
  
  console.log(`║                                                                               ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║                         📝 HONEST ASSESSMENT 📝                               ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════════════════════╣`);
  
  if (results.summary.profitableFound > 0) {
    console.log(`║                                                                               ║`);
    console.log(`║  ✅ GOOD NEWS: Found ${results.summary.profitableFound} profitable opportunities right now!                  `);
    console.log(`║                                                                               ║`);
    console.log(`║  However, keep in mind:                                                      ║`);
    console.log(`║  • These opportunities may last only milliseconds                            ║`);
    console.log(`║  • Professional bots with faster infra will compete                          ║`);
    console.log(`║  • Network congestion can cause slippage > expected                          ║`);
    console.log(`║                                                                               ║`);
    console.log(`║  RECOMMENDATION: Run the bot and monitor. Expect ~1-5 trades/day            ║`);
  } else {
    console.log(`║                                                                               ║`);
    console.log(`║  ⚠️ NO OPPORTUNITIES: This is NORMAL in efficient markets                    ║`);
    console.log(`║                                                                               ║`);
    console.log(`║  Why this happens:                                                           ║`);
    console.log(`║  • Jupiter already optimizes routes (minimal price gaps)                    ║`);
    console.log(`║  • Pro MEV bots capture opportunities in <100ms                             ║`);
    console.log(`║  • Markets are more efficient during low-volatility periods                 ║`);
    console.log(`║                                                                               ║`);
    console.log(`║  RECOMMENDATION: Run bot during high volatility (news, launches)            ║`);
    console.log(`║  Opportunities appear when markets are chaotic, not calm.                   ║`);
  }
  
  console.log(`║                                                                               ║`);
  console.log(`║  🦀 RUST CONSIDERATION:                                                        ║`);
  console.log(`║  • Current JS bot: ~50-200ms per opportunity check                           ║`);
  console.log(`║  • Rust bot could: ~5-20ms per check (10x faster)                            ║`);
  console.log(`║  • Worth it IF: You find opportunities but lose to faster bots               ║`);
  console.log(`║                                                                               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════════╝
`);
}

// === RUN BACKTEST ===
async function main() {
  const startTime = Date.now();
  
  await testTriangular();
  await testCrossDex();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️ Backtest completed in ${duration} seconds`);
  
  generateReport();
}

main().catch(console.error);
