// SCALED FLASHLOAN PAPER TRADER with DYNAMIC FEES
// Simulates real flashloan trading with aggressive MEV-winning fee strategies

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
  // API Keys
  heliusRpc: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  jupiterApi: 'https://api.jup.ag',
  jupiterKey: 'f6663264-66de-4a78-b115-c14a9efc5a05',
  
  // Flashloan Settings
  flashloanTiers: [
    { amount: 1000, minProfit: 0.8 },    // $1K - need 0.8% after fees
    { amount: 2500, minProfit: 0.6 },    // $2.5K
    { amount: 5000, minProfit: 0.5 },    // $5K  
    { amount: 10000, minProfit: 0.4 },   // $10K
    { amount: 25000, minProfit: 0.35 },  // $25K
    { amount: 50000, minProfit: 0.3 },   // $50K - only need 0.3%
  ],
  solendFee: 0.003, // 0.3%
  
  // Dynamic Fee Settings
  fees: {
    basePriority: 50000,           // Base: 50K microlamports
    minPriority: 25000,            // Floor: 25K
    maxPriority: 2000000,          // Ceiling: 2M (aggressive)
    congestionMultiplier: 2.5,     // Scale up in congestion
    mevMultiplier: 3.0,            // For MEV-sensitive trades
    updateInterval: 10000,         // Update every 10s
  },
  
  // Trading Filters
  filters: {
    minLiquidity: 15000,           // $15K min liquidity
    maxLiquidity: 5000000,         // Raised: Skip massive pools >$5M
    minVolume: 5000,               // $5K min volume
    maxAge: 168,                   // Raised: Max 168 hours (1 week) old
    minAge: 0.001,                 // At least 3.6 seconds old
    maxSpread: 0.03,               // Max 3% spread
  },
  
  // Risk Management
  risk: {
    profitTarget: 6,               // +6% profit target
    stopLoss: 4,                   // -4% stop loss
    maxHoldTime: 45,               // 45 second max hold
    rugExitTime: 3,                // Exit in 3s if rug detected
    trailingStop: true,            // Enable trailing stop
    trailingPct: 2,                // 2% trailing stop
  },
  
  // ML Integration
  ml: {
    enabled: true,
    minConfidence: 0.45,           // Lowered: Min 45% confidence
    minScore: 0.5,                 // Lowered: Min 0.5 score to trade
    rugRiskMax: 0.7,               // Raised: Max rug risk to accept
  },
  
  // Paper Trading
  paper: {
    enabled: true,
    startingCapital: 5.00,         // Your actual balance
    virtualFlashloan: true,        // Simulate flashloan capital
  }
};

// ============================================
// STATE
// ============================================
const state = {
  currentFees: {
    priority: CONFIG.fees.basePriority,
    computeUnits: 200000,
    lastUpdate: 0,
    congestionLevel: 'low',
  },
  positions: [],
  trades: [],
  stats: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    rugsAvoided: 0,
    rugsCaught: 0,
    totalPnL: 0,
    bestTrade: 0,
    worstTrade: 0,
    avgHoldTime: 0,
    feesSimulated: 0,
  },
  capital: CONFIG.paper.startingCapital,
  solPrice: 230,
  marketMomentum: 0,
};

// ============================================
// DYNAMIC FEE MANAGEMENT
// ============================================
async function updateDynamicFees() {
  try {
    // Method 1: Helius Priority Fee API
    const heliusRes = await fetch(CONFIG.heliusRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fee-estimate',
        method: 'getPriorityFeeEstimate',
        params: [{ accountKeys: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'], options: { recommended: true } }]
      })
    });
    
    const heliusData = await heliusRes.json();
    let recommendedFee = CONFIG.fees.basePriority;
    
    if (heliusData.result?.priorityFeeEstimate) {
      recommendedFee = heliusData.result.priorityFeeEstimate;
    }
    
    // Method 2: Recent block fees as backup
    const recentRes = await fetch(CONFIG.heliusRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'recent-fees',
        method: 'getRecentPrioritizationFees',
        params: []
      })
    });
    
    const recentData = await recentRes.json();
    if (recentData.result && recentData.result.length > 0) {
      const fees = recentData.result.map(f => f.prioritizationFee).filter(f => f > 0);
      if (fees.length > 0) {
        const avgRecent = fees.reduce((a, b) => a + b, 0) / fees.length;
        const maxRecent = Math.max(...fees);
        
        // Use higher of recommended or recent average
        recommendedFee = Math.max(recommendedFee, avgRecent);
        
        // Detect congestion
        if (maxRecent > avgRecent * 3) {
          state.currentFees.congestionLevel = 'high';
          recommendedFee *= CONFIG.fees.congestionMultiplier;
        } else if (maxRecent > avgRecent * 1.5) {
          state.currentFees.congestionLevel = 'medium';
          recommendedFee *= 1.5;
        } else {
          state.currentFees.congestionLevel = 'low';
        }
      }
    }
    
    // Apply bounds
    state.currentFees.priority = Math.max(
      CONFIG.fees.minPriority,
      Math.min(CONFIG.fees.maxPriority, Math.floor(recommendedFee))
    );
    
    state.currentFees.lastUpdate = Date.now();
    
  } catch (e) {
    console.error('Fee update error:', e.message);
  }
}

