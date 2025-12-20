#!/usr/bin/env node
/**
 * 📝 CONSERVATIVE PAPER TRADER
 * 
 * Tests strategy with:
 * - Small positions ($1-2)
 * - Higher liquidity requirements ($15K+)
 * - Compares regular vs flashloan results
 * - NO real trades - simulation only
 */
import fetch from 'node-fetch';
import fs from 'fs';
import { analyzeToken, recordTradeOutcome, getModelStats } from './ml-predictor.mjs';

// === CONSERVATIVE CONFIG ===
const CONFIG = {
  // Position sizes to test
  smallTradeUSD: 1,       // $1 position
  mediumTradeUSD: 2,      // $2 position
  flashloanTradeUSD: 50,  // $50 flashloan position
  
  solPrice: 230,
  
  // More conservative thresholds
  profitTargetPct: 8,     // Take profit at +8%
  stopLossPct: 5,         // Cut losses at -5%
  maxHoldMin: 5,          // Max 5 min hold (faster exits)
  
  // Trailing stop
  trailingActivatePct: 4,
  trailingDistancePct: 2,
  
  // HIGHER liquidity requirement
  minLiquidity: 15000,    // $15K minimum
  idealLiquidity: 25000,  // $25K+ preferred
  
  // Fees
  gasPerTrade: 0.40,      // ~$0.40 gas per trade
  flashloanFee: 0.003,    // 0.3% Solend fee
  slippage: 0.02,         // 2% slippage estimate
  
  scanInterval: 8000,
  monitorInterval: 3000,
};

// State
let positions = [];
let scannedTokens = new Set();
let stats = {
  scanned: 0,
  rejected: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  // Track by position size
  smallTrades: { count: 0, profit: 0 },
  mediumTrades: { count: 0, profit: 0 },
  flashloanTrades: { count: 0, profit: 0 },
};

// === HELPERS ===
async function getNewTokens() {
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const data = await res.json();
    return data.filter(t => t.chainId === 'solana').slice(0, 8);
  } catch {
    return [];
  }
}

async function getTokenPrice(mint) {
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
    const data = await res.json();
    return parseFloat(data.data?.[mint]?.price || 0);
  } catch {
    return 0;
  }
}

async function getPoolInfo(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data.pairs?.[0];
    if (!pair) return null;
    return {
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      liquidity: pair.liquidity?.usd || 0,
      volume24h: pair.volume?.h24 || 0,
      priceChange5m: pair.priceChange?.m5 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      age: pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0,
    };
  } catch {
    return null;
  }
}

// === SIMULATION ===
function simulateTrade(entryPrice, exitPrice, tradeUSD, isFlashloan = false) {
  // Apply slippage
  const actualEntry = entryPrice * (1 + CONFIG.slippage);
  const actualExit = exitPrice * (1 - CONFIG.slippage);
  
  const grossProfitPct = ((actualExit - actualEntry) / actualEntry) * 100;
  const grossProfitUSD = tradeUSD * (grossProfitPct / 100);
  
  // Calculate fees
  let fees = CONFIG.gasPerTrade * 2; // Buy + sell gas
  if (isFlashloan) {
    fees += tradeUSD * CONFIG.flashloanFee; // 0.3% flash fee
  }
  
  const netProfitUSD = grossProfitUSD - fees;
  const netProfitPct = (netProfitUSD / tradeUSD) * 100;
  
  return {
    grossProfitPct,
    grossProfitUSD,
    fees,
    netProfitUSD,
    netProfitPct,
    profitable: netProfitUSD > 0,
  };
}

async function simulateBuy(mint, poolInfo) {
  const price = await getTokenPrice(mint);
  if (!price) return null;
  
  return {
    mint,
    symbol: poolInfo.symbol,
    entryPrice: price,
    entryTime: Date.now(),
    peakPrice: price,
    peakProfitPct: 0,
    trailingActive: false,
    trailingStopPrice: 0,
    liquidity: poolInfo.liquidity,
  };
}

