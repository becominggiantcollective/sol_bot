#!/usr/bin/env node
/**
 * CONSERVATIVE FLASHLOAN SNIPER v4
 * 
 * Key changes from v3:
 * - MUCH smaller position sizes when rug risk is high
 * - ML must be >85% confident for big positions
 * - Ultra-fast exits on any negative signal
 * - Tiny scalps (3-5%) are the goal, not big wins
 */

import fetch from 'node-fetch';

const CONFIG = {
  jupiterApiKey: process.env.JUPITER_API_KEY,
  
  // Conservative flashloan sizing - rug risk weighted
  flashloan: {
    // Position size = base * (1 - rugRisk)
    maxPosition: 5000,      // Max $5K even at highest confidence
    minPosition: 500,       // Min $500 
    rugRiskMultiplier: 0.8, // Reduce position by up to 80% based on rug risk
    solendFee: 0.003,
  },
  
  // Ultra-aggressive exit strategy
  exit: {
    // Take ANY profit quickly
    quickTakeProfit: 3,     // Exit at +3%
    mediumTakeProfit: 8,    // Exit at +8% if ML confident
    maxTakeProfit: 15,      // Never hold for more than +15%
    
    // Tight stop losses
    quickStopLoss: 2,       // Exit at -2% for low confidence
    mediumStopLoss: 5,      // Exit at -5% for medium
    maxStopLoss: 8,         // Never lose more than 8%
    
    // Time limits (seconds)
    microHold: 15,          // 15 seconds for risky trades
    quickHold: 45,          // 45 seconds normal
    maxHold: 120,           // 2 minutes max
  },
  
  // Filter settings
  entry: {
    minLiquidity: 15000,
    maxAge: 4,
    minVolume: 2000,
    maxRugRisk: 0.65,       // Skip if rug risk > 65%
  },
  
  // Realistic conditions
  reality: {
    rugRate: 0.75,
    mevRate: 0.20,
    slippageRange: [0.5, 8],
    execFailRate: 0.10,
    gasMultiplier: 2.0,
  },
};

// ═══════════════════════════════════════════════════════════════
// CONSERVATIVE ML - RISK FIRST
// ═══════════════════════════════════════════════════════════════

class ConservativeML {
  constructor() {
    this.weights = {
      liquidityScore: 0.12,
      volumeScore: 0.10,
      ageScore: 0.10,
      momentum: 0.12,
      buyPressure: 0.14,
      rugRisk: -0.32,        // Heavy rug penalty
      sellPressure: -0.10,
    };
    this.trades = [];
    this.accuracy = 0.5;
  }

  predict(token, activity = {}) {
    const features = this.extractFeatures(token, activity);
    
    // Calculate base score
    let score = 0.5;
    for (const [key, weight] of Object.entries(this.weights)) {
      score += (features[key] || 0) * weight;
    }
    score = Math.max(0.1, Math.min(0.95, score));
    
    // Calculate position size based on score AND rug risk
    const positionSize = this.calculatePositionSize(score, features.rugRisk);
    
    // Calculate exit params
    const exitParams = this.calculateExitParams(score, features.rugRisk);
    
    return {
      score,
      rugRisk: features.rugRisk,
      recommendation: this.getRecommendation(score, features),
      positionSize,
      exitParams,
      features,
    };
  }

  extractFeatures(token, activity) {
    const liq = token.liquidity?.usd || 0;
    const vol = token.volume?.h24 || 0;
    const age = token.pairCreatedAt ? (Date.now() - token.pairCreatedAt) / 3600000 : 24;
    const p5m = token.priceChange?.m5 || 0;
    const p1h = token.priceChange?.h1 || 0;
    const txns5m = token.txns?.m5 || { buys: 0, sells: 0 };
    const txns1h = token.txns?.h1 || { buys: 0, sells: 0 };
    
    // Calculate rug risk (0-1)
    let rugRisk = 0.35;  // Base
    
    // Liquidity factors
    if (liq < 15000) rugRisk += 0.20;
    else if (liq < 25000) rugRisk += 0.10;
    else if (liq > 50000) rugRisk -= 0.05;
    
    // Age factors
    if (age < 0.5) rugRisk += 0.20;
    else if (age < 1) rugRisk += 0.10;
    else if (age > 3) rugRisk -= 0.05;
    
    // Price action factors
    if (p5m > 30) rugRisk += 0.15;  // Pump before dump
    if (p5m < -20) rugRisk += 0.10; // Already dumping
    
    // Sell pressure
    if (txns5m.sells > txns5m.buys * 1.5) rugRisk += 0.15;
    
    // Activity signals
    if (activity.isDumping) rugRisk += 0.20;
    
    rugRisk = Math.max(0.1, Math.min(0.95, rugRisk));
    
    return {
      liquidityScore: Math.min(1, liq / 60000),
      volumeScore: Math.min(1, vol / 25000),
      ageScore: age < 0.5 ? 0.3 : age < 1 ? 0.5 : age < 2 ? 0.7 : age < 4 ? 0.8 : 0.6,
      momentum: p5m > 0 && p5m < 15 ? 0.7 : p5m > 15 ? 0.3 : 0.4,
      buyPressure: txns1h.buys > txns1h.sells ? Math.min(1, txns1h.buys / (txns1h.sells + 1) * 0.25) : 0.2,
      rugRisk,
      sellPressure: txns5m.sells > txns5m.buys ? 0.6 : 0.2,
    };
  }