// Get aggressive fee for MEV-sensitive trade
function getMevFee() {
  return Math.min(
    CONFIG.fees.maxPriority,
    Math.floor(state.currentFees.priority * CONFIG.fees.mevMultiplier)
  );
}

// Calculate total fee cost in USD
function calculateFeeCost(priorityFee, computeUnits = 200000) {
  // Priority fee in lamports = (priorityFee microlamports * computeUnits) / 1,000,000
  const priorityLamports = (priorityFee * computeUnits) / 1_000_000;
  const baseLamports = 5000; // Base tx fee
  const totalLamports = priorityLamports + baseLamports;
  const solCost = totalLamports / 1_000_000_000;
  return solCost * state.solPrice;
}

// ============================================
// TOKEN DISCOVERY (Using DexScreener for real data)
// ============================================
async function fetchNewTokens() {
  try {
    // Multiple endpoints for more tokens
    const urls = [
      'https://api.dexscreener.com/latest/dex/search?q=pump',
      'https://api.dexscreener.com/latest/dex/search?q=meme',
      'https://api.dexscreener.com/latest/dex/search?q=new',
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
      'https://api.dexscreener.com/latest/dex/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC pairs
    ];
    
    const allPairs = [];
    
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000
        });
        if (!response.ok) continue;
        
        const data = await response.json();
        const pairs = data.pairs || [];
        
        // Filter for Solana and recent activity
        const solanaPairs = pairs.filter(p => 
          p.chainId === 'solana' && 
          p.liquidity?.usd > 0 &&
          p.volume?.h24 > 0
        );
        
        allPairs.push(...solanaPairs);
      } catch (e) {
        continue;
      }
    }
    
    // Dedupe by base token address
    const unique = new Map();
    for (const pair of allPairs) {
      const key = pair.baseToken?.address;
      if (key && !unique.has(key)) {
        unique.set(key, pair);
      }
    }
    
    // Sort by 1h volume (more active = better for sniping)
    return Array.from(unique.values())
      .sort((a, b) => (b.volume?.h1 || 0) - (a.volume?.h1 || 0))
      .slice(0, 50);
      
  } catch (e) {
    console.error('Token fetch error:', e.message);
    return [];
  }
}

function parseDexScreenerPair(pair) {
  const liquidity = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const volume1h = pair.volume?.h1 || 0;
  const priceUsd = parseFloat(pair.priceUsd) || 0;
  
  // Calculate age from pair creation
  const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : new Date();
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  
  // Get buy/sell counts
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  
  // Price changes
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange5m = pair.priceChange?.m5 || 0;
  
  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    price: priceUsd,
    liquidity,
    volume: volume24h,
    volume1h,
    ageHours,
    buyCount: buys1h,
    sellCount: sells1h,
    priceChange1h,
    priceChange5m,
    priceVelocity: priceChange5m / 100,
    volumeSpike: volume1h > 0 ? (volume1h * 24) / Math.max(1, volume24h) : 0,
    topHolderPct: 50, // DexScreener doesn't provide this
    dex: pair.dexId,
    pairAddress: pair.pairAddress,
    url: pair.url,
  };
}

async function getTokenDetails(pair) {
  // pair is already a DexScreener pair object
  return parseDexScreenerPair(pair);
}