async function monitorPosition(pos) {
  const currentPrice = await getTokenPrice(pos.mint);
  if (!currentPrice) return null;
  
  const profitPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const holdTimeMin = (Date.now() - pos.entryTime) / 60000;
  
  // Update peak
  if (currentPrice > pos.peakPrice) {
    pos.peakPrice = currentPrice;
    pos.peakProfitPct = profitPct;
  }
  
  // Trailing stop
  if (!pos.trailingActive && profitPct >= CONFIG.trailingActivatePct) {
    pos.trailingActive = true;
    pos.trailingStopPrice = currentPrice * (1 - CONFIG.trailingDistancePct / 100);
  }
  
  if (pos.trailingActive) {
    const newStop = currentPrice * (1 - CONFIG.trailingDistancePct / 100);
    if (newStop > pos.trailingStopPrice) {
      pos.trailingStopPrice = newStop;
    }
  }
  
  // Check exits
  let exitReason = null;
  if (profitPct >= CONFIG.profitTargetPct) exitReason = 'PROFIT_TARGET';
  else if (profitPct <= -CONFIG.stopLossPct) exitReason = 'STOP_LOSS';
  else if (pos.trailingActive && currentPrice <= pos.trailingStopPrice) exitReason = 'TRAILING_STOP';
  else if (holdTimeMin >= CONFIG.maxHoldMin) exitReason = 'TIMEOUT';
  
  return { currentPrice, profitPct, holdTimeMin, exitReason };
}

// === MAIN LOOP ===
async function scan() {
  const tokens = await getNewTokens();
  
  for (const token of tokens) {
    if (!token.tokenAddress || scannedTokens.has(token.tokenAddress)) continue;
    scannedTokens.add(token.tokenAddress);
    stats.scanned++;
    
    const poolInfo = await getPoolInfo(token.tokenAddress);
    if (!poolInfo) continue;
    
    // Check liquidity - MORE CONSERVATIVE
    if (poolInfo.liquidity < CONFIG.minLiquidity) {
      console.log(`   ❌ ${poolInfo.symbol} - Low liquidity: $${poolInfo.liquidity.toFixed(0)} (need $${CONFIG.minLiquidity}+)`);
      stats.rejected++;
      continue;
    }
    
    // ML Analysis
    let mlResult;
    try {
      mlResult = analyzeToken({
        symbol: poolInfo.symbol,
        liquidity: poolInfo.liquidity,
        volume24h: poolInfo.volume24h,
        priceChange24h: poolInfo.priceChange1h,
        age: poolInfo.age,
      });
    } catch (e) {
      mlResult = { score: 0.5, recommendation: { action: 'SKIP' } };
    }
    
    const mlScore = typeof mlResult.score === 'number' ? mlResult.score : 0.5;
    const mlRec = mlResult.recommendation?.action || 'UNKNOWN';
    
    const liqIcon = poolInfo.liquidity >= CONFIG.idealLiquidity ? '🟢' : '🟡';
    console.log(`\n📊 ${poolInfo.symbol} | ${liqIcon} Liq: $${(poolInfo.liquidity/1000).toFixed(0)}K | ML: ${(mlScore * 100).toFixed(0)}% ${mlRec}`);
    console.log(`   5min: ${poolInfo.priceChange5m >= 0 ? '+' : ''}${poolInfo.priceChange5m.toFixed(1)}% | 1hr: ${poolInfo.priceChange1h >= 0 ? '+' : ''}${poolInfo.priceChange1h.toFixed(1)}%`);
    
    if (mlRec === 'AVOID') {
      console.log(`   ⛔ ML says AVOID - skipping`);
      stats.rejected++;
      continue;
    }
    
    // Skip if dumping
    if (poolInfo.priceChange5m < -5) {
      console.log(`   📉 Dumping (-${Math.abs(poolInfo.priceChange5m).toFixed(1)}% in 5min) - skipping`);
      stats.rejected++;
      continue;
    }
    
    if (positions.length > 0) {
      console.log(`   ⏸️ Already have position`);
      continue;
    }
    
    // SIMULATE BUY
    const pos = await simulateBuy(token.tokenAddress, poolInfo);
    if (!pos) continue;
    
    console.log(`\n🎯 [PAPER] SIMULATING ENTRY: ${pos.symbol}`);
    console.log(`   Entry Price: $${pos.entryPrice.toFixed(8)}`);
    console.log(`   Liquidity: $${pos.liquidity.toLocaleString()}`);
    console.log(`   ML Score: ${(mlResult.score * 100).toFixed(0)}%`);
    console.log(`   Testing position sizes: $1, $2, $50 (flashloan)`);
    
    positions.push(pos);
    stats.trades++;
  }
}

