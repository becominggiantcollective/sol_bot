// MULTI-DEX ANALYZER & AGGREGATOR
// Compares prices across Jupiter, Orca, Raydium, and other DEXes
// Finds best execution routes and arbitrage opportunities

import fetch from 'node-fetch';
import fs from 'fs';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  jupiterApi: 'https://api.jup.ag/swap/v1',
  jupiterKey: process.env.JUPITER_API_KEY,
  heliusRpc: process.env.HELIUS_RPC_URL,
  
  // Token mints
  tokens: {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  },
  
  // Test amounts in lamports/smallest unit
  testAmounts: {
    small: 100000000,    // 0.1 SOL
    medium: 1000000000,  // 1 SOL
    large: 10000000000,  // 10 SOL
  },
  
  solPrice: 230,
};

// Known DEX labels (Jupiter routes through these)
const DEX_INFO = {
  'Raydium': { type: 'AMM', fee: 0.25 },
  'Raydium CLMM': { type: 'CLMM', fee: 0.01 },
  'Orca': { type: 'AMM', fee: 0.30 },
  'Orca (Whirlpools)': { type: 'CLMM', fee: 0.01 },
  'Whirlpool': { type: 'CLMM', fee: 0.01 },
  'Meteora': { type: 'AMM', fee: 0.20 },
  'Meteora DLMM': { type: 'DLMM', fee: 0.15 },
  'Phoenix': { type: 'CLOB', fee: 0.05 },
  'Lifinity': { type: 'AMM', fee: 0.20 },
  'Aldrin': { type: 'AMM', fee: 0.30 },
  'Cropper': { type: 'AMM', fee: 0.25 },
  'Saber': { type: 'Stable', fee: 0.04 },
  'Mercurial': { type: 'Stable', fee: 0.04 },
  'GooseFX': { type: 'AMM', fee: 0.30 },
  'Serum': { type: 'CLOB', fee: 0.05 },
  'OpenBook': { type: 'CLOB', fee: 0.05 },
  'Pump.fun': { type: 'Bonding', fee: 1.00 },
  'Moonshot': { type: 'Bonding', fee: 1.00 },
  'FluxBeam': { type: 'AMM', fee: 0.25 },
  'Obric': { type: 'AMM', fee: 0.25 },
  'SolFi': { type: 'AMM', fee: 0.30 },
  'Sanctum': { type: 'LST', fee: 0.10 },
  'Stabble': { type: 'Stable', fee: 0.05 },
  'Helium': { type: 'AMM', fee: 0.30 },
  'GoonFi': { type: 'AMM', fee: 0.25 },
  'HumidiFi': { type: 'AMM', fee: 0.25 },
  'AlphaQ': { type: 'AMM', fee: 0.10 },
  '01': { type: 'Perp', fee: 0.10 },
  'Drift': { type: 'Perp', fee: 0.10 },
  'Zeta': { type: 'Perp', fee: 0.10 },
  'Mango': { type: 'Perp', fee: 0.10 },
};

// ============================================
// JUPITER MULTI-ROUTE ANALYZER
// ============================================
async function getJupiterQuote(inputMint, outputMint, amount, options = {}) {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: options.slippage || 50,
    });
    
    // Request multiple routes
    if (options.onlyDirectRoutes) params.append('onlyDirectRoutes', 'true');
    if (options.maxAccounts) params.append('maxAccounts', options.maxAccounts);
    
    const res = await fetch(`${CONFIG.jupiterApi}/quote?${params}`, {
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.jupiterKey 
      },
      timeout: 10000,
    });
    
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('Jupiter quote error:', e.message);
    return null;
  }
}