// ============================================
// FLASHLOAN SIMULATION
// ============================================
function selectFlashloanTier(token, analysis) {
  // Higher score = larger loan
  const scoreMultiplier = analysis.score;
  const confidenceMultiplier = analysis.confidence;
  
  // Start with smallest tier
  let selectedTier = CONFIG.flashloanTiers[0];
  
  for (const tier of CONFIG.flashloanTiers) {
    // Need higher score/confidence for larger loans
    const requiredScore = 0.5 + (tier.amount / 100000) * 0.3;
    const requiredConfidence = 0.5 + (tier.amount / 100000) * 0.2;
    
    if (scoreMultiplier >= requiredScore && confidenceMultiplier >= requiredConfidence) {
      selectedTier = tier;
    }
  }
  
  return selectedTier;
}

function calculateFlashloanPnL(entryPrice, exitPrice, loanAmount) {
  const pricePct = ((exitPrice - entryPrice) / entryPrice) * 100;
  
  // Costs:
  // 1. Solend fee: 0.3% of loan
  const solendFee = loanAmount * CONFIG.solendFee;
  
  // 2. Gas fees (buy + sell)
  const buyFee = calculateFeeCost(getMevFee());
  const sellFee = calculateFeeCost(state.currentFees.priority);
  const totalGas = buyFee + sellFee;
  
  // 3. Slippage (simulated ~0.3%)
  const slippage = loanAmount * 0.003;
  
  // Total costs
  const totalCosts = solendFee + totalGas + slippage;
  const costsPct = (totalCosts / loanAmount) * 100;
  
  // Profit
  const grossProfit = loanAmount * (pricePct / 100);
  const netProfit = grossProfit - totalCosts;
  const netProfitPct = pricePct - costsPct;
  
  return {
    loanAmount,
    pricePct: pricePct.toFixed(2),
    solendFee: solendFee.toFixed(2),
    gasFees: totalGas.toFixed(4),
    slippage: slippage.toFixed(2),
    totalCosts: totalCosts.toFixed(2),
    costsPct: costsPct.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    netProfit: netProfit.toFixed(2),
    netProfitPct: netProfitPct.toFixed(2),
    profitable: netProfit > 0
  };
}