  calculatePositionSize(score, rugRisk) {
    // Base position from score
    let position = CONFIG.flashloan.minPosition + 
      (CONFIG.flashloan.maxPosition - CONFIG.flashloan.minPosition) * score;
    
    // Reduce by rug risk
    const riskReduction = rugRisk * CONFIG.flashloan.rugRiskMultiplier;
    position = position * (1 - riskReduction);
    
    // Clamp to limits
    return Math.max(CONFIG.flashloan.minPosition, Math.min(CONFIG.flashloan.maxPosition, position));
  }

  calculateExitParams(score, rugRisk) {
    // Higher rug risk = faster exits, tighter stops
    let tp, sl, hold, strategy;
    
    if (rugRisk > 0.55) {
      // High risk - micro scalp
      tp = CONFIG.exit.quickTakeProfit;
      sl = CONFIG.exit.quickStopLoss;
      hold = CONFIG.exit.microHold;
      strategy = 'MICRO_SCALP';
    } else if (score >= 0.75 && rugRisk < 0.45) {
      // Low risk, high confidence - can hold longer
      tp = CONFIG.exit.mediumTakeProfit;
      sl = CONFIG.exit.mediumStopLoss;
      hold = CONFIG.exit.quickHold;
      strategy = 'CONFIDENT_SCALP';
    } else {
      // Default quick scalp
      tp = CONFIG.exit.quickTakeProfit + 2;
      sl = CONFIG.exit.quickStopLoss + 2;
      hold = CONFIG.exit.quickHold;
      strategy = 'QUICK_SCALP';
    }
    
    return { takeProfit: tp, stopLoss: sl, maxHold: hold, strategy };
  }

  getRecommendation(score, features) {
    if (features.rugRisk > CONFIG.entry.maxRugRisk) return 'SKIP';
    if (score >= 0.65) return 'BUY';
    if (score >= 0.55 && features.rugRisk < 0.5) return 'SCALP';
    return 'SKIP';
  }