// Get quotes with different route constraints
async function getMultipleJupiterRoutes(inputMint, outputMint, amount) {
  const routes = [];
  
  // Standard quote (best route)
  const bestRoute = await getJupiterQuote(inputMint, outputMint, amount);
  if (bestRoute) {
    routes.push({
      type: 'best',
      quote: bestRoute,
      dexes: bestRoute.routePlan?.map(r => r.swapInfo?.label) || [],
    });
  }
  
  // Direct routes only (single hop)
  const directRoute = await getJupiterQuote(inputMint, outputMint, amount, { onlyDirectRoutes: true });
  if (directRoute) {
    routes.push({
      type: 'direct',
      quote: directRoute,
      dexes: directRoute.routePlan?.map(r => r.swapInfo?.label) || [],
    });
  }
  
  // Limited accounts (simpler routes)
  const simpleRoute = await getJupiterQuote(inputMint, outputMint, amount, { maxAccounts: 20 });
  if (simpleRoute) {
    routes.push({
      type: 'simple',
      quote: simpleRoute,
      dexes: simpleRoute.routePlan?.map(r => r.swapInfo?.label) || [],
    });
  }
  
  return routes;
}

// ============================================
// DEX POOL SCANNER (via DexScreener)
// ============================================
async function scanDexScreenerPools(tokenMint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    
    if (!res.ok) return [];
    const data = await res.json();
    
    // Group by DEX
    const byDex = {};
    for (const pair of (data.pairs || [])) {
      if (pair.chainId !== 'solana') continue;
      
      const dex = pair.dexId;
      if (!byDex[dex]) {
        byDex[dex] = [];
      }
      byDex[dex].push({
        pairAddress: pair.pairAddress,
        baseToken: pair.baseToken?.symbol,
        quoteToken: pair.quoteToken?.symbol,
        price: parseFloat(pair.priceUsd) || 0,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
      });
    }
    
    return byDex;
  } catch (e) {
    console.error('DexScreener error:', e.message);
    return {};
  }
}

// ============================================
// CROSS-DEX PRICE COMPARISON
// ============================================
async function comparePricesAcrossDexes(tokenSymbol, tokenMint) {
  console.log(`\n📊 Analyzing ${tokenSymbol} across DEXes...`);
  
  const pools = await scanDexScreenerPools(tokenMint);
  const dexes = Object.keys(pools);
  
  if (dexes.length === 0) {
    console.log('   No pools found');
    return null;
  }
  
  console.log(`   Found pools on ${dexes.length} DEXes: ${dexes.join(', ')}`);
  
  // Find best price on each DEX
  const dexPrices = [];
  for (const [dex, dexPools] of Object.entries(pools)) {
    // Find pool with highest liquidity
    const bestPool = dexPools.sort((a, b) => b.liquidity - a.liquidity)[0];
    if (bestPool && bestPool.price > 0) {
      dexPrices.push({
        dex,
        price: bestPool.price,
        liquidity: bestPool.liquidity,
        volume24h: bestPool.volume24h,
        pair: `${bestPool.baseToken}/${bestPool.quoteToken}`,
        poolCount: dexPools.length,
      });
    }
  }
  
  // Sort by price
  dexPrices.sort((a, b) => b.price - a.price);
  
  if (dexPrices.length < 2) {
    console.log('   Not enough DEXes for comparison');
    return null;
  }
  
  // Calculate spread
  const highest = dexPrices[0];
  const lowest = dexPrices[dexPrices.length - 1];
  const spread = ((highest.price - lowest.price) / lowest.price) * 100;
  
  return {
    token: tokenSymbol,
    dexPrices,
    spread,
    highest,
    lowest,
    arbOpportunity: spread > 0.5, // >0.5% spread might be arb opportunity
  };
}