// ============================================
// PAPER TRADING ENGINE
// ============================================
async function simulateTrade(token, analysis, flashloanTier) {
  const entry = Date.now();
  const entryPrice = token.price;
  
  console.log(`\n🎯 PAPER TRADE: ${token.symbol || token.mint.slice(0, 8)}`);
  console.log(`   💰 Flashloan: $${flashloanTier.amount.toLocaleString()}`);
  console.log(`   📊 ML Score: ${(analysis.score * 100).toFixed(0)}% | Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  console.log(`   ⛽ Priority Fee: ${state.currentFees.priority.toLocaleString()} µL (${state.currentFees.congestionLevel})`);
  console.log(`   🎯 Target: +${CONFIG.risk.profitTarget}% | Stop: -${CONFIG.risk.stopLoss}%`);
  
  // Simulate price movement over hold time
  const holdTimeMs = Math.random() * CONFIG.risk.maxHoldTime * 1000;
  
  // Price simulation based on ML score
  // Higher score = higher chance of profit
  const baseMove = (Math.random() - 0.4) * 0.15; // -6% to +9% base
  const mlBonus = (analysis.score - 0.5) * 0.1;  // ML score influence
  const rugPenalty = analysis.rugRisk * -0.15;    // Rug risk penalty
  const priceMove = baseMove + mlBonus + rugPenalty;
  
  const exitPrice = entryPrice * (1 + priceMove);
  
  // Check for rug (fast massive drop)
  const isRug = analysis.rugRisk > 0.7 && Math.random() < analysis.rugRisk;
  const rugExitPrice = isRug ? entryPrice * (1 - (Math.random() * 0.3 + 0.2)) : exitPrice;
  const finalExitPrice = isRug ? rugExitPrice : exitPrice;
  
  // Calculate PnL
  const pnl = calculateFlashloanPnL(entryPrice, finalExitPrice, flashloanTier.amount);
  
  const exitTime = Date.now();
  const actualHoldTime = isRug ? CONFIG.risk.rugExitTime * 1000 : holdTimeMs;
  
  // Determine exit reason
  let exitReason = 'timeout';
  if (isRug) exitReason = 'rug_detected';
  else if (parseFloat(pnl.netProfitPct) >= CONFIG.risk.profitTarget) exitReason = 'target_hit';
  else if (parseFloat(pnl.netProfitPct) <= -CONFIG.risk.stopLoss) exitReason = 'stop_loss';
  
  // Record for ML
  recordTradeOutcome({
    token: {
      symbol: token.symbol,
      mint: token.mint,
      liquidity: token.liquidity,
      volume: token.volume,
      ageHours: token.ageHours,
      topHolderPct: token.topHolderPct,
    },
    entryPrice,
    exitPrice: finalExitPrice,
    profitPct: parseFloat(pnl.netProfitPct),
    holdTimeMs: actualHoldTime,
    exitReason,
    prediction: {
      score: analysis.score,
      confidence: analysis.confidence,
      rugRisk: analysis.rugRisk,
    },
    flashloanAmount: flashloanTier.amount,
    fees: {
      priority: state.currentFees.priority,
      gas: parseFloat(pnl.gasFees),
      solend: parseFloat(pnl.solendFee),
    }
  });
  
  // Update stats
  state.stats.totalTrades++;
  state.stats.feesSimulated += parseFloat(pnl.totalCosts);
  
  const netProfitNum = parseFloat(pnl.netProfit);
  state.stats.totalPnL += netProfitNum;
  
  if (netProfitNum > 0) {
    state.stats.wins++;
    state.stats.bestTrade = Math.max(state.stats.bestTrade, netProfitNum);
  } else {
    state.stats.losses++;
    state.stats.worstTrade = Math.min(state.stats.worstTrade, netProfitNum);
    if (isRug) state.stats.rugsCaught++;
  }
  
  // Print result
  const icon = netProfitNum > 0 ? '✅' : '❌';
  const rugIcon = isRug ? ' 🚨RUG' : '';
  
  console.log(`   ${icon} Result: ${pnl.netProfitPct}% ($${pnl.netProfit})${rugIcon}`);
  console.log(`   ⏱️ Hold: ${(actualHoldTime / 1000).toFixed(1)}s | Exit: ${exitReason}`);
  console.log(`   💸 Fees: $${pnl.totalCosts} (Solend: $${pnl.solendFee}, Gas: $${pnl.gasFees})`);
  
  return {
    ...pnl,
    isRug,
    exitReason,
    holdTimeMs: actualHoldTime
  };
}

// ============================================
// MAIN SCANNING LOOP
// ============================================
async function scanAndTrade() {
  console.log('\n🔍 Scanning for opportunities...');
  
  // Update fees
  await updateDynamicFees();
  
  // Fetch tokens from DexScreener
  const pairs = await fetchNewTokens();
  if (pairs.length === 0) {
    console.log('No pairs found');
    return;
  }
  
  console.log(`   Found ${pairs.length} pairs to analyze`);
  
  let analyzed = 0;
  let skipped = { liquidity: 0, volume: 0, age: 0, ml: 0, rug: 0 };
  
  // Analyze each pair
  for (const pair of pairs) {
    try {
      const token = parseDexScreenerPair(pair);
      if (!token || !token.price) continue;
      
      // Debug first 3 tokens
      if (analyzed < 3) {
        console.log(`   🔎 ${token.symbol}: liq=$${token.liquidity.toFixed(0)} vol=$${token.volume.toFixed(0)} age=${token.ageHours.toFixed(1)}h`);
      }
      
      analyzed++;
      
      // Apply filters
      if (token.liquidity < CONFIG.filters.minLiquidity) {
        skipped.liquidity++;
        continue;
      }
      if (token.liquidity > CONFIG.filters.maxLiquidity) continue;
      if (token.volume < CONFIG.filters.minVolume) {
        skipped.volume++;
        continue;
      }
      if (token.ageHours > CONFIG.filters.maxAge) {
        skipped.age++;
        continue;
      }
      
      // ML Analysis
      const analysis = analyzeToken(token, { solMomentum: state.marketMomentum });
      
      // Debug: Show token and analysis for tokens that pass filters
      console.log(`   📈 ${token.symbol}: Score=${(analysis.score * 100).toFixed(0)}% Conf=${(analysis.confidence * 100).toFixed(0)}% Rug=${(analysis.rugRisk * 100).toFixed(0)}% Should=${analysis.shouldTrade}`);
      
      // Quick rug check
      const rugCheck = quickRugCheck(token);
      if (rugCheck.isLikelyRug) {
        console.log(`   ⚠️ SKIP ${token.symbol}: ${rugCheck.warning}`);
        state.stats.rugsAvoided++;
        skipped.rug++;
        continue;
      }
      
      // Check ML thresholds
      if (!CONFIG.ml.enabled) continue;
      if (analysis.score < CONFIG.ml.minScore) {
        skipped.ml++;
        continue;
      }
      if (analysis.confidence < CONFIG.ml.minConfidence) {
        skipped.ml++;
        continue;
      }
      if (analysis.rugRisk > CONFIG.ml.rugRiskMax) {
        skipped.rug++;
        continue;
      }
      
      if (!analysis.shouldTrade) {
        skipped.ml++;
        continue;
      }
      
      // Select flashloan tier
      const tier = selectFlashloanTier(token, analysis);
      
      // Execute paper trade
      await simulateTrade(token, analysis, tier);
      
      // Small delay between trades
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (e) {
      console.error(`Error processing pair:`, e.message);
    }
  }
  
  console.log(`\n   📊 Analyzed: ${analyzed} | Skipped: liq=${skipped.liquidity} vol=${skipped.volume} age=${skipped.age} ml=${skipped.ml} rug=${skipped.rug}`);
}

// ============================================
// DISPLAY
// ============================================
function printStats() {
  const winRate = state.stats.totalTrades > 0 
    ? ((state.stats.wins / state.stats.totalTrades) * 100).toFixed(1) 
    : 0;
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FLASHLOAN PAPER TRADING STATS');
  console.log('═'.repeat(60));
  console.log(`   Total Trades: ${state.stats.totalTrades}`);
  console.log(`   Win Rate: ${winRate}% (${state.stats.wins}W / ${state.stats.losses}L)`);
  console.log(`   Total PnL: $${state.stats.totalPnL.toFixed(2)}`);
  console.log(`   Best Trade: $${state.stats.bestTrade.toFixed(2)}`);
  console.log(`   Worst Trade: $${state.stats.worstTrade.toFixed(2)}`);
  console.log(`   Fees Simulated: $${state.stats.feesSimulated.toFixed(2)}`);
  console.log(`   Rugs Avoided: ${state.stats.rugsAvoided}`);
  console.log(`   Rugs Caught: ${state.stats.rugsCaught}`);
  console.log('─'.repeat(60));
  console.log(`   Current Priority Fee: ${state.currentFees.priority.toLocaleString()} µL`);
  console.log(`   Network Congestion: ${state.currentFees.congestionLevel}`);
  console.log('═'.repeat(60));
  
  // ML Stats
  const mlStats = getModelStats();
  console.log('\n🧠 ML MODEL V2 STATS:');
  console.log(`   Accuracy: ${mlStats.accuracy}%`);
  console.log(`   Trades Learned: ${mlStats.tradesRecorded}`);
  console.log(`   Rugs Recorded: ${mlStats.rugsRecorded}`);
  console.log(`   Avg Rug Time: ${mlStats.avgRugTime}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 SCALED FLASHLOAN PAPER TRADER V2');
  console.log('═'.repeat(60));
  console.log(`   Mode: ${CONFIG.paper.enabled ? 'PAPER TRADING' : '⚠️ LIVE'}`);
  console.log(`   Flashloan Tiers: $${CONFIG.flashloanTiers[0].amount} - $${CONFIG.flashloanTiers[CONFIG.flashloanTiers.length-1].amount}`);
  console.log(`   Solend Fee: ${CONFIG.solendFee * 100}%`);
  console.log(`   Min Liquidity: $${CONFIG.filters.minLiquidity.toLocaleString()}`);
  console.log(`   ML Enabled: ${CONFIG.ml.enabled}`);
  console.log('═'.repeat(60));
  
  // Migrate old ML data
  migrateFromV1();
  
  // Initial fee update
  await updateDynamicFees();
  console.log(`\n⛽ Initial Priority Fee: ${state.currentFees.priority.toLocaleString()} µL`);
  console.log(`   Fee cost per trade: $${calculateFeeCost(state.currentFees.priority).toFixed(4)}`);
  console.log(`   MEV fee cost: $${calculateFeeCost(getMevFee()).toFixed(4)}`);
  
  // Run scans
  const scanCount = 5;
  for (let i = 0; i < scanCount; i++) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📡 SCAN ${i + 1}/${scanCount}`);
    await scanAndTrade();
    
    if (i < scanCount - 1) {
      console.log('\n⏳ Waiting 5s before next scan...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  // Final stats
  printStats();
}

// Run
main().catch(console.error);
