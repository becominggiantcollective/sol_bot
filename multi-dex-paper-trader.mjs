// MULTI-DEX FLASHLOAN PAPER TRADER
// Routes through multiple DEXes: Jupiter, Raydium, Orca, Meteora
// Compares routes and finds optimal execution

import fetch from 'node-fetch';
import fs from 'fs';
import { 
  analyzeToken, 
  recordTradeOutcome, 
  quickRugCheck,
  getModelStats,
  migrateFromV1 
} from './ml-predictor-v2.mjs';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // APIs
  apis: {
    jupiter: {
      url: 'https://api.jup.ag/swap/v1',
      key: process.env.JUPITER_API_KEY,
    },
    dexscreener: 'https://api.dexscreener.com/latest/dex',
    helius: process.env.HELIUS_RPC_URL,
  },
  
  // Token mints
  tokens: {
    SOL: { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
    USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  },
  
  // DEX Configuration
  dexes: {
    jupiter: { enabled: true, fee: 0, priority: 1 },
    raydium: { enabled: true, fee: 0.25, priority: 2 },
    orca: { enabled: true, fee: 0.30, priority: 3 },
    meteora: { enabled: true, fee: 0.20, priority: 4 },
    fluxbeam: { enabled: true, fee: 0.25, priority: 5 },
  },
  
  // Flashloan Settings
  flashloan: {
    tiers: [
      { amount: 1000, minProfit: 0.8 },
      { amount: 5000, minProfit: 0.5 },
      { amount: 10000, minProfit: 0.4 },
      { amount: 25000, minProfit: 0.35 },
      { amount: 50000, minProfit: 0.3 },
    ],
    solendFee: 0.003,
  },
  
  // Dynamic Fees
  fees: {
    basePriority: 50000,
    minPriority: 25000,
    maxPriority: 2000000,
    congestionMultiplier: 2.5,
  },
  
  // Trading Filters
  filters: {
    minLiquidity: 15000,
    maxLiquidity: 5000000,
    minVolume: 5000,
    maxAge: 168,
    minSpread: 0.1, // Min spread to consider multi-dex routing
  },
  
  // Risk Management
  risk: {
    profitTarget: 6,
    stopLoss: 4,
    maxHoldTime: 45,
  },
  
  // ML
  ml: {
    enabled: true,
    minConfidence: 0.45,
    minScore: 0.5,
    rugRiskMax: 0.7,
  },
  
  solPrice: 230,
};

// ============================================
// STATE
// ============================================
const state = {
  fees: { priority: CONFIG.fees.basePriority, congestion: 'low' },
  dexStats: {},
  trades: [],
  stats: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    byDex: {},
    bestRoute: null,
    avgSlippage: 0,
  },
};

// Initialize DEX stats
for (const dex of Object.keys(CONFIG.dexes)) {
  state.dexStats[dex] = { trades: 0, wins: 0, volume: 0, avgSlippage: 0 };
  state.stats.byDex[dex] = { trades: 0, pnl: 0 };
}

// ============================================
// DEX QUOTE FETCHERS
// ============================================

// Jupiter Quote
async function getJupiterQuote(inputMint, outputMint, amount) {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: 50,
    });
    
    const res = await fetch(`${CONFIG.apis.jupiter.url}/quote?${params}`, {
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.apis.jupiter.key,
      },
      timeout: 5000,
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    
    return {
      dex: 'jupiter',
      route: data.routePlan?.map(r => r.swapInfo?.label).join(' → ') || 'unknown',
      inputAmount: amount,
      outputAmount: parseInt(data.outAmount || 0),
      priceImpact: parseFloat(data.priceImpactPct || 0),
      fee: 0,
    };
  } catch (e) {
    return null;
  }
}