// ============================================
// ARBITRAGE FINDER
// ============================================
async function findArbOpportunities(tokens = ['SOL', 'JUP', 'RAY', 'BONK', 'WIF']) {
  console.log('\n🔍 Scanning for arbitrage opportunities...\n');
  
  const opportunities = [];
  
  for (const symbol of tokens) {
    const mint = CONFIG.tokens[symbol];
    if (!mint) continue;
    
    const comparison = await comparePricesAcrossDexes(symbol, mint);
    if (!comparison) continue;
    
    // Print results
    console.log(`\n   ${symbol} Price Analysis:`);
    console.log('   ─'.repeat(30));
    
    for (const dp of comparison.dexPrices.slice(0, 5)) {
      const info = DEX_INFO[dp.dex] || { type: 'Unknown', fee: 0.25 };
      console.log(`   ${dp.dex.padEnd(20)} $${dp.price.toFixed(6)} | Liq: $${(dp.liquidity/1000).toFixed(0)}K | ${info.type}`);
    }
    
    console.log(`   ─`.repeat(30));
    console.log(`   Spread: ${comparison.spread.toFixed(3)}%`);
    
    if (comparison.arbOpportunity) {
      console.log(`   🚨 POTENTIAL ARB: Buy on ${comparison.lowest.dex}, Sell on ${comparison.highest.dex}`);
      opportunities.push(comparison);
    }
    
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }
  
  return opportunities;
}

// ============================================
// JUPITER ROUTE ANALYSIS
// ============================================
async function analyzeJupiterRoutes(inputSymbol, outputSymbol, amountUSD) {
  const inputMint = CONFIG.tokens[inputSymbol];
  const outputMint = CONFIG.tokens[outputSymbol];
  
  if (!inputMint || !outputMint) {
    console.log('Unknown token');
    return;
  }
  
  // Calculate amount in smallest units
  let amount;
  if (inputSymbol === 'SOL') {
    amount = Math.floor((amountUSD / CONFIG.solPrice) * 1e9);
  } else if (inputSymbol === 'USDC' || inputSymbol === 'USDT') {
    amount = Math.floor(amountUSD * 1e6);
  } else {
    amount = Math.floor(amountUSD * 1e6); // Default 6 decimals
  }
  
  console.log(`\n📈 Jupiter Route Analysis: $${amountUSD} ${inputSymbol} → ${outputSymbol}`);
  console.log('═'.repeat(60));
  
  const routes = await getMultipleJupiterRoutes(inputMint, outputMint, amount);
  
  for (const route of routes) {
    const quote = route.quote;
    const outAmount = parseInt(quote.outAmount || 0);
    const priceImpact = parseFloat(quote.priceImpactPct || 0);
    
    // Calculate output value
    let outputUSD;
    if (outputSymbol === 'SOL') {
      outputUSD = (outAmount / 1e9) * CONFIG.solPrice;
    } else if (outputSymbol === 'USDC' || outputSymbol === 'USDT') {
      outputUSD = outAmount / 1e6;
    } else {
      outputUSD = outAmount / 1e6; // Estimate
    }
    
    console.log(`\n   Route Type: ${route.type.toUpperCase()}`);
    console.log(`   DEXes Used: ${route.dexes.join(' → ')}`);
    console.log(`   Output: ${outAmount} (≈$${outputUSD.toFixed(2)})`);
    console.log(`   Price Impact: ${(priceImpact * 100).toFixed(4)}%`);
    console.log(`   Hops: ${route.dexes.length}`);
    
    // DEX breakdown
    if (quote.routePlan) {
      console.log(`   Route Details:`);
      for (const step of quote.routePlan) {
        const info = step.swapInfo;
        const dexInfo = DEX_INFO[info.label] || { type: '?', fee: 0 };
        console.log(`      ${info.label} (${dexInfo.type}): ${info.inAmount} → ${info.outAmount}`);
      }
    }
  }
  
  return routes;
}

