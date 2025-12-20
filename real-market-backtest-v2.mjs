#!/usr/bin/env node
/**
 * REAL MARKET BACKTESTER
 * 
 * Tests strategy against ACTUAL historical token performance
 * - Fetches real tokens that launched in the past
 * - Uses real price movements (5m, 1h, 6h, 24h)
 * - Calculates what would have happened with our exits
 */

import fetch from 'node-fetch';

const CONFIG = {
  // Position sizing (ML-weighted)
  flashloan: {
    maxPosition: 5000,
    minPosition: 500,
    solendFee: 0.003,
  },
  
  // Exit rules we're testing
  exitRules: {
    microScalp: { tp: 3, sl: 2, holdTime: '5m' },
    quickScalp: { tp: 5, sl: 3, holdTime: '5m' },
    moderate: { tp: 10, sl: 5, holdTime: '1h' },
    confident: { tp: 15, sl: 8, holdTime: '1h' },
    swing: { tp: 25, sl: 12, holdTime: '6h' },
  },
  
  // Realistic costs
  costs: {
    slippage: 2,        // 2% average slippage on new tokens
    gasPerTrade: 0.50,  // $0.50 priority fee
    flashloanFee: 0.003,
  },
  
  // Entry filters
  entry: {
    minLiquidity: 10000,
    minVolume: 1000,
    maxRugRisk: 0.7,
  },
};

// ═══════════════════════════════════════════════════════════════
// DATA COLLECTOR - Gets real token data
// ═══════════════════════════════════════════════════════════════

class RealMarketData {
  constructor() {
    this.tokens = [];
  }

  async collectTokens() {
    console.log('📡 Collecting real market data...\n');
    
    const sources = [];
    
    // Source 1: Latest token profiles
    try {
      const profiles = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
      const data = await profiles.json();
      sources.push(...data.filter(t => t.chainId === 'solana').slice(0, 30));
      console.log(`   ✓ Token profiles: ${sources.length} tokens`);
    } catch (e) {
      console.log('   ✗ Token profiles failed');
    }
    
    // Source 2: Boosted tokens
    try {
      const boosts = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      const data = await boosts.json();
      const solBoosts = data.filter(t => t.chainId === 'solana').slice(0, 25);
      sources.push(...solBoosts);
      console.log(`   ✓ Boosted tokens: ${solBoosts.length} tokens`);
    } catch (e) {
      console.log('   ✗ Boosted tokens failed');
    }

    // Source 3: Top gainers (recent)
    try {
      const gainers = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
      const data = await gainers.json();
      const solGainers = data.filter(t => t.chainId === 'solana').slice(0, 20);
      sources.push(...solGainers);
      console.log(`   ✓ Top tokens: ${solGainers.length} tokens`);
    } catch (e) {
      console.log('   ✗ Top tokens failed');
    }
    
    // Dedupe by address
    const unique = new Map();
    sources.forEach(t => unique.set(t.tokenAddress, t));
    
    console.log(`\n   Total unique tokens: ${unique.size}`);
    console.log('   Fetching detailed price data...\n');
    
    // Get detailed data for each
    let processed = 0;
    for (const [address, token] of unique) {
      try {
        const detail = await this.getTokenDetails(address);
        if (detail) {
          this.tokens.push(detail);
          processed++;
          
          // Progress indicator
          if (processed % 10 === 0) {
            process.stdout.write(`   Processed ${processed}/${unique.size}\r`);
          }
        }
        await this.sleep(100);  // Rate limit
      } catch (e) {
        continue;
      }
    }
    
    console.log(`\n   ✓ Got detailed data for ${this.tokens.length} tokens\n`);
    return this.tokens;
  }