  learn(trade) {
    this.trades.push(trade);
    const recent = this.trades.slice(-30);
    const wins = recent.filter(t => t.profit > 0).length;
    this.accuracy = recent.length > 0 ? wins / recent.length : 0.5;
    
    // If we're getting rugged a lot, increase rug weight
    const rugs = recent.filter(t => t.wasRug).length;
    if (rugs > recent.length * 0.6) {
      this.weights.rugRisk = Math.max(-0.45, this.weights.rugRisk - 0.02);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY SCANNER
// ═══════════════════════════════════════════════════════════════

class ActivityScanner {
  async scan(tokenAddress) {
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (!resp.ok) return { isDumping: false };
      
      const data = await resp.json();
      const pair = data.pairs?.[0];
      if (!pair) return { isDumping: false };
      
      const txns5m = pair.txns?.m5 || { buys: 0, sells: 0 };
      const p5m = pair.priceChange?.m5 || 0;
      
      return {
        isDumping: txns5m.sells > txns5m.buys * 1.5 || p5m < -15,
        isHot: txns5m.buys > 10 && p5m > 5,
        velocity: txns5m.buys + txns5m.sells,
      };
    } catch {
      return { isDumping: false };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONSERVATIVE SNIPER
// ═══════════════════════════════════════════════════════════════

class ConservativeSniper {
  constructor(ml, scanner) {
    this.ml = ml;
    this.scanner = scanner;
    this.results = {
      trades: [],
      totalPnL: 0,
      wins: 0,
      losses: 0,
      rugsAvoided: 0,
      rugsCaught: 0,
      quickExits: 0,
    };
    this.seen = new Set();
  }

  async findTokens() {
    const candidates = [];
    
    try {
      const [profiles, boosts] = await Promise.all([
        fetch('https://api.dexscreener.com/token-profiles/latest/v1').then(r => r.json()),
        fetch('https://api.dexscreener.com/token-boosts/latest/v1').then(r => r.json()),
      ]);
      
      const all = [
        ...profiles.filter(p => p.chainId === 'solana').slice(0, 20),
        ...boosts.filter(b => b.chainId === 'solana').slice(0, 15),
      ];
      
      const unique = new Map();
      all.forEach(t => unique.set(t.tokenAddress, t));
      
      for (const token of unique.values()) {
        if (this.seen.has(token.tokenAddress)) continue;
        
        try {
          const pairResp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
          if (!pairResp.ok) continue;
          
          const data = await pairResp.json();
          const pair = data.pairs?.[0];
          if (!pair) continue;
          
          const liq = pair.liquidity?.usd || 0;
          const vol = pair.volume?.h24 || 0;
          const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;
          
          if (liq >= CONFIG.entry.minLiquidity && 
              age <= CONFIG.entry.maxAge && 
              vol >= CONFIG.entry.minVolume) {
            candidates.push({ ...pair, tokenAddress: token.tokenAddress, age });
          }
          
          await new Promise(r => setTimeout(r, 80));
        } catch { continue; }
      }
    } catch { }
    
    return candidates;
  }

  async trade(token) {
    this.seen.add(token.tokenAddress);
    
    const activity = await this.scanner.scan(token.tokenAddress);
    if (activity.isDumping) return { skipped: true, reason: 'DUMPING' };
    
    const pred = this.ml.predict(token, activity);
    
    if (pred.recommendation === 'SKIP') {
      return { skipped: true, reason: 'ML_SKIP', score: pred.score, rugRisk: pred.rugRisk };
    }
    
    // Simulate trade
    const result = await this.simulateTrade(token, pred, activity);
    
    this.results.trades.push(result);
    this.results.totalPnL += result.profit;
    if (result.profit > 0) this.results.wins++;
    else this.results.losses++;
    if (result.exitReason === 'QUICK_EXIT') this.results.quickExits++;
    if (result.wasRug && result.profit < -result.positionSize * 0.3) this.results.rugsCaught++;
    
    this.ml.learn({ profit: result.profit, wasRug: result.wasRug });
    
    return result;
  }

  async simulateTrade(token, pred, activity) {
    const symbol = token.baseToken?.symbol || 'UNK';
    const positionSize = pred.positionSize;
    const exit = pred.exitParams;
    
    // Determine outcomes
    const willRug = Math.random() < CONFIG.reality.rugRate;
    const rugTime = willRug ? 5 + Math.random() * 150 : null;
    const frontRun = Math.random() < CONFIG.reality.mevRate;
    const execFail = Math.random() < CONFIG.reality.execFailRate;
    const slippage = CONFIG.reality.slippageRange[0] + 
      Math.random() * (CONFIG.reality.slippageRange[1] - CONFIG.reality.slippageRange[0]);
    
    if (execFail) {
      const gas = CONFIG.flashloan.solendFee * 124 * CONFIG.reality.gasMultiplier;
      return this.createResult(symbol, token, positionSize, pred, 'TX_FAILED', 0, 0, gas, -gas, false);
    }
    
    // Our exit time based on ML confidence (higher confidence = slightly longer hold)
    // But with conservative approach, we exit FAST
    const confidenceFactor = 0.5 + (1 - pred.score) * 0.3;  // 0.5-0.8
    const ourExitTime = exit.maxHold * confidenceFactor;
    
    let priceChange, exitReason, holdTime;
    
    if (willRug && rugTime !== null) {
      if (ourExitTime < rugTime) {
        // We got out before rug!
        const holdRatio = ourExitTime / rugTime;
        // Small profit since we exited early
        priceChange = 1 + Math.random() * (exit.takeProfit * holdRatio * 0.5);
        exitReason = 'QUICK_EXIT';
        holdTime = ourExitTime;
        this.results.rugsAvoided++;
      } else {
        // Caught in rug - but with tight stop loss, maybe we got out
        const hitStopLoss = Math.random() < 0.4;  // 40% chance our stop saved us
        if (hitStopLoss) {
          priceChange = -exit.stopLoss;
          exitReason = 'STOP_LOSS';
          holdTime = rugTime * 0.7;
        } else {
          priceChange = -50 - Math.random() * 40;
          exitReason = 'RUGGED';
          holdTime = rugTime;
        }
      }
    } else if (frontRun) {
      priceChange = -slippage - Math.random() * 2;
      exitReason = 'FRONT_RUN';
      holdTime = 3;
    } else {
      // Normal trade with ML bias
      const mlBias = (pred.score - 0.5) * 15;
      const noise = (Math.random() - 0.45) * 20;
      priceChange = mlBias + noise;
      
      // Apply tight TP/SL
      if (priceChange >= exit.takeProfit) {
        priceChange = exit.takeProfit;
        exitReason = 'TAKE_PROFIT';
      } else if (priceChange <= -exit.stopLoss) {
        priceChange = -exit.stopLoss;
        exitReason = 'STOP_LOSS';
      } else {
        exitReason = 'TIME_EXIT';
      }
      holdTime = Math.random() * exit.maxHold;
    }
    
    const effectiveChange = priceChange - slippage;
    const fees = (positionSize * CONFIG.flashloan.solendFee) + 
      (CONFIG.flashloan.solendFee * 124 * CONFIG.reality.gasMultiplier * 2);
    const grossPnL = positionSize * (effectiveChange / 100);
    const netPnL = grossPnL - fees;
    
    return this.createResult(symbol, token, positionSize, pred, exitReason, 
      effectiveChange, slippage, fees, netPnL, willRug && exitReason === 'RUGGED', rugTime, holdTime);
  }

  createResult(symbol, token, size, pred, exitReason, change, slip, fees, profit, wasRug, rugTime, hold) {
    return {
      timestamp: new Date().toISOString(),
      token: symbol,
      tokenAddress: token.tokenAddress,
      positionSize: Math.round(size),
      mlScore: pred.score.toFixed(3),
      rugRisk: pred.rugRisk.toFixed(2),
      strategy: pred.exitParams.strategy,
      exitReason,
      holdTime: hold?.toFixed(1) || '0',
      priceChange: change.toFixed(2),
      slippage: slip.toFixed(2),
      fees: fees.toFixed(2),
      profit,
      success: profit > 0,
      wasRug,
      rugTime: rugTime?.toFixed(1),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function run() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('🎯 CONSERVATIVE FLASHLOAN SNIPER v4');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('   Strategy: Small positions, quick exits, tiny scalps');
  console.log('   • Position size scaled DOWN by rug risk');
  console.log('   • Take profit: 3-8% (not greedy)');
  console.log('   • Stop loss: 2-5% (tight protection)');
  console.log('   • Max hold: 15-45 seconds');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  const ml = new ConservativeML();
  const scanner = new ActivityScanner();
  const sniper = new ConservativeSniper(ml, scanner);
  
  const startTime = Date.now();
  const runDuration = 180000;
  let round = 0;
  let scanned = 0;
  let skipped = 0;

  while (Date.now() - startTime < runDuration) {
    round++;
    console.log(`\n🔄 ROUND ${round}`);
    console.log('─'.repeat(70));

    const tokens = await sniper.findTokens();
    scanned += tokens.length;
    
    if (tokens.length === 0) {
      console.log('   No new qualifying tokens');
    } else {
      console.log(`   Found ${tokens.length} tokens\n`);
    }

    for (const token of tokens.slice(0, 6)) {
      const result = await sniper.trade(token);
      
      if (result.skipped) {
        skipped++;
        console.log(`   ⏭️  ${(token.baseToken?.symbol || 'UNK').padEnd(10)} SKIP | ${result.reason} | ML: ${result.score?.toFixed(2) || '-'} | Rug: ${((result.rugRisk || 0) * 100).toFixed(0)}%`);
        continue;
      }
      
      const icon = result.success ? '✅' : result.wasRug ? '💀' : '❌';
      const pnl = result.profit >= 0 ? `+$${result.profit.toFixed(2)}` : `-$${Math.abs(result.profit).toFixed(2)}`;
      
      console.log(`   ${icon} ${result.token.padEnd(10)} | $${result.positionSize.toLocaleString().padStart(5)} FL | ML: ${result.mlScore} | Rug: ${(result.rugRisk * 100).toFixed(0)}%`);
      console.log(`      ${result.strategy.padEnd(15)} | ${result.exitReason.padEnd(12)} | ${result.priceChange.padStart(6)}% | ${result.holdTime}s | ${pnl}`);
      
      if (result.exitReason === 'QUICK_EXIT') {
        console.log(`      🎯 EARLY EXIT - Avoided potential rug!`);
      }
      
      await new Promise(r => setTimeout(r, 150));
    }
    
    const s = sniper.results;
    const wr = s.trades.length > 0 ? (s.wins / s.trades.length * 100).toFixed(1) : 0;
    console.log(`\n   📊 ${s.trades.length} trades | ${wr}% WR | PnL: ${s.totalPnL >= 0 ? '+' : ''}$${s.totalPnL.toFixed(2)} | Quick: ${s.quickExits} | Rugs: ${s.rugsCaught}`);
    
    await new Promise(r => setTimeout(r, 4000));
  }

  showResults(sniper, ml, scanned, skipped);
}

function showResults(sniper, ml, scanned, skipped) {
  const s = sniper.results;
  const wr = s.trades.length > 0 ? (s.wins / s.trades.length * 100).toFixed(1) : 0;
  
  console.log('\n\n════════════════════════════════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════');
  
  console.log('\n   STATISTICS');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Scanned:      ${scanned} tokens`);
  console.log(`   Skipped:      ${skipped} (ML filtered)`);
  console.log(`   Trades:       ${s.trades.length}`);
  console.log(`   Win Rate:     ${wr}%`);
  console.log(`   Total PnL:    ${s.totalPnL >= 0 ? '+' : ''}$${s.totalPnL.toFixed(2)}`);
  console.log(`   Avg Trade:    $${s.trades.length > 0 ? (s.totalPnL / s.trades.length).toFixed(2) : 0}`);
  
  // Position size analysis
  const avgPosition = s.trades.length > 0 ? 
    s.trades.reduce((sum, t) => sum + t.positionSize, 0) / s.trades.length : 0;
  console.log(`   Avg Position: $${avgPosition.toFixed(0)}`);
  
  console.log('\n   RUG PROTECTION');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Quick Exits:  ${s.quickExits}`);
  console.log(`   Rugs Avoided: ${s.rugsAvoided}`);
  console.log(`   Rugs Caught:  ${s.rugsCaught}`);
  const avoidRate = (s.rugsAvoided + s.rugsCaught) > 0 ?
    (s.rugsAvoided / (s.rugsAvoided + s.rugsCaught) * 100).toFixed(0) : 'N/A';
  console.log(`   Avoid Rate:   ${avoidRate}%`);
  
  // Exit breakdown
  const exits = {};
  s.trades.forEach(t => exits[t.exitReason] = (exits[t.exitReason] || 0) + 1);
  
  console.log('\n   EXIT BREAKDOWN');
  console.log('   ─────────────────────────────────────────────────────');
  Object.entries(exits).sort((a,b) => b[1] - a[1]).forEach(([r, c]) => {
    console.log(`   ${r.padEnd(15)} ${c} (${(c/s.trades.length*100).toFixed(0)}%)`);
  });
  
  // By strategy
  const byStrat = {};
  s.trades.forEach(t => {
    if (!byStrat[t.strategy]) byStrat[t.strategy] = { n: 0, pnl: 0, w: 0 };
    byStrat[t.strategy].n++;
    byStrat[t.strategy].pnl += t.profit;
    if (t.profit > 0) byStrat[t.strategy].w++;
  });
  
  console.log('\n   BY STRATEGY');
  console.log('   ─────────────────────────────────────────────────────');
  Object.entries(byStrat).forEach(([strat, d]) => {
    const stratWR = (d.w / d.n * 100).toFixed(0);
    console.log(`   ${strat.padEnd(18)} ${d.n} | ${stratWR}% WR | ${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)}`);
  });
  
  console.log('\n   ML');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Accuracy:     ${(ml.accuracy * 100).toFixed(1)}%`);
  console.log(`   Rug Weight:   ${ml.weights.rugRisk.toFixed(3)}`);
  
  // Reality check
  console.log('\n   🎯 ASSESSMENT');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Simulated:    $${s.totalPnL.toFixed(2)}`);
  console.log(`   Est. Real:    $${(s.totalPnL / 1.2).toFixed(2)} (conservative bias)`);
  
  const verdict = parseFloat(wr) >= 40 && s.totalPnL > 0 ? 
    '✅ Conservative approach showing promise' :
    parseFloat(wr) >= 30 ? 
    '⚠️  Marginal - consider even tighter exits' :
    '❌ Strategy needs adjustment';
  
  console.log(`\n   ${verdict}`);
  console.log('\n════════════════════════════════════════════════════════════════════════\n');
}

run().catch(console.error);