// DexScreener Pool Quote (for Raydium, Orca, Meteora)
async function getDexScreenerQuote(tokenMint, dex, amount, direction = 'buy') {
  try {
    const res = await fetch(`${CONFIG.apis.dexscreener}/tokens/${tokenMint}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    
    // Find pool on specified DEX
    const pool = (data.pairs || []).find(p => 
      p.chainId === 'solana' && 
      p.dexId === dex &&
      p.liquidity?.usd > 1000
    );
    
    if (!pool) return null;
    
    const price = parseFloat(pool.priceUsd) || 0;
    const liquidity = pool.liquidity?.usd || 0;
    
    // Simulate price impact based on liquidity
    const amountUSD = amount / 1e9 * CONFIG.solPrice;
    const priceImpact = (amountUSD / liquidity) * 100;
    
    // Adjusted output
    const outputAmount = direction === 'buy' 
      ? Math.floor(amount * price * (1 - priceImpact / 100) / CONFIG.solPrice)
      : Math.floor(amount / price * (1 - priceImpact / 100) * CONFIG.solPrice);
    
    return {
      dex,
      route: `${pool.baseToken?.symbol}/${pool.quoteToken?.symbol}`,
      inputAmount: amount,
      outputAmount,
      priceImpact,
      fee: CONFIG.dexes[dex]?.fee || 0.25,
      liquidity,
      price,
      pairAddress: pool.pairAddress,
    };
  } catch (e) {
    return null;
  }
}

// Get quotes from all enabled DEXes
async function getAllDexQuotes(tokenMint, amount, direction = 'buy') {
  const quotes = [];
  
  // Jupiter (aggregator)
  if (CONFIG.dexes.jupiter.enabled) {
    const jupQuote = await getJupiterQuote(
      direction === 'buy' ? CONFIG.tokens.SOL.mint : tokenMint,
      direction === 'buy' ? tokenMint : CONFIG.tokens.SOL.mint,
      amount
    );
    if (jupQuote) quotes.push(jupQuote);
  }
  
  // Direct DEX quotes
  const directDexes = ['raydium', 'orca', 'meteora', 'fluxbeam'];
  for (const dex of directDexes) {
    if (CONFIG.dexes[dex]?.enabled) {
      const quote = await getDexScreenerQuote(tokenMint, dex, amount, direction);
      if (quote) quotes.push(quote);
    }
  }
  
  // Sort by best output
  quotes.sort((a, b) => b.outputAmount - a.outputAmount);
  
  return quotes;
}

// ============================================
// MULTI-DEX ROUTING
// ============================================

// Find optimal route across DEXes
async function findOptimalRoute(tokenMint, amount, direction = 'buy') {
  const quotes = await getAllDexQuotes(tokenMint, amount, direction);
  
  if (quotes.length === 0) return null;
  
  const best = quotes[0];
  const worst = quotes[quotes.length - 1];
  const spread = quotes.length > 1 
    ? ((best.outputAmount - worst.outputAmount) / worst.outputAmount) * 100 
    : 0;
  
  return {
    best,
    all: quotes,
    spread,
    dexCount: quotes.length,
    improvement: spread, // % improvement over worst route
  };
}

// Split order across DEXes for large amounts
function calculateSplitRoute(quotes, totalAmount) {
  // Simple split: proportional to liquidity
  const totalLiq = quotes.reduce((sum, q) => sum + (q.liquidity || 1000), 0);
  
  return quotes.map(q => ({
    ...q,
    splitAmount: Math.floor(totalAmount * ((q.liquidity || 1000) / totalLiq)),
    splitPct: ((q.liquidity || 1000) / totalLiq) * 100,
  }));
}

// ============================================
// TOKEN FETCHING
// ============================================
async function fetchTokens() {
  try {
    const urls = [
      'https://api.dexscreener.com/latest/dex/search?q=pump',
      'https://api.dexscreener.com/latest/dex/search?q=meme',
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
    ];
    
    const allPairs = [];
    
    for (const url of urls) {
      try {
        const res = await fetch(url, { 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000 
        });
        if (!res.ok) continue;
        
        const data = await res.json();
        const pairs = (data.pairs || []).filter(p => 
          p.chainId === 'solana' && 
          p.liquidity?.usd > CONFIG.filters.minLiquidity
        );
        allPairs.push(...pairs);
      } catch (e) {}
    }
    
    // Dedupe
    const unique = new Map();
    for (const p of allPairs) {
      const key = p.baseToken?.address;
      if (key && !unique.has(key)) unique.set(key, p);
    }
    
    return Array.from(unique.values())
      .sort((a, b) => (b.volume?.h1 || 0) - (a.volume?.h1 || 0))
      .slice(0, 30);
  } catch (e) {
    return [];
  }
}

function parseToken(pair) {
  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol,
    price: parseFloat(pair.priceUsd) || 0,
    liquidity: pair.liquidity?.usd || 0,
    volume: pair.volume?.h24 || 0,
    volume1h: pair.volume?.h1 || 0,
    ageHours: pair.pairCreatedAt 
      ? (Date.now() - new Date(pair.pairCreatedAt).getTime()) / 3600000 
      : 999,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceVelocity: (pair.priceChange?.m5 || 0) / 100,
    buyCount: pair.txns?.h1?.buys || 0,
    sellCount: pair.txns?.h1?.sells || 0,
    dex: pair.dexId,
  };
}

// ============================================
// FLASHLOAN PAPER TRADE
// ============================================
async function simulateMultiDexTrade(token, analysis, flashloanTier) {
  const entry = Date.now();
  
  console.log(`\n🎯 MULTI-DEX PAPER TRADE: ${token.symbol}`);
  console.log(`   💰 Flashloan: $${flashloanTier.amount.toLocaleString()}`);
  
  // Get quotes from all DEXes
  const amountLamports = Math.floor((flashloanTier.amount / CONFIG.solPrice) * 1e9);
  const routing = await findOptimalRoute(token.mint, amountLamports, 'buy');
  
  if (!routing) {
    console.log('   ❌ No routes available');
    return null;
  }
  
  // Show route comparison
  console.log(`   📊 Routes found: ${routing.dexCount}`);
  for (const quote of routing.all.slice(0, 3)) {
    const outputUSD = (quote.outputAmount / 1e9) * CONFIG.solPrice;
    console.log(`      ${quote.dex.padEnd(12)} Output: $${outputUSD.toFixed(2)} | Impact: ${quote.priceImpact.toFixed(3)}%`);
  }
  
  if (routing.spread > 0) {
    console.log(`   📈 Best route ${routing.spread.toFixed(2)}% better than worst`);
  }
  
  const bestRoute = routing.best;
  console.log(`   ✨ Using: ${bestRoute.dex} (${bestRoute.route})`);
  
  // Simulate trade outcome
  const holdTimeMs = Math.random() * CONFIG.risk.maxHoldTime * 1000;
  
  // Price simulation
  const baseMove = (Math.random() - 0.4) * 0.15;
  const mlBonus = (analysis.score - 0.5) * 0.1;
  const dexBonus = bestRoute.dex === 'jupiter' ? 0.01 : 0; // Jupiter usually better
  const priceMove = baseMove + mlBonus + dexBonus - (bestRoute.priceImpact / 100);
  
  // Calculate PnL
  const solendFee = flashloanTier.amount * CONFIG.flashloan.solendFee;
  const dexFee = flashloanTier.amount * (bestRoute.fee / 100);
  const gasFee = 0.01 * CONFIG.solPrice; // ~0.01 SOL gas
  const totalCosts = solendFee + dexFee * 2 + gasFee; // 2x dex fee for buy+sell
  
  const grossProfit = flashloanTier.amount * priceMove;
  const netProfit = grossProfit - totalCosts;
  const netProfitPct = (netProfit / flashloanTier.amount) * 100;
  
  // Record
  recordTradeOutcome({
    token: { symbol: token.symbol, mint: token.mint, liquidity: token.liquidity },
    entryPrice: token.price,
    exitPrice: token.price * (1 + priceMove),
    profitPct: netProfitPct,
    holdTimeMs,
    dex: bestRoute.dex,
    route: bestRoute.route,
    prediction: { score: analysis.score, confidence: analysis.confidence },
    flashloanAmount: flashloanTier.amount,
  });
  
  // Update stats
  state.stats.totalTrades++;
  state.stats.totalPnL += netProfit;
  state.stats.byDex[bestRoute.dex].trades++;
  state.stats.byDex[bestRoute.dex].pnl += netProfit;
  
  if (netProfit > 0) {
    state.stats.wins++;
    state.dexStats[bestRoute.dex].wins++;
  }
  state.dexStats[bestRoute.dex].trades++;
  
  // Print result
  const icon = netProfit > 0 ? '✅' : '❌';
  console.log(`   ${icon} Result: ${netProfitPct.toFixed(2)}% ($${netProfit.toFixed(2)})`);
  console.log(`   ⏱️ Hold: ${(holdTimeMs / 1000).toFixed(1)}s | Fees: $${totalCosts.toFixed(2)}`);
  
  return { netProfit, netProfitPct, dex: bestRoute.dex };
}

// ============================================
// MAIN LOOP
// ============================================
async function scanAndTrade() {
  console.log('\n🔍 Scanning tokens across DEXes...');
  
  const pairs = await fetchTokens();
  if (pairs.length === 0) {
    console.log('No tokens found');
    return;
  }
  
  console.log(`   Found ${pairs.length} tokens`);
  
  for (const pair of pairs.slice(0, 10)) {
    const token = parseToken(pair);
    if (!token.price || !token.mint) continue;
    
    // ML Analysis
    const analysis = analyzeToken(token);
    if (!analysis.shouldTrade) continue;
    if (analysis.score < CONFIG.ml.minScore) continue;
    
    // Quick rug check
    const rugCheck = quickRugCheck(token);
    if (rugCheck.isLikelyRug) continue;
    
    // Select flashloan tier based on score
    const tierIndex = Math.min(
      CONFIG.flashloan.tiers.length - 1,
      Math.floor(analysis.score * CONFIG.flashloan.tiers.length)
    );
    const tier = CONFIG.flashloan.tiers[tierIndex] || CONFIG.flashloan.tiers[0];
    
    // Execute trade
    await simulateMultiDexTrade(token, analysis, tier);
    
    await new Promise(r => setTimeout(r, 1000));
  }
}

// ============================================
// STATS
// ============================================
function printStats() {
  const winRate = state.stats.totalTrades > 0 
    ? ((state.stats.wins / state.stats.totalTrades) * 100).toFixed(1) 
    : 0;
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 MULTI-DEX PAPER TRADING STATS');
  console.log('═'.repeat(60));
  console.log(`   Total Trades: ${state.stats.totalTrades}`);
  console.log(`   Win Rate: ${winRate}% (${state.stats.wins}W / ${state.stats.totalTrades - state.stats.wins}L)`);
  console.log(`   Total PnL: $${state.stats.totalPnL.toFixed(2)}`);
  
  console.log('\n   📈 Performance by DEX:');
  console.log('   ' + '─'.repeat(50));
  for (const [dex, stats] of Object.entries(state.stats.byDex)) {
    if (stats.trades > 0) {
      const dexWinRate = (state.dexStats[dex].wins / stats.trades * 100).toFixed(0);
      console.log(`   ${dex.padEnd(12)} Trades: ${stats.trades} | PnL: $${stats.pnl.toFixed(2)} | WR: ${dexWinRate}%`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  
  const mlStats = getModelStats();
  console.log(`\n🧠 ML: Accuracy ${mlStats.accuracy}% | Trades learned: ${mlStats.tradesRecorded}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('═'.repeat(60));
  console.log('🔄 MULTI-DEX FLASHLOAN PAPER TRADER');
  console.log('═'.repeat(60));
  console.log('   Routing through: Jupiter, Raydium, Orca, Meteora, FluxBeam');
  console.log('   Comparing routes to find optimal execution');
  console.log('═'.repeat(60));
  
  migrateFromV1();
  
  const scanCount = 5;
  for (let i = 0; i < scanCount; i++) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📡 SCAN ${i + 1}/${scanCount}`);
    await scanAndTrade();
    
    if (i < scanCount - 1) {
      console.log('\n⏳ Waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  printStats();
}

main().catch(console.error);
