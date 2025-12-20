/**
 * CrossDEXArbitrageDetector Test Script
 * Tests the multi-DEX triangular arbitrage detection
 */

import axios from 'axios';

// =============================================================================
// CONFIGURATION
// =============================================================================

const JUPITER_API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';

// Token addresses
const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

// Decimals per token
const DECIMALS = {
  [TOKENS.SOL]: 9,
  [TOKENS.USDC]: 6,
  [TOKENS.USDT]: 6,
  [TOKENS.BONK]: 5,
  [TOKENS.RAY]: 6,
  [TOKENS.JUP]: 6,
};

// =============================================================================
// HELPERS
// =============================================================================

function toRaw(amount, mint) {
  const decimals = DECIMALS[mint];
  if (decimals === undefined) throw new Error(`Unknown token: ${mint}`);
  return Math.floor(amount * Math.pow(10, decimals));
}

function toHuman(rawAmount, mint) {
  const decimals = DECIMALS[mint];
  if (decimals === undefined) throw new Error(`Unknown token: ${mint}`);
  return rawAmount / Math.pow(10, decimals);
}

function getSymbol(mint) {
  for (const [sym, addr] of Object.entries(TOKENS)) {
    if (addr === mint) return sym;
  }
  return mint.slice(0, 8) + '...';
}

// Rate limiter
let lastRequest = 0;
const MIN_DELAY_MS = 200; // 5 requests per second max

async function rateLimitedRequest() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequest;
  if (timeSinceLastRequest < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest));
  }
  lastRequest = Date.now();
}

// =============================================================================
// MULTI-DEX QUOTE FETCHING
// =============================================================================

async function getJupiterQuote(inputMint, outputMint, amountRaw) {
  await rateLimitedRequest();
  
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountRaw.toString(),
      slippageBps: '50', // 0.5% slippage
    });
    
    const response = await axios.get(`https://api.jup.ag/swap/v1/quote?${params}`, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });
    
    if (!response.data || !response.data.outAmount) {
      return null;
    }
    
    const priceImpactPct = parseFloat(response.data.priceImpactPct || '0');
    
    return {
      dex: 'Jupiter',
      inputMint,
      outputMint,
      inAmount: parseInt(response.data.inAmount),
      outAmount: parseInt(response.data.outAmount),
      priceImpactPct,
      routeInfo: response.data.routePlan || [],
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`  Jupiter quote error: ${err.message}`);
    return null;
  }
}

// Try to get direct Raydium quote
async function getRaydiumQuote(inputMint, outputMint, amountRaw) {
  await rateLimitedRequest();
  
  try {
    // Raydium API v2
    const response = await axios.get('https://api.raydium.io/v2/swap/compute', {
      params: {
        inputMint,
        outputMint,
        amount: amountRaw,
        slippage: 0.5,
      },
      timeout: 5000,
    });
    
    if (response.data && response.data.outAmount) {
      return {
        dex: 'Raydium',
        inputMint,
        outputMint,
        inAmount: amountRaw,
        outAmount: parseInt(response.data.outAmount),
        priceImpactPct: parseFloat(response.data.priceImpact || '0') * 100,
        timestamp: Date.now(),
      };
    }
  } catch (err) {
    // Raydium API often fails for many pairs
    // console.log(`  Raydium not available: ${err.message}`);
  }
  
  return null;
}

// Get best quote across DEXes
async function getBestQuote(inputMint, outputMint, amountRaw) {
  const quotes = await Promise.all([
    getJupiterQuote(inputMint, outputMint, amountRaw),
    getRaydiumQuote(inputMint, outputMint, amountRaw),
  ]);
  
  const validQuotes = quotes.filter(q => q !== null);
  if (validQuotes.length === 0) return null;
  
  // Return best output amount
  return validQuotes.reduce((best, q) => 
    q.outAmount > best.outAmount ? q : best
  );
}

// =============================================================================
// TRIANGULAR ARBITRAGE DETECTION
// =============================================================================