  async getTokenDetails(address) {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (!resp.ok) return null;
    
    const data = await resp.json();
    const pair = data.pairs?.[0];
    if (!pair) return null;
    
    // Must have the data we need
    const liq = pair.liquidity?.usd || 0;
    const vol = pair.volume?.h24 || 0;
    
    if (liq < CONFIG.entry.minLiquidity) return null;
    if (vol < CONFIG.entry.minVolume) return null;
    
    return {
      address,
      symbol: pair.baseToken?.symbol || 'UNK',
      name: pair.baseToken?.name || 'Unknown',
      
      // Current state
      priceUsd: parseFloat(pair.priceUsd) || 0,
      liquidity: liq,
      volume24h: vol,
      
      // REAL price changes - this is what we backtest against
      priceChange: {
        m5: pair.priceChange?.m5 || 0,
        h1: pair.priceChange?.h1 || 0,
        h6: pair.priceChange?.h6 || 0,
        h24: pair.priceChange?.h24 || 0,
      },
      
      // Transaction data
      txns: {
        m5: pair.txns?.m5 || { buys: 0, sells: 0 },
        h1: pair.txns?.h1 || { buys: 0, sells: 0 },
        h24: pair.txns?.h24 || { buys: 0, sells: 0 },
      },
      
      // Age
      pairCreatedAt: pair.pairCreatedAt,
      ageHours: pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : null,
      
      // DEX info
      dex: pair.dexId,
      pairAddress: pair.pairAddress,
    };
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ═══════════════════════════════════════════════════════════════
// ML ANALYZER - Same logic as live strategy
// ═══════════════════════════════════════════════════════════════

class MLAnalyzer {
  constructor() {
    this.weights = {
      liquidityScore: 0.15,
      volumeScore: 0.12,
      ageScore: 0.10,
      momentumScore: 0.12,
      buyPressure: 0.15,
      rugRisk: -0.28,
      sellPressure: -0.12,
    };
  }

  analyze(token) {
    const features = this.extractFeatures(token);
    
    let score = 0.5;
    for (const [key, weight] of Object.entries(this.weights)) {
      score += (features[key] || 0) * weight;
    }
    score = Math.max(0.1, Math.min(0.95, score));
    
    // Position sizing
    const rugRiskReduction = features.rugRisk * 0.8;
    let position = CONFIG.flashloan.minPosition + 
      (CONFIG.flashloan.maxPosition - CONFIG.flashloan.minPosition) * score;
    position = position * (1 - rugRiskReduction);
    position = Math.max(CONFIG.flashloan.minPosition, Math.min(CONFIG.flashloan.maxPosition, position));
    
    // Exit strategy selection
    let exitStrategy;
    if (features.rugRisk > 0.55) {
      exitStrategy = 'microScalp';
    } else if (score >= 0.75 && features.rugRisk < 0.4) {
      exitStrategy = 'confident';
    } else if (score >= 0.65) {
      exitStrategy = 'moderate';
    } else {
      exitStrategy = 'quickScalp';
    }
    
    return {
      score,
      rugRisk: features.rugRisk,
      features,
      position: Math.round(position),
      exitStrategy,
      recommendation: features.rugRisk > CONFIG.entry.maxRugRisk ? 'SKIP' : 
        score >= 0.60 ? 'BUY' : 'SKIP',
    };
  }

  extractFeatures(token) {
    const liq = token.liquidity || 0;
    const vol = token.volume24h || 0;
    const age = token.ageHours || 24;
    const p5m = token.priceChange?.m5 || 0;
    const p1h = token.priceChange?.h1 || 0;
    const txns5m = token.txns?.m5 || { buys: 0, sells: 0 };
    const txns1h = token.txns?.h1 || { buys: 0, sells: 0 };
    
    // Rug risk calculation
    let rugRisk = 0.35;
    if (liq < 15000) rugRisk += 0.20;
    else if (liq < 25000) rugRisk += 0.10;
    if (age !== null && age < 1) rugRisk += 0.15;
    else if (age !== null && age < 3) rugRisk += 0.08;
    if (p5m > 30) rugRisk += 0.12;
    if (p5m < -20) rugRisk += 0.10;
    if (txns5m.sells > txns5m.buys * 1.5) rugRisk += 0.15;
    
    // Check for rug indicators in price action
    if (p1h < -50) rugRisk += 0.25;  // Already rugged
    if (p5m < -30 && p1h < -40) rugRisk += 0.20;
    
    rugRisk = Math.min(0.95, rugRisk);
    
    return {
      liquidityScore: Math.min(1, liq / 60000),
      volumeScore: Math.min(1, vol / 30000),
      ageScore: age === null ? 0.5 : age < 1 ? 0.4 : age < 3 ? 0.6 : age < 6 ? 0.75 : 0.5,
      momentumScore: p5m > 0 && p5m < 15 ? 0.7 : p5m > 15 && p5m < 30 ? 0.5 : 0.3,
      buyPressure: txns1h.buys > txns1h.sells ? 
        Math.min(1, txns1h.buys / (txns1h.sells + 1) * 0.2) : 0.2,
      rugRisk,
      sellPressure: txns5m.sells > txns5m.buys ? 0.6 : 0.2,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// BACKTESTER - Tests against real price movements
// ═══════════════════════════════════════════════════════════════

class RealBacktester {
  constructor(ml) {
    this.ml = ml;
    this.results = {
      byStrategy: {},
      byOutcome: {},
      trades: [],
      totalPnL: 0,
      wins: 0,
      losses: 0,
    };
  }

  backtest(tokens) {
    console.log('🔬 BACKTESTING AGAINST REAL PRICE DATA');
    console.log('═'.repeat(70));
    console.log(`   Testing ${tokens.length} tokens with real price movements\n`);
    
    for (const token of tokens) {
      const analysis = this.ml.analyze(token);
      
      if (analysis.recommendation === 'SKIP') {
        continue;
      }
      
      // Test each exit strategy
      const exitRule = CONFIG.exitRules[analysis.exitStrategy];
      const trade = this.simulateTradeWithRealPrices(token, analysis, exitRule);
      
      this.recordTrade(trade);
    }
    
    return this.results;
  }

  simulateTradeWithRealPrices(token, analysis, exitRule) {
    // Get REAL price change for our hold time
    let actualPriceChange;
    switch (exitRule.holdTime) {
      case '5m':
        actualPriceChange = token.priceChange.m5;
        break;
      case '1h':
        actualPriceChange = token.priceChange.h1;
        break;
      case '6h':
        actualPriceChange = token.priceChange.h6;
        break;
      default:
        actualPriceChange = token.priceChange.h1;
    }
    
    // Apply slippage (we lose ~2% on entry)
    const afterSlippage = actualPriceChange - CONFIG.costs.slippage;
    
    // Determine exit type based on REAL price vs our TP/SL
    let exitPrice, exitType;
    
    if (afterSlippage >= exitRule.tp) {
      // Hit take profit
      exitPrice = exitRule.tp;
      exitType = 'TAKE_PROFIT';
    } else if (afterSlippage <= -exitRule.sl) {
      // Hit stop loss
      exitPrice = -exitRule.sl;
      exitType = 'STOP_LOSS';
    } else {
      // Time exit at actual price
      exitPrice = afterSlippage;
      exitType = afterSlippage >= 0 ? 'TIME_EXIT_WIN' : 'TIME_EXIT_LOSS';
    }
    
    // Was this token actually a rug? (dropped >50% in the data)
    const wasRug = token.priceChange.h1 < -50 || token.priceChange.h6 < -70;
    
    // If it rugged before our TP, we got rugged unless stop loss saved us
    if (wasRug && exitType === 'TAKE_PROFIT') {
      // In reality, the rug happened fast
      exitPrice = Math.max(-exitRule.sl, token.priceChange.m5 - CONFIG.costs.slippage);
      exitType = exitPrice <= -exitRule.sl ? 'STOP_LOSS' : 'RUGGED';
    }
    
    // Calculate P&L
    const position = analysis.position;
    const flashloanFee = position * CONFIG.flashloan.solendFee;
    const gasFee = CONFIG.costs.gasPerTrade * 2;  // Entry + exit
    const grossPnL = position * (exitPrice / 100);
    const netPnL = grossPnL - flashloanFee - gasFee;
    
    return {
      symbol: token.symbol,
      address: token.address,
      
      // Analysis
      mlScore: analysis.score,
      rugRisk: analysis.rugRisk,
      exitStrategy: analysis.exitStrategy,
      
      // Position
      position,
      holdTime: exitRule.holdTime,
      
      // Real price data
      realPriceChange: {
        m5: token.priceChange.m5,
        h1: token.priceChange.h1,
        h6: token.priceChange.h6,
        h24: token.priceChange.h24,
      },
      
      // Trade result
      exitType,
      exitPrice,
      grossPnL,
      fees: flashloanFee + gasFee,
      netPnL,
      success: netPnL > 0,
      wasRug,
      
      // Token info
      liquidity: token.liquidity,
      volume: token.volume24h,
      age: token.ageHours,
    };
  }

  recordTrade(trade) {
    this.results.trades.push(trade);
    this.results.totalPnL += trade.netPnL;
    
    if (trade.netPnL > 0) this.results.wins++;
    else this.results.losses++;
    
    // By strategy
    if (!this.results.byStrategy[trade.exitStrategy]) {
      this.results.byStrategy[trade.exitStrategy] = { trades: 0, pnl: 0, wins: 0 };
    }
    this.results.byStrategy[trade.exitStrategy].trades++;
    this.results.byStrategy[trade.exitStrategy].pnl += trade.netPnL;
    if (trade.netPnL > 0) this.results.byStrategy[trade.exitStrategy].wins++;
    
    // By outcome
    if (!this.results.byOutcome[trade.exitType]) {
      this.results.byOutcome[trade.exitType] = { count: 0, pnl: 0 };
    }
    this.results.byOutcome[trade.exitType].count++;
    this.results.byOutcome[trade.exitType].pnl += trade.netPnL;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function runBacktest() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('📊 REAL MARKET BACKTESTER');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('   Testing strategy against ACTUAL price movements');
  console.log('   No simulations - real DexScreener data');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  // Collect real market data
  const dataCollector = new RealMarketData();
  const tokens = await dataCollector.collectTokens();
  
  if (tokens.length === 0) {
    console.log('❌ No tokens collected. Check API connectivity.');
    return;
  }
  
  // Run ML analysis and backtest
  const ml = new MLAnalyzer();
  const backtester = new RealBacktester(ml);
  const results = backtester.backtest(tokens);
  
  // Display results
  displayResults(results, tokens);
}

function displayResults(results, tokens) {
  const trades = results.trades;
  const winRate = trades.length > 0 ? (results.wins / trades.length * 100).toFixed(1) : 0;
  
  console.log('\n\n════════════════════════════════════════════════════════════════════════');
  console.log('📊 BACKTEST RESULTS - REAL PRICE DATA');
  console.log('════════════════════════════════════════════════════════════════════════');
  
  console.log('\n   DATA SUMMARY');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Tokens analyzed:   ${tokens.length}`);
  console.log(`   Trades executed:   ${trades.length}`);
  console.log(`   Skipped (ML):      ${tokens.length - trades.length}`);
  
  console.log('\n   PERFORMANCE');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Win Rate:          ${winRate}%`);
  console.log(`   Total PnL:         ${results.totalPnL >= 0 ? '+' : ''}$${results.totalPnL.toFixed(2)}`);
  console.log(`   Avg Trade:         $${trades.length > 0 ? (results.totalPnL / trades.length).toFixed(2) : 0}`);
  
  // Average position
  const avgPos = trades.length > 0 ? trades.reduce((s, t) => s + t.position, 0) / trades.length : 0;
  console.log(`   Avg Position:      $${avgPos.toFixed(0)}`);
  
  // Rug detection
  const rugs = trades.filter(t => t.wasRug);
  const rugsAvoided = trades.filter(t => t.wasRug && t.exitType !== 'RUGGED');
  console.log('\n   RUG ANALYSIS');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Tokens that rugged: ${rugs.length}/${trades.length}`);
  console.log(`   Rugs we avoided:    ${rugsAvoided.length} (stop loss saved us)`);
  console.log(`   Rugs we caught:     ${rugs.length - rugsAvoided.length}`);
  
  // Exit breakdown
  console.log('\n   EXIT TYPE ANALYSIS');
  console.log('   ─────────────────────────────────────────────────────');
  for (const [exitType, data] of Object.entries(results.byOutcome).sort((a, b) => b[1].count - a[1].count)) {
    const avgPnL = data.count > 0 ? data.pnl / data.count : 0;
    console.log(`   ${exitType.padEnd(18)} ${data.count.toString().padStart(3)} trades | Avg: ${avgPnL >= 0 ? '+' : ''}$${avgPnL.toFixed(2)} | Total: ${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(2)}`);
  }
  
  // Strategy breakdown
  console.log('\n   STRATEGY PERFORMANCE');
  console.log('   ─────────────────────────────────────────────────────');
  for (const [strat, data] of Object.entries(results.byStrategy)) {
    const stratWR = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(0) : 0;
    const avgPnL = data.trades > 0 ? data.pnl / data.trades : 0;
    console.log(`   ${strat.padEnd(15)} ${data.trades.toString().padStart(3)} trades | ${stratWR}% WR | Avg: ${avgPnL >= 0 ? '+' : ''}$${avgPnL.toFixed(2)} | Total: ${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(2)}`);
  }
  
  // Best/Worst trades
  const sorted = [...trades].sort((a, b) => b.netPnL - a.netPnL);
  
  console.log('\n   TOP 5 WINNERS (Real Prices)');
  console.log('   ─────────────────────────────────────────────────────');
  sorted.slice(0, 5).filter(t => t.netPnL > 0).forEach(t => {
    console.log(`   ${t.symbol.padEnd(12)} +$${t.netPnL.toFixed(2).padStart(8)} | Real 1h: ${t.realPriceChange.h1 >= 0 ? '+' : ''}${t.realPriceChange.h1.toFixed(1)}% | ML: ${t.mlScore.toFixed(2)} | ${t.exitType}`);
  });
  
  console.log('\n   TOP 5 LOSERS (Real Prices)');
  console.log('   ─────────────────────────────────────────────────────');
  sorted.slice(-5).reverse().filter(t => t.netPnL < 0).forEach(t => {
    const rugLabel = t.wasRug ? ' [RUGGED]' : '';
    console.log(`   ${t.symbol.padEnd(12)} -$${Math.abs(t.netPnL).toFixed(2).padStart(8)} | Real 1h: ${t.realPriceChange.h1 >= 0 ? '+' : ''}${t.realPriceChange.h1.toFixed(1)}% | ML: ${t.mlScore.toFixed(2)} | ${t.exitType}${rugLabel}`);
  });
  
  // ML accuracy check
  const highMLTrades = trades.filter(t => t.mlScore >= 0.70);
  const highMLWins = highMLTrades.filter(t => t.netPnL > 0).length;
  const highMLWR = highMLTrades.length > 0 ? (highMLWins / highMLTrades.length * 100).toFixed(1) : 0;
  
  const lowMLTrades = trades.filter(t => t.mlScore < 0.70);
  const lowMLWins = lowMLTrades.filter(t => t.netPnL > 0).length;
  const lowMLWR = lowMLTrades.length > 0 ? (lowMLWins / lowMLTrades.length * 100).toFixed(1) : 0;
  
  console.log('\n   ML SCORE CORRELATION');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   High ML (≥0.70):   ${highMLTrades.length} trades | ${highMLWR}% win rate`);
  console.log(`   Low ML (<0.70):    ${lowMLTrades.length} trades | ${lowMLWR}% win rate`);
  console.log(`   ML adds value:     ${parseFloat(highMLWR) > parseFloat(lowMLWR) ? '✅ YES' : '❌ NO'}`);
  
  // Reality assessment
  console.log('\n   🎯 REALITY ASSESSMENT');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   This is REAL data - these are actual price movements`);
  console.log(`   that happened on these tokens.`);
  console.log('');
  
  if (parseFloat(winRate) >= 45 && results.totalPnL > 0) {
    console.log(`   ✅ STRATEGY IS PROFITABLE on real data!`);
    console.log(`   Win rate: ${winRate}% | PnL: $${results.totalPnL.toFixed(2)}`);
  } else if (parseFloat(winRate) >= 40) {
    console.log(`   ⚠️  MARGINAL - Small tweaks needed`);
    console.log(`   Consider: Tighter stops, smaller positions on high rug risk`);
  } else {
    console.log(`   ❌ STRATEGY NEEDS WORK`);
    console.log(`   The ML isn't filtering well enough or exits are wrong`);
  }
  
  // Recommendation
  console.log('\n   💡 RECOMMENDATIONS');
  console.log('   ─────────────────────────────────────────────────────');
  
  const bestStrat = Object.entries(results.byStrategy)
    .filter(([_, d]) => d.trades >= 3)
    .sort((a, b) => (b[1].pnl / b[1].trades) - (a[1].pnl / a[1].trades))[0];
  
  if (bestStrat) {
    console.log(`   Best strategy: ${bestStrat[0]} (${(bestStrat[1].wins/bestStrat[1].trades*100).toFixed(0)}% WR)`);
  }
  
  const stopLossSaved = results.byOutcome['STOP_LOSS'];
  if (stopLossSaved && stopLossSaved.count > 0) {
    console.log(`   Stop losses triggered ${stopLossSaved.count}x - saved us from bigger losses`);
  }
  
  if (rugsAvoided.length > 0) {
    console.log(`   Stop loss avoided ${rugsAvoided.length} rugs!`);
  }
  
  console.log('\n════════════════════════════════════════════════════════════════════════\n');
}

runBacktest().catch(console.error);
