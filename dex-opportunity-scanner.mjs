// COMPREHENSIVE DEX OPPORTUNITY SCANNER
// Deep analysis of arbitrage and trading opportunities across all Solana DEXes

import fetch from 'node-fetch';

const CONFIG = {
  jupiterApi: 'https://api.jup.ag/swap/v1',
  jupiterKey: process.env.JUPITER_API_KEY,
  heliusRpc: process.env.HELIUS_RPC_URL,
  
  // Test tokens for analysis
  testTokens: [
    { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
    { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
    { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6 },
    { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
    { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6 },
    { symbol: 'ORCA', mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6 },
    { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9 },
    { symbol: 'jitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9 },
  ],
  
  testAmounts: [100, 1000, 10000, 50000], // USD
  solPrice: 230,
};

// DEX tracking
const dexData = {
  byName: {},
  routes: [],
  opportunities: [],
  triangular: [],
};

// ============================================
// JUPITER QUOTE WITH DEX BREAKDOWN
// ============================================
async function getJupiterQuoteWithDexInfo(inputMint, outputMint, amount, inputDecimals = 9) {
  try {
    const amountSmallest = Math.floor(amount * Math.pow(10, inputDecimals));
    
    const res = await fetch(`${CONFIG.jupiterApi}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountSmallest}&slippageBps=50`, {
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.jupiterKey 
      },
      timeout: 10000,
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    
    // Extract DEX info
    const dexes = [];
    for (const step of (data.routePlan || [])) {
      const info = step.swapInfo || {};
      dexes.push({
        name: info.label || 'Unknown',
        ammKey: info.ammKey,
        inputMint: info.inputMint,
        outputMint: info.outputMint,
        inAmount: parseInt(info.inAmount || 0),
        outAmount: parseInt(info.outAmount || 0),
        feeAmount: parseInt(info.feeAmount || 0),
      });
    }
    
    return {
      inputAmount: amount,
      outputAmount: parseInt(data.outAmount || 0),
      priceImpact: parseFloat(data.priceImpactPct || 0),
      dexes,
      hops: dexes.length,
      route: dexes.map(d => d.name).join(' → '),
    };
  } catch (e) {
    return null;
  }
}

// ============================================
// SCAN DEX POOLS VIA DEXSCREENER
// ============================================
async function scanTokenPools(tokenMint, tokenSymbol) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    
    if (!res.ok) return {};
    const data = await res.json();
    
    const byDex = {};
    for (const pair of (data.pairs || [])) {
      if (pair.chainId !== 'solana') continue;
      
      const dex = pair.dexId;
      if (!byDex[dex]) byDex[dex] = [];
      
      byDex[dex].push({
        pairAddress: pair.pairAddress,
        baseSymbol: pair.baseToken?.symbol,
        quoteSymbol: pair.quoteToken?.symbol,
        price: parseFloat(pair.priceUsd) || 0,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24 || 0,
        volume1h: pair.volume?.h1 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        priceChange1h: pair.priceChange?.h1 || 0,
        txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
        buySellRatio: pair.txns?.h24?.buys && pair.txns?.h24?.sells 
          ? (pair.txns.h24.buys / pair.txns.h24.sells).toFixed(2) : '1.00',
      });
    }
    
    return byDex;
  } catch (e) {
    return {};
  }
}

// ============================================
// FIND ARBITRAGE OPPORTUNITIES
// ============================================
async function findArbOpportunities(tokenSymbol, tokenMint) {
  const pools = await scanTokenPools(tokenMint, tokenSymbol);
  const dexes = Object.keys(pools);
  
  if (dexes.length < 2) return [];
  
  const opportunities = [];
  
  // Get best price on each DEX
  const dexPrices = [];
  for (const [dex, dexPools] of Object.entries(pools)) {
    const bestPool = dexPools.sort((a, b) => b.liquidity - a.liquidity)[0];
    if (bestPool && bestPool.price > 0 && bestPool.liquidity > 1000) {
      dexPrices.push({
        dex,
        price: bestPool.price,
        liquidity: bestPool.liquidity,
        volume24h: bestPool.volume24h,
        pair: `${bestPool.baseSymbol}/${bestPool.quoteSymbol}`,
      });
    }
  }
  
  // Find spreads
  if (dexPrices.length >= 2) {
    dexPrices.sort((a, b) => b.price - a.price);
    const highest = dexPrices[0];
    const lowest = dexPrices[dexPrices.length - 1];
    const spread = ((highest.price - lowest.price) / lowest.price) * 100;
    
    if (spread > 0.3) { // Meaningful spread
      opportunities.push({
        token: tokenSymbol,
        spread,
        buyDex: lowest.dex,
        buyPrice: lowest.price,
        buyLiquidity: lowest.liquidity,
        sellDex: highest.dex,
        sellPrice: highest.price,
        sellLiquidity: highest.liquidity,
        potentialProfit: spread - 0.6, // Minus ~0.6% fees
        viable: spread > 0.8, // Need >0.8% to cover fees
      });
    }
  }
  
  return opportunities;
}

// ============================================
// ANALYZE ROUTE EFFICIENCY
// ============================================
async function analyzeRouteEfficiency() {
  console.log('\n📊 ROUTE EFFICIENCY ANALYSIS');
  console.log('═'.repeat(60));
  
  const results = [];
  const pairs = [
    { from: 'SOL', to: 'USDC', fromMint: CONFIG.testTokens[0].mint, toMint: CONFIG.testTokens[1].mint, fromDec: 9, toDec: 6 },
    { from: 'USDC', to: 'SOL', fromMint: CONFIG.testTokens[1].mint, toMint: CONFIG.testTokens[0].mint, fromDec: 6, toDec: 9 },
    { from: 'SOL', to: 'RAY', fromMint: CONFIG.testTokens[0].mint, toMint: CONFIG.testTokens[4].mint, fromDec: 9, toDec: 6 },
    { from: 'SOL', to: 'JUP', fromMint: CONFIG.testTokens[0].mint, toMint: CONFIG.testTokens[3].mint, fromDec: 9, toDec: 6 },
    { from: 'SOL', to: 'BONK', fromMint: CONFIG.testTokens[0].mint, toMint: CONFIG.testTokens[5].mint, fromDec: 9, toDec: 5 },
    { from: 'SOL', to: 'WIF', fromMint: CONFIG.testTokens[0].mint, toMint: CONFIG.testTokens[6].mint, fromDec: 9, toDec: 6 },
  ];
  
  for (const pair of pairs) {
    console.log(`\n   ${pair.from} → ${pair.to}:`);
    console.log('   ' + '─'.repeat(50));
    
    for (const amountUSD of [100, 1000, 10000]) {
      // Calculate input amount
      let inputAmount;
      if (pair.from === 'SOL') {
        inputAmount = amountUSD / CONFIG.solPrice;
      } else if (pair.from === 'USDC' || pair.from === 'USDT') {
        inputAmount = amountUSD;
      } else {
        inputAmount = amountUSD; // Approximate
      }
      
      const quote = await getJupiterQuoteWithDexInfo(pair.fromMint, pair.toMint, inputAmount, pair.fromDec);
      
      if (quote) {
        const dexList = quote.dexes.map(d => d.name).join(', ');
        console.log(`   $${amountUSD}: ${quote.hops} hop(s) via ${dexList}`);
        console.log(`          Impact: ${(quote.priceImpact * 100).toFixed(4)}%`);
        
        // Track DEX usage
        for (const dex of quote.dexes) {
          if (!dexData.byName[dex.name]) {
            dexData.byName[dex.name] = { count: 0, volume: 0, pairs: new Set() };
          }
          dexData.byName[dex.name].count++;
          dexData.byName[dex.name].volume += amountUSD;
          dexData.byName[dex.name].pairs.add(`${pair.from}/${pair.to}`);
        }
        
        results.push({ pair: `${pair.from}/${pair.to}`, amount: amountUSD, ...quote });
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return results;
}

// ============================================
// TRIANGULAR ARBITRAGE SCAN
// ============================================
async function scanTriangularArb() {
  console.log('\n🔺 TRIANGULAR ARBITRAGE SCAN');
  console.log('═'.repeat(60));
  
  const triangles = [
    { a: 'SOL', b: 'USDC', c: 'RAY' },
    { a: 'SOL', b: 'USDC', c: 'JUP' },
    { a: 'SOL', b: 'USDC', c: 'BONK' },
    { a: 'SOL', b: 'USDC', c: 'WIF' },
    { a: 'SOL', b: 'USDT', c: 'RAY' },
    { a: 'SOL', b: 'mSOL', c: 'USDC' },
    { a: 'SOL', b: 'jitoSOL', c: 'USDC' },
  ];
  
  const opportunities = [];
  const startAmount = 1; // 1 SOL
  const startAmountLamports = startAmount * 1e9;
  
  for (const tri of triangles) {
    const tokenA = CONFIG.testTokens.find(t => t.symbol === tri.a);
    const tokenB = CONFIG.testTokens.find(t => t.symbol === tri.b);
    const tokenC = CONFIG.testTokens.find(t => t.symbol === tri.c);
    
    if (!tokenA || !tokenB || !tokenC) continue;
    
    console.log(`\n   ${tri.a} → ${tri.b} → ${tri.c} → ${tri.a}:`);
    
    try {
      // Step 1: A → B
      const quote1 = await getJupiterQuoteWithDexInfo(tokenA.mint, tokenB.mint, startAmount, tokenA.decimals);
      if (!quote1) { console.log('   ❌ No route A→B'); continue; }
      
      // Calculate B amount
      const bAmount = quote1.outputAmount / Math.pow(10, tokenB.decimals);
      
      // Step 2: B → C
      const quote2 = await getJupiterQuoteWithDexInfo(tokenB.mint, tokenC.mint, bAmount, tokenB.decimals);
      if (!quote2) { console.log('   ❌ No route B→C'); continue; }
      
      // Calculate C amount
      const cAmount = quote2.outputAmount / Math.pow(10, tokenC.decimals);
      
      // Step 3: C → A
      const quote3 = await getJupiterQuoteWithDexInfo(tokenC.mint, tokenA.mint, cAmount, tokenC.decimals);
      if (!quote3) { console.log('   ❌ No route C→A'); continue; }
      
      // Calculate final A amount
      const finalAmount = quote3.outputAmount / Math.pow(10, tokenA.decimals);
      const profit = ((finalAmount - startAmount) / startAmount) * 100;
      
      const route = [
        quote1.route,
        quote2.route,
        quote3.route,
      ].join(' | ');
      
      const totalImpact = quote1.priceImpact + quote2.priceImpact + quote3.priceImpact;
      
      console.log(`   Start: ${startAmount} ${tri.a}`);
      console.log(`   → ${bAmount.toFixed(4)} ${tri.b} (via ${quote1.dexes.map(d=>d.name).join(',')})`);
      console.log(`   → ${cAmount.toFixed(4)} ${tri.c} (via ${quote2.dexes.map(d=>d.name).join(',')})`);
      console.log(`   → ${finalAmount.toFixed(6)} ${tri.a} (via ${quote3.dexes.map(d=>d.name).join(',')})`);
      console.log(`   Net: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)}% | Impact: ${(totalImpact * 100).toFixed(4)}%`);
      
      if (profit > 0) {
        console.log(`   🚨 PROFITABLE!`);
        opportunities.push({
          triangle: `${tri.a}→${tri.b}→${tri.c}→${tri.a}`,
          profit,
          totalImpact,
          dexes: [...quote1.dexes, ...quote2.dexes, ...quote3.dexes].map(d => d.name),
        });
      }
      
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  return opportunities;
}

// ============================================
// DEX LIQUIDITY ANALYSIS
// ============================================
async function analyzeDexLiquidity() {
  console.log('\n💧 DEX LIQUIDITY ANALYSIS');
  console.log('═'.repeat(60));
  
  const dexLiquidity = {};
  
  for (const token of CONFIG.testTokens.slice(0, 7)) {
    const pools = await scanTokenPools(token.mint, token.symbol);
    
    for (const [dex, dexPools] of Object.entries(pools)) {
      if (!dexLiquidity[dex]) {
        dexLiquidity[dex] = {
          totalLiquidity: 0,
          totalVolume24h: 0,
          poolCount: 0,
          tokens: [],
          avgSpread: 0,
        };
      }
      
      const totalLiq = dexPools.reduce((sum, p) => sum + (p.liquidity || 0), 0);
      const totalVol = dexPools.reduce((sum, p) => sum + (p.volume24h || 0), 0);
      
      dexLiquidity[dex].totalLiquidity += totalLiq;
      dexLiquidity[dex].totalVolume24h += totalVol;
      dexLiquidity[dex].poolCount += dexPools.length;
      dexLiquidity[dex].tokens.push(token.symbol);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Sort and display
  const sorted = Object.entries(dexLiquidity)
    .sort((a, b) => b[1].totalLiquidity - a[1].totalLiquidity)
    .slice(0, 15);
  
  console.log('\n   DEX                  Liquidity       Volume 24h     Pools  Tokens');
  console.log('   ' + '─'.repeat(65));
  
  for (const [dex, data] of sorted) {
    const liq = data.totalLiquidity >= 1e9 
      ? `$${(data.totalLiquidity / 1e9).toFixed(2)}B`
      : data.totalLiquidity >= 1e6
        ? `$${(data.totalLiquidity / 1e6).toFixed(1)}M`
        : `$${(data.totalLiquidity / 1e3).toFixed(0)}K`;
    
    const vol = data.totalVolume24h >= 1e6
      ? `$${(data.totalVolume24h / 1e6).toFixed(1)}M`
      : `$${(data.totalVolume24h / 1e3).toFixed(0)}K`;
    
    console.log(`   ${dex.padEnd(20)} ${liq.padEnd(15)} ${vol.padEnd(14)} ${String(data.poolCount).padEnd(6)} ${data.tokens.slice(0,4).join(',')}`);
  }
  
  return dexLiquidity;
}

// ============================================
// CROSS-DEX PRICE COMPARISON
// ============================================
async function comparePricesAcrossDexes() {
  console.log('\n📈 CROSS-DEX PRICE COMPARISON');
  console.log('═'.repeat(60));
  
  const allOpportunities = [];
  
  for (const token of CONFIG.testTokens.slice(2, 8)) { // Skip SOL/USDC
    const opportunities = await findArbOpportunities(token.symbol, token.mint);
    
    if (opportunities.length > 0) {
      for (const opp of opportunities) {
        console.log(`\n   ${opp.token}:`);
        console.log(`   Buy:  ${opp.buyDex.padEnd(15)} $${opp.buyPrice.toFixed(6)} (liq: $${(opp.buyLiquidity/1000).toFixed(0)}K)`);
        console.log(`   Sell: ${opp.sellDex.padEnd(15)} $${opp.sellPrice.toFixed(6)} (liq: $${(opp.sellLiquidity/1000).toFixed(0)}K)`);
        console.log(`   Spread: ${opp.spread.toFixed(3)}% | Net: ${opp.potentialProfit.toFixed(3)}% ${opp.viable ? '✅ VIABLE' : '⚠️ marginal'}`);
        
        allOpportunities.push(opp);
      }
    }
    
    await new Promise(r => setTimeout(r, 400));
  }
  
  return allOpportunities;
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('═'.repeat(60));
  console.log('🔍 COMPREHENSIVE DEX OPPORTUNITY SCANNER');
  console.log('═'.repeat(60));
  console.log('   Analyzing: Raydium, Orca, Meteora, Jupiter routes');
  console.log('   FluxBeam, Lifinity, Phoenix, Pump.fun, and more');
  console.log('═'.repeat(60));
  
  // 1. DEX Liquidity Analysis
  const dexLiquidity = await analyzeDexLiquidity();
  
  // 2. Route Efficiency
  const routeResults = await analyzeRouteEfficiency();
  
  // 3. Cross-DEX Price Comparison
  const arbOpportunities = await comparePricesAcrossDexes();
  
  // 4. Triangular Arbitrage
  const triangularOpps = await scanTriangularArb();
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  
  // DEX Usage from Jupiter Routes
  console.log('\n   DEXes Used by Jupiter Router:');
  console.log('   ' + '─'.repeat(50));
  const sortedDexes = Object.entries(dexData.byName)
    .sort((a, b) => b[1].count - a[1].count);
  
  for (const [dex, data] of sortedDexes.slice(0, 12)) {
    console.log(`   ${dex.padEnd(20)} Used ${data.count}x | Vol: $${data.volume.toLocaleString()}`);
  }
  
  // Opportunities
  console.log('\n   Cross-DEX Arbitrage Opportunities:');
  console.log('   ' + '─'.repeat(50));
  const viableArbs = arbOpportunities.filter(o => o.viable);
  console.log(`   Found: ${arbOpportunities.length} total, ${viableArbs.length} viable`);
  
  for (const opp of viableArbs.slice(0, 5)) {
    console.log(`   • ${opp.token}: ${opp.spread.toFixed(2)}% (${opp.buyDex} → ${opp.sellDex})`);
  }
  
  // Triangular
  console.log('\n   Triangular Arbitrage:');
  console.log('   ' + '─'.repeat(50));
  const profitableTriangles = triangularOpps.filter(t => t.profit > 0);
  console.log(`   Found: ${triangularOpps.length} routes, ${profitableTriangles.length} profitable`);
  
  for (const tri of profitableTriangles.slice(0, 3)) {
    console.log(`   • ${tri.triangle}: +${tri.profit.toFixed(4)}%`);
  }
  
  // Recommendations
  console.log('\n   💡 RECOMMENDATIONS:');
  console.log('   ' + '─'.repeat(50));
  console.log('   1. Jupiter aggregates well - use as primary router');
  console.log('   2. Raydium/Orca have deepest liquidity for majors');
  console.log('   3. Meteora good for newer/smaller tokens');
  console.log('   4. Cross-DEX arb requires speed + low fees to profit');
  console.log('   5. Triangular arb opportunities exist but small margins');
}

main().catch(console.error);