async function checkTriangularPath(tokenA, tokenB, tokenC, inputAmount) {
  const symbolA = getSymbol(tokenA);
  const symbolB = getSymbol(tokenB);
  const symbolC = getSymbol(tokenC);
  
  console.log(`\n  Checking: ${symbolA} → ${symbolB} → ${symbolC} → ${symbolA}`);
  console.log(`  Input: ${inputAmount} ${symbolA}`);
  
  const inputRaw = toRaw(inputAmount, tokenA);
  
  // Leg 1: A → B
  const quote1 = await getBestQuote(tokenA, tokenB, inputRaw);
  if (!quote1) {
    console.log(`    ❌ No quote for ${symbolA} → ${symbolB}`);
    return null;
  }
  
  const outputB = toHuman(quote1.outAmount, tokenB);
  console.log(`    Leg 1 (${quote1.dex}): ${inputAmount} ${symbolA} → ${outputB.toFixed(6)} ${symbolB}`);
  
  // Leg 2: B → C
  const quote2 = await getBestQuote(tokenB, tokenC, quote1.outAmount);
  if (!quote2) {
    console.log(`    ❌ No quote for ${symbolB} → ${symbolC}`);
    return null;
  }
  
  const outputC = toHuman(quote2.outAmount, tokenC);
  console.log(`    Leg 2 (${quote2.dex}): ${outputB.toFixed(6)} ${symbolB} → ${outputC.toFixed(6)} ${symbolC}`);
  
  // Leg 3: C → A
  const quote3 = await getBestQuote(tokenC, tokenA, quote2.outAmount);
  if (!quote3) {
    console.log(`    ❌ No quote for ${symbolC} → ${symbolA}`);
    return null;
  }
  
  const outputA = toHuman(quote3.outAmount, tokenA);
  console.log(`    Leg 3 (${quote3.dex}): ${outputC.toFixed(6)} ${symbolC} → ${outputA.toFixed(6)} ${symbolA}`);
  
  // Calculate profit
  const grossProfit = outputA - inputAmount;
  const grossProfitPct = (grossProfit / inputAmount) * 100;
  
  // Gas costs (estimate 3 swaps + priority fee)
  const gasCostSOL = 0.000115; // ~115k lamports
  let gasCostInInputToken = gasCostSOL;
  if (tokenA !== TOKENS.SOL) {
    // Convert gas cost to input token
    const gasQuote = await getJupiterQuote(TOKENS.SOL, tokenA, toRaw(gasCostSOL, TOKENS.SOL));
    if (gasQuote) {
      gasCostInInputToken = toHuman(gasQuote.outAmount, tokenA);
    }
  }
  
  // Flash loan fee (0.3% Solend)
  const flashLoanFee = inputAmount * 0.003;
  
  // Net profit calculations
  const netProfitNoFL = grossProfit - gasCostInInputToken;
  const netProfitWithFL = grossProfit - gasCostInInputToken - flashLoanFee;
  
  const netProfitNoPct = (netProfitNoFL / inputAmount) * 100;
  const netProfitWithFLPct = (netProfitWithFL / inputAmount) * 100;
  
  console.log(`\n    📊 Results:`);
  console.log(`    Input:       ${inputAmount.toFixed(6)} ${symbolA}`);
  console.log(`    Output:      ${outputA.toFixed(6)} ${symbolA}`);
  console.log(`    Gross:       ${grossProfit >= 0 ? '+' : ''}${grossProfit.toFixed(6)} ${symbolA} (${grossProfitPct >= 0 ? '+' : ''}${grossProfitPct.toFixed(4)}%)`);
  console.log(`    Gas cost:    -${gasCostInInputToken.toFixed(6)} ${symbolA}`);
  console.log(`    FL fee:      -${flashLoanFee.toFixed(6)} ${symbolA} (0.3%)`);
  console.log(`    Net (no FL): ${netProfitNoFL >= 0 ? '+' : ''}${netProfitNoFL.toFixed(6)} ${symbolA} (${netProfitNoPct >= 0 ? '+' : ''}${netProfitNoPct.toFixed(4)}%)`);
  console.log(`    Net (w/ FL): ${netProfitWithFL >= 0 ? '+' : ''}${netProfitWithFL.toFixed(6)} ${symbolA} (${netProfitWithFLPct >= 0 ? '+' : ''}${netProfitWithFLPct.toFixed(4)}%)`);
  
  const profitable = netProfitNoPct > 0.1; // > 0.1% threshold
  console.log(`    Profitable:  ${profitable ? '✅ YES' : '❌ NO'}`);
  
  return {
    path: [tokenA, tokenB, tokenC, tokenA],
    pathSymbols: [symbolA, symbolB, symbolC, symbolA],
    quotes: [quote1, quote2, quote3],
    inputAmount,
    outputAmount: outputA,
    grossProfit,
    grossProfitPct,
    gasCost: gasCostInInputToken,
    flashLoanFee,
    netProfitNoFL,
    netProfitWithFL,
    netProfitPct: netProfitNoPct,
    profitable,
  };
}