async function monitor() {
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const result = await monitorPosition(pos);
    if (!result) continue;
    
    const { currentPrice, profitPct, holdTimeMin, exitReason } = result;
    
    // Status
    const trailStatus = pos.trailingActive ? `🎯 Trail@${((pos.trailingStopPrice/pos.entryPrice - 1) * 100).toFixed(1)}%` : '';
    console.log(`   ${pos.symbol}: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}% | Peak: ${pos.peakProfitPct.toFixed(1)}% | ${holdTimeMin.toFixed(1)}min ${trailStatus}`);
    
    if (exitReason) {
      console.log(`\n📊 [PAPER] EXIT SIMULATION: ${pos.symbol} - ${exitReason}`);
      console.log(`   Entry: $${pos.entryPrice.toFixed(8)} → Exit: $${currentPrice.toFixed(8)}`);
      console.log('');
      
      // Compare all position sizes
      const sizes = [
        { name: '$1 Direct', usd: CONFIG.smallTradeUSD, flash: false },
        { name: '$2 Direct', usd: CONFIG.mediumTradeUSD, flash: false },
        { name: '$50 Flashloan', usd: CONFIG.flashloanTradeUSD, flash: true },
      ];
      
      console.log('   ┌──────────────────┬──────────┬──────────┬──────────┬──────────┐');
      console.log('   │ Position         │ Gross %  │ Fees     │ Net $    │ Result   │');
      console.log('   ├──────────────────┼──────────┼──────────┼──────────┼──────────┤');
      
      for (const size of sizes) {
        const sim = simulateTrade(pos.entryPrice, currentPrice, size.usd, size.flash);
        
        const resultIcon = sim.profitable ? '✅ WIN' : '❌ LOSS';
        const netStr = (sim.netProfitUSD >= 0 ? '+$' : '-$') + Math.abs(sim.netProfitUSD).toFixed(2);
        
        console.log(`   │ ${size.name.padEnd(16)} │ ${(sim.grossProfitPct >= 0 ? '+' : '') + sim.grossProfitPct.toFixed(1).padStart(6)}% │ $${sim.fees.toFixed(2).padStart(6)} │ ${netStr.padStart(8)} │ ${resultIcon.padEnd(8)} │`);
        
        // Track stats
        if (size.usd === CONFIG.smallTradeUSD) {
          stats.smallTrades.count++;
          stats.smallTrades.profit += sim.netProfitUSD;
        } else if (size.usd === CONFIG.mediumTradeUSD) {
          stats.mediumTrades.count++;
          stats.mediumTrades.profit += sim.netProfitUSD;
        } else {
          stats.flashloanTrades.count++;
          stats.flashloanTrades.profit += sim.netProfitUSD;
        }
        
        if (sim.profitable) stats.wins++;
        else stats.losses++;
      }
      
      console.log('   └──────────────────┴──────────┴──────────┴──────────┴──────────┘');
      
      // Record for ML
      const avgNet = (simulateTrade(pos.entryPrice, currentPrice, 5, false).netProfitPct);
      recordTradeOutcome(
        pos.symbol,
        pos.liquidity,
        avgNet,
        Date.now() - pos.entryTime,
        { liquidityScore: pos.liquidity / 50000, volumeScore: 0.5, ageScore: 0 }
      );
      
      positions.splice(i, 1);
      
      // Summary
      console.log('\n📈 SESSION STATS:');
      console.log(`   Scanned: ${stats.scanned} | Rejected: ${stats.rejected} | Trades: ${stats.trades}`);
      console.log(`   $1 Trades:  ${stats.smallTrades.count} | P/L: ${stats.smallTrades.profit >= 0 ? '+' : ''}$${stats.smallTrades.profit.toFixed(2)}`);
      console.log(`   $2 Trades:  ${stats.mediumTrades.count} | P/L: ${stats.mediumTrades.profit >= 0 ? '+' : ''}$${stats.mediumTrades.profit.toFixed(2)}`);
      console.log(`   $50 Flash:  ${stats.flashloanTrades.count} | P/L: ${stats.flashloanTrades.profit >= 0 ? '+' : ''}$${stats.flashloanTrades.profit.toFixed(2)}`);
      
      const mlStats = getModelStats();
      console.log(`   ML Accuracy: ${mlStats.accuracy}%`);
      console.log('');
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  📝 CONSERVATIVE PAPER TRADER                                      ║');
  console.log('║  Testing smaller positions + flashloan comparison                  ║');
  console.log('╠════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Position sizes: $1, $2, $50 (flashloan)                           ║`);
  console.log(`║  Min liquidity: $${(CONFIG.minLiquidity/1000).toFixed(0)}K | Ideal: $${(CONFIG.idealLiquidity/1000).toFixed(0)}K+                               ║`);
  console.log(`║  Targets: +${CONFIG.profitTargetPct}% profit | -${CONFIG.stopLossPct}% stop | ${CONFIG.maxHoldMin}min max hold              ║`);
  console.log(`║  Trailing: +${CONFIG.trailingActivatePct}% activate, ${CONFIG.trailingDistancePct}% trail                              ║`);
  console.log('║                                                                    ║');
  console.log('║  ⚠️  NO REAL TRADES - Paper simulation only                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n🔍 Scanning for tokens with $15K+ liquidity...\n');
  
  setInterval(scan, CONFIG.scanInterval);
  setInterval(monitor, CONFIG.monitorInterval);
  
  await scan();
  
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Paper trader stopped');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 FINAL RESULTS (SIMULATED):');
    console.log(`   Tokens scanned: ${stats.scanned}`);
    console.log(`   Rejected (low liq/ML): ${stats.rejected}`);
    console.log(`   Simulated trades: ${stats.trades}`);
    console.log('');
    console.log('   POSITION SIZE COMPARISON:');
    console.log(`   $1 Direct:    ${stats.smallTrades.count} trades | Net: ${stats.smallTrades.profit >= 0 ? '+' : ''}$${stats.smallTrades.profit.toFixed(2)}`);
    console.log(`   $2 Direct:    ${stats.mediumTrades.count} trades | Net: ${stats.mediumTrades.profit >= 0 ? '+' : ''}$${stats.mediumTrades.profit.toFixed(2)}`);
    console.log(`   $50 Flashloan: ${stats.flashloanTrades.count} trades | Net: ${stats.flashloanTrades.profit >= 0 ? '+' : ''}$${stats.flashloanTrades.profit.toFixed(2)}`);
    console.log('');
    
    // Determine best strategy
    const strategies = [
      { name: '$1 Direct', profit: stats.smallTrades.profit },
      { name: '$2 Direct', profit: stats.mediumTrades.profit },
      { name: '$50 Flashloan', profit: stats.flashloanTrades.profit },
    ];
    const best = strategies.reduce((a, b) => a.profit > b.profit ? a : b);
    console.log(`   🏆 BEST STRATEGY: ${best.name} (${best.profit >= 0 ? '+' : ''}$${best.profit.toFixed(2)})`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(0);
  });
}

main().catch(console.error);