// ============================================
// MULTI-DEX QUOTE COMPARISON
// ============================================
async function compareAggregatorQuotes(amountUSD = 100) {
  console.log('\n🏦 MULTI-DEX AGGREGATOR COMPARISON');
  console.log('═'.repeat(60));
  console.log(`   Testing with $${amountUSD} worth of trades\n`);
  
  const testPairs = [
    { from: 'SOL', to: 'USDC' },
    { from: 'SOL', to: 'USDT' },
    { from: 'USDC', to: 'SOL' },
  ];
  
  for (const pair of testPairs) {
    console.log(`\n📊 ${pair.from} → ${pair.to}:`);
    console.log('─'.repeat(40));
    
    const routes = await analyzeJupiterRoutes(pair.from, pair.to, amountUSD);
    
    if (routes && routes.length > 0) {
      // Find all unique DEXes used
      const allDexes = new Set();
      for (const route of routes) {
        route.dexes.forEach(d => allDexes.add(d));
      }
      console.log(`\n   DEXes discovered: ${Array.from(allDexes).join(', ')}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
}

// ============================================
// DEX LIQUIDITY SCANNER
// ============================================
async function scanDexLiquidity() {
  console.log('\n💧 DEX LIQUIDITY SCANNER');
  console.log('═'.repeat(60));
  
  const tokens = ['SOL', 'JUP', 'RAY', 'WIF', 'BONK'];
  const dexLiquidity = {};
  
  for (const symbol of tokens) {
    const mint = CONFIG.tokens[symbol];
    if (!mint) continue;
    
    const pools = await scanDexScreenerPools(mint);
    
    for (const [dex, dexPools] of Object.entries(pools)) {
      if (!dexLiquidity[dex]) {
        dexLiquidity[dex] = { totalLiquidity: 0, poolCount: 0, tokens: [] };
      }
      
      const dexTotal = dexPools.reduce((sum, p) => sum + (p.liquidity || 0), 0);
      dexLiquidity[dex].totalLiquidity += dexTotal;
      dexLiquidity[dex].poolCount += dexPools.length;
      dexLiquidity[dex].tokens.push(symbol);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Sort by total liquidity
  const sorted = Object.entries(dexLiquidity)
    .sort((a, b) => b[1].totalLiquidity - a[1].totalLiquidity);
  
  console.log('\n   DEX                  Total Liquidity    Pools   Tokens');
  console.log('   ' + '─'.repeat(55));
  
  for (const [dex, data] of sorted.slice(0, 15)) {
    const liq = data.totalLiquidity >= 1e9 
      ? `$${(data.totalLiquidity / 1e9).toFixed(2)}B`
      : data.totalLiquidity >= 1e6
        ? `$${(data.totalLiquidity / 1e6).toFixed(2)}M`
        : `$${(data.totalLiquidity / 1e3).toFixed(2)}K`;
    
    console.log(`   ${dex.padEnd(22)} ${liq.padEnd(18)} ${String(data.poolCount).padEnd(7)} ${data.tokens.join(',')}`);
  }
  
  return dexLiquidity;
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('═'.repeat(60));
  console.log('🔄 MULTI-DEX ANALYZER');
  console.log('═'.repeat(60));
  console.log('   Supported DEXes: Raydium, Orca, Meteora, Phoenix, Lifinity,');
  console.log('   Aldrin, OpenBook, Pump.fun, and 20+ more via Jupiter');
  console.log('═'.repeat(60));
  
  // 1. Scan DEX liquidity
  await scanDexLiquidity();
  
  // 2. Compare aggregator quotes
  await compareAggregatorQuotes(100);
  
  // 3. Find arbitrage opportunities
  const arbs = await findArbOpportunities(['SOL', 'JUP', 'RAY', 'BONK', 'WIF']);
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Arbitrage opportunities found: ${arbs.length}`);
  
  if (arbs.length > 0) {
    console.log('\n   Best opportunities:');
    for (const arb of arbs.slice(0, 3)) {
      console.log(`   • ${arb.token}: ${arb.spread.toFixed(2)}% spread (${arb.lowest.dex} → ${arb.highest.dex})`);
    }
  }
  
  console.log('\n   💡 Note: Jupiter already aggregates most DEXes.');
  console.log('   For best execution, Jupiter routes through the optimal path.');
  console.log('   Direct DEX integration is mainly useful for:');
  console.log('   - Lower latency (skip aggregator)');
  console.log('   - Specific pool targeting');
  console.log('   - MEV strategies');
}

// Run
main().catch(console.error);