// =============================================================================
// MAIN TEST
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('CROSS-DEX TRIANGULAR ARBITRAGE DETECTOR TEST');
  console.log('='.repeat(80));
  console.log(`\nTimestamp: ${new Date().toISOString()}`);
  console.log(`DEXes: Jupiter (aggregator), Raydium (direct)`);
  console.log(`Min Profit Threshold: 0.1%`);
  
  // Test paths
  const paths = [
    { tokenA: TOKENS.SOL, tokenB: TOKENS.USDC, tokenC: TOKENS.USDT, amount: 1 },
    { tokenA: TOKENS.SOL, tokenB: TOKENS.USDC, tokenC: TOKENS.BONK, amount: 1 },
    { tokenA: TOKENS.SOL, tokenB: TOKENS.USDC, tokenC: TOKENS.RAY, amount: 1 },
    { tokenA: TOKENS.SOL, tokenB: TOKENS.RAY, tokenC: TOKENS.USDC, amount: 1 },
    { tokenA: TOKENS.SOL, tokenB: TOKENS.JUP, tokenC: TOKENS.USDC, amount: 1 },
    { tokenA: TOKENS.USDC, tokenB: TOKENS.SOL, tokenC: TOKENS.BONK, amount: 10 },
  ];
  
  const results = [];
  
  for (const { tokenA, tokenB, tokenC, amount } of paths) {
    try {
      const result = await checkTriangularPath(tokenA, tokenB, tokenC, amount);
      if (result) results.push(result);
    } catch (err) {
      console.log(`\n  ❌ Error: ${err.message}`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  const profitable = results.filter(r => r.profitable);
  
  console.log(`\nTotal paths checked: ${results.length}`);
  console.log(`Profitable paths: ${profitable.length}`);
  
  if (profitable.length > 0) {
    console.log('\n✅ PROFITABLE OPPORTUNITIES:');
    for (const opp of profitable) {
      console.log(`  ${opp.pathSymbols.join(' → ')}: +${opp.netProfitPct.toFixed(4)}%`);
    }
  } else {
    console.log('\n❌ No profitable opportunities found.');
    console.log('This is expected - markets are highly efficient.');
    console.log('Professional MEV bots use:');
    console.log('  • Private mempools and block builders');
    console.log('  • Sub-millisecond latency');
    console.log('  • Larger capital to capture tiny spreads');
    console.log('  • Backrunning techniques');
  }
  
  // Best opportunity (even if not profitable)
  if (results.length > 0) {
    const best = results.reduce((a, b) => a.netProfitPct > b.netProfitPct ? a : b);
    console.log(`\nBest opportunity: ${best.pathSymbols.join(' → ')}`);
    console.log(`  Net profit: ${best.netProfitPct >= 0 ? '+' : ''}${best.netProfitPct.toFixed(4)}%`);
    if (best.netProfitPct < 0) {
      console.log(`  Would need ${(-best.netProfitPct).toFixed(4)}% improvement to break even`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
