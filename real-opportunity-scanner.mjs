#!/usr/bin/env node
/**
 * REAL OPPORTUNITY SCANNER
 * 
 * NO SIMULATIONS - Only real data, real prices, real opportunities
 * Watches for:
 * 1. New token launches with good ML scores
 * 2. Flashloan arb opportunities (only if profitable after fees)
 * 
 * Uses small positions, conservative approach
 */

import https from 'https';

// Optimized HTTPS agent
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

async function optimizedFetch(url, options = {}) {
  return fetch(url, {
    agent: httpsAgent,
    headers: { 'Connection': 'keep-alive', 'Accept': 'application/json', ...options.headers },
    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  jupiterApiKey: process.env.JUPITER_API_KEY,
  
  // Conservative flashloan settings
  flashloan: {
    minSize: 500,      // $500 minimum
    maxSize: 2500,     // $2500 max (conservative)
    fee: 0.003,        // 0.3% Solend fee
    minProfitAfterFees: 5,  // Need at least $5 profit
  },
  
  // Entry filters  
  entry: {
    minLiquidity: 10000,   // $10K min liq
    minVolume: 5000,       // $5K min 24h vol
    minMLScore: 0.65,      // 65%+ ML confidence
    maxRugRisk: 0.6,       // Under 60% rug risk
  },
  
  // Trading costs
  costs: {
    slippage: 1.5,         // 1.5% expected slippage
    priorityFee: 0.50,     // $0.50 per tx
    txCount: 2,            // Entry + exit
  },
};

const SOL_PRICE = 125; // Approximate

const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

// ═══════════════════════════════════════════════════════════════
// ML SCORER (Real features, no simulation)
// ═══════════════════════════════════════════════════════════════

function mlScore(pair) {
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange5m = pair.priceChange?.m5 || 0;
  const txns = pair.txns?.h1 || { buys: 0, sells: 0 };
  
  // Feature extraction
  const features = {
    liquidityScore: Math.min(1, liq / 100000),
    volumeScore: Math.min(1, vol / 50000),
    volumeToLiq: liq > 0 ? Math.min(1, vol / liq / 5) : 0,
    ageScore: age < 0.5 ? 1 : age < 1 ? 0.9 : age < 3 ? 0.7 : age < 12 ? 0.5 : 0.3,
    momentum1h: priceChange1h > 20 ? 0.9 : priceChange1h > 0 ? 0.7 : 0.3,
    momentum5m: priceChange5m > 5 ? 0.8 : priceChange5m > 0 ? 0.6 : 0.4,
    buyPressure: txns.buys + txns.sells > 0 ? txns.buys / (txns.buys + txns.sells) : 0.5,
    txActivity: Math.min(1, (txns.buys + txns.sells) / 100),
  };
  
  // Rug risk calculation
  const rugRisk = liq < 5000 ? 0.9 : liq < 10000 ? 0.7 : liq < 25000 ? 0.5 : liq < 50000 ? 0.3 : 0.15;
  
  // Weighted score
  const weights = {
    liquidityScore: 0.15,
    volumeScore: 0.15,
    volumeToLiq: 0.1,
    ageScore: 0.1,
    momentum1h: 0.15,
    momentum5m: 0.1,
    buyPressure: 0.15,
    txActivity: 0.1,
  };
  
  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    score += (features[k] || 0) * w;
  }
  
  // Penalize high rug risk
  score = score * (1 - rugRisk * 0.3);
  
  return {
    score: Math.max(0, Math.min(1, score)),
    rugRisk,
    features,
    signal: score > 0.7 ? 'STRONG_BUY' : score > 0.6 ? 'BUY' : score > 0.45 ? 'HOLD' : 'SKIP',
  };
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY SCANNER
// ═══════════════════════════════════════════════════════════════

async function scanNewTokens() {
  const opportunities = [];
  
  try {
    // Fetch from multiple sources in parallel
    const [profiles, boosts] = await Promise.all([
      optimizedFetch('https://api.dexscreener.com/token-profiles/latest/v1').then(r => r.json()).catch(() => []),
      optimizedFetch('https://api.dexscreener.com/token-boosts/latest/v1').then(r => r.json()).catch(() => []),
    ]);
    
    // Combine and dedupe
    const allTokens = new Map();
    
    for (const p of (profiles || []).filter(t => t.chainId === 'solana').slice(0, 20)) {
      allTokens.set(p.tokenAddress, { address: p.tokenAddress, source: 'profile' });
    }
    for (const b of (boosts || []).filter(t => t.chainId === 'solana').slice(0, 20)) {
      allTokens.set(b.tokenAddress, { address: b.tokenAddress, source: 'boost', amount: b.amount });
    }
    
    // Batch fetch pair data
    const addresses = Array.from(allTokens.keys());
    
    for (let i = 0; i < addresses.length; i += 5) {
      const batch = addresses.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(addr =>
          optimizedFetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      
      for (let j = 0; j < batch.length; j++) {
        const data = results[j];
        if (!data?.pairs?.[0]) continue;
        
        const pair = data.pairs[0];
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;
        
        // Apply filters
        if (liq < CONFIG.entry.minLiquidity) continue;
        if (vol < CONFIG.entry.minVolume) continue;
        
        const ml = mlScore(pair);
        
        if (ml.score < CONFIG.entry.minMLScore) continue;
        if (ml.rugRisk > CONFIG.entry.maxRugRisk) continue;
        
        // Calculate potential position
        const positionSize = calculatePosition(ml.score, ml.rugRisk, liq);
        const expectedCosts = calculateCosts(positionSize);
        
        opportunities.push({
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          address: batch[j],
          price: parseFloat(pair.priceUsd) || 0,
          liquidity: liq,
          volume24h: vol,
          age: age.toFixed(2),
          change1h: pair.priceChange?.h1 || 0,
          change5m: pair.priceChange?.m5 || 0,
          txns: pair.txns?.h1 || { buys: 0, sells: 0 },
          dex: pair.dexId,
          mlScore: ml.score,
          mlSignal: ml.signal,
          rugRisk: ml.rugRisk,
          positionSize,
          costs: expectedCosts,
          source: allTokens.get(batch[j]).source,
        });
      }
    }
    
  } catch (e) {
    console.log('   Error scanning tokens:', e.message);
  }
  
  return opportunities.sort((a, b) => b.mlScore - a.mlScore);
}

async function scanArbOpportunities() {
  const opportunities = [];
  
  // Test tokens for circular arb
  const testPairs = [
    { symbol: 'WIF', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
    { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { symbol: 'JUP', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
    { symbol: 'RAY', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  ];
  
  for (const pair of testPairs) {
    try {
      // Test with $1000
      const testAmount = 1000 * 1e6; // USDC has 6 decimals
      
      // USDC → Token
      const buyQuote = await getJupiterQuote(TOKENS.USDC, pair.address, testAmount);
      if (!buyQuote) continue;
      
      // Token → USDC
      const sellQuote = await getJupiterQuote(pair.address, TOKENS.USDC, buyQuote.outAmount);
      if (!sellQuote) continue;
      
      const startUSDC = 1000;
      const endUSDC = parseInt(sellQuote.outAmount) / 1e6;
      const grossProfit = endUSDC - startUSDC;
      const spreadPercent = (grossProfit / startUSDC) * 100;
      
      // Only consider if profitable
      if (spreadPercent > 0.1) {
        // Calculate with flashloan
        const flashSize = Math.min(CONFIG.flashloan.maxSize, Math.max(CONFIG.flashloan.minSize, spreadPercent * 5000));
        const scaledGross = (spreadPercent / 100) * flashSize;
        const fees = flashSize * CONFIG.flashloan.fee + CONFIG.costs.priorityFee * CONFIG.costs.txCount;
        const netProfit = scaledGross - fees;
        
        if (netProfit >= CONFIG.flashloan.minProfitAfterFees) {
          opportunities.push({
            type: 'circular_arb',
            symbol: pair.symbol,
            address: pair.address,
            spreadPercent: spreadPercent.toFixed(3),
            flashSize,
            grossProfit: scaledGross.toFixed(2),
            fees: fees.toFixed(2),
            netProfit: netProfit.toFixed(2),
            buyRoute: buyQuote.routePlan?.map(r => r.swapInfo?.label).join('→') || 'jupiter',
            sellRoute: sellQuote.routePlan?.map(r => r.swapInfo?.label).join('→') || 'jupiter',
            profitable: netProfit > 0,
          });
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  return opportunities.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
}

async function getJupiterQuote(inputMint, outputMint, amount) {
  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=100`;
    const resp = await optimizedFetch(url, {
      headers: { 'x-api-key': CONFIG.jupiterApiKey }
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

function calculatePosition(mlScore, rugRisk, liquidity) {
  // Base position scaled by ML confidence
  let base = mlScore >= 0.8 ? 1500 : mlScore >= 0.7 ? 1000 : 500;
  
  // Scale down for high rug risk
  base = base * (1 - rugRisk * 0.5);
  
  // Don't exceed 2% of liquidity
  const maxByLiq = liquidity * 0.02;
  
  return Math.min(CONFIG.flashloan.maxSize, Math.max(CONFIG.flashloan.minSize, Math.min(base, maxByLiq)));
}

function calculateCosts(positionSize) {
  const flashFee = positionSize * CONFIG.flashloan.fee;
  const slippage = positionSize * (CONFIG.costs.slippage / 100);
  const txFees = CONFIG.costs.priorityFee * CONFIG.costs.txCount;
  
  return {
    flashFee: flashFee.toFixed(2),
    slippage: slippage.toFixed(2),
    txFees: txFees.toFixed(2),
    total: (flashFee + slippage + txFees).toFixed(2),
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN SCANNER LOOP
// ═══════════════════════════════════════════════════════════════

async function runScanner() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 REAL OPPORTUNITY SCANNER - NO SIMULATIONS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Watching for:');
  console.log('   • New tokens with ML score ≥65%');
  console.log('   • Flashloan arb with net profit ≥$5');
  console.log('   • Max position: $2,500 (conservative)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let round = 0;
  const allOpportunities = [];
  
  const runDuration = 120000; // 2 minutes
  const startTime = Date.now();
  
  while (Date.now() - startTime < runDuration) {
    round++;
    const roundStart = Date.now();
    
    console.log(`\n🔄 SCAN #${round} [${new Date().toLocaleTimeString()}]`);
    console.log('─'.repeat(60));
    
    // Scan both strategies in parallel
    const [newTokens, arbOpps] = await Promise.all([
      scanNewTokens(),
      scanArbOpportunities(),
    ]);
    
    // Display new token opportunities
    console.log('\n📊 NEW TOKEN OPPORTUNITIES:');
    if (newTokens.length === 0) {
      console.log('   No qualifying tokens found');
    } else {
      for (const opp of newTokens.slice(0, 5)) {
        const signalIcon = opp.mlSignal === 'STRONG_BUY' ? '🟢🟢' : opp.mlSignal === 'BUY' ? '🟢' : '🟡';
        const riskIcon = opp.rugRisk < 0.3 ? '✅' : opp.rugRisk < 0.5 ? '🔶' : '⚠️';
        
        console.log(`   ${signalIcon} ${opp.symbol.padEnd(12)} | ML: ${(opp.mlScore * 100).toFixed(0)}% | $${opp.liquidity.toLocaleString()} liq | ${opp.change1h >= 0 ? '+' : ''}${opp.change1h.toFixed(1)}% 1h | Risk: ${riskIcon}`);
        console.log(`      Position: $${opp.positionSize.toFixed(0)} | Costs: $${opp.costs.total} | Age: ${opp.age}h | ${opp.dex}`);
        
        // Track opportunity
        allOpportunities.push({ ...opp, timestamp: new Date().toISOString(), type: 'sniper' });
      }
    }
    
    // Display arb opportunities
    console.log('\n⚡ FLASHLOAN ARB OPPORTUNITIES:');
    if (arbOpps.length === 0) {
      console.log('   No profitable arb found (need >$5 net profit)');
    } else {
      for (const opp of arbOpps) {
        const profitIcon = parseFloat(opp.netProfit) >= 10 ? '💰💰' : '💰';
        console.log(`   ${profitIcon} ${opp.symbol} | ${opp.spreadPercent}% spread | $${opp.flashSize} FL → Net: $${opp.netProfit}`);
        console.log(`      Route: ${opp.buyRoute} → ${opp.sellRoute}`);
        
        // Track opportunity
        allOpportunities.push({ ...opp, timestamp: new Date().toISOString() });
      }
    }
    
    const scanTime = Date.now() - roundStart;
    console.log(`\n   ⏱️ Scan completed in ${scanTime}ms`);
    
    // Wait before next scan
    await new Promise(r => setTimeout(r, 10000)); // 10 second intervals
  }
  
  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('📈 SCAN SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const sniperOpps = allOpportunities.filter(o => o.type === 'sniper');
  const arbOppsAll = allOpportunities.filter(o => o.type === 'circular_arb');
  
  console.log(`   Total Scans: ${round}`);
  console.log(`   Sniper Opportunities Found: ${sniperOpps.length}`);
  console.log(`   Arb Opportunities Found: ${arbOppsAll.length}`);
  
  // Top sniper opportunities
  if (sniperOpps.length > 0) {
    console.log('\n   🎯 TOP SNIPER OPPORTUNITIES:');
    const uniqueSniper = [...new Map(sniperOpps.map(o => [o.address, o])).values()];
    for (const opp of uniqueSniper.sort((a, b) => b.mlScore - a.mlScore).slice(0, 5)) {
      console.log(`      ${opp.symbol}: ML ${(opp.mlScore * 100).toFixed(0)}% | $${opp.liquidity.toLocaleString()} liq | Position: $${opp.positionSize.toFixed(0)}`);
    }
  }
  
  // Top arb opportunities
  if (arbOppsAll.length > 0) {
    console.log('\n   ⚡ TOP ARB OPPORTUNITIES:');
    const uniqueArb = [...new Map(arbOppsAll.map(o => [o.symbol, o])).values()];
    for (const opp of uniqueArb.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit)).slice(0, 3)) {
      console.log(`      ${opp.symbol}: ${opp.spreadPercent}% spread | $${opp.flashSize} FL → Net: $${opp.netProfit}`);
    }
  }
  
  console.log('\n   💡 NEXT STEPS:');
  if (sniperOpps.length > 0) {
    const best = sniperOpps.sort((a, b) => b.mlScore - a.mlScore)[0];
    console.log(`      • Best sniper: ${best.symbol} at ML ${(best.mlScore * 100).toFixed(0)}%`);
  }
  if (arbOppsAll.length > 0) {
    const best = arbOppsAll.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit))[0];
    console.log(`      • Best arb: ${best.symbol} for $${best.netProfit} profit`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

// Run
runScanner().catch(console.error);
