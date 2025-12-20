#!/usr/bin/env node
/**
 * 📝 PAPER TRADING MODE - No Real Money
 * 
 * Monitors real tokens but SIMULATES trades instead of executing them.
 * Trains ML model without spending any gas.
 */

import fetch from 'node-fetch';
import fs from 'fs';
import { analyzeToken, recordTradeOutcome, getModelStats } from './ml-predictor.mjs';

// === CONFIG ===
const CONFIG = {
  maxTradeUSD: parseFloat(process.env.MAX_TRADE_USD) || 100,  // Simulated $100 trades
  solPrice: 230,
  get maxTradeSOL() { return this.maxTradeUSD / this.solPrice; },
  
  profitTargetPct: 10,
  stopLossPct: 10,
  maxHoldMin: 10,
  
  // Trailing stop
  trailingActivatePct: 5,
  trailingDistancePct: 3,
  
  minLiquidity: 5000,
  scanInterval: 5000,
  monitorInterval: 3000,
};

const JUPITER_API = 'https://api.jup.ag';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// State
let positions = [];
let scannedTokens = new Set();
let stats = {
  scanned: 0,
  rejected: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  totalProfitPct: 0,
  simulatedProfit: 0,
};

// === HELPERS ===
async function getNewTokens() {
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const data = await res.json();
    return data.filter(t => t.chainId === 'solana').slice(0, 10);
  } catch (e) {
    return [];
  }
}

async function getTokenPrice(mint) {
  try {
    const res = await fetch(`${JUPITER_API}/price/v2?ids=${mint}`);
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
      priceChange24h: pair.priceChange?.h24 || 0,
      age: pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0,
    };
  } catch {
    return null;
  }
}

// === PAPER TRADE SIMULATION ===
async function simulateBuy(mint, poolInfo) {
  const price = await getTokenPrice(mint);
  if (!price) return null;
  
  const tradeSOL = CONFIG.maxTradeSOL;
  const tokensReceived = (tradeSOL * CONFIG.solPrice) / price;
  
  // Simulate 2% slippage on entry
  const actualTokens = tokensReceived * 0.98;
  
  return {
    mint,
    symbol: poolInfo.symbol,
    entryPrice: price,
    tokens: actualTokens,
    tradeSOL,
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
  
  // Check trailing stop activation
  if (!pos.trailingActive && profitPct >= CONFIG.trailingActivatePct) {
    pos.trailingActive = true;
    pos.trailingStopPrice = currentPrice * (1 - CONFIG.trailingDistancePct / 100);
    console.log(`   🎯 Trailing stop ACTIVATED at ${profitPct.toFixed(1)}%`);
  }
  
  // Update trailing stop
  if (pos.trailingActive) {
    const newStop = currentPrice * (1 - CONFIG.trailingDistancePct / 100);
    if (newStop > pos.trailingStopPrice) {
      pos.trailingStopPrice = newStop;
    }
  }
  
  let exitReason = null;
  
  // Check exit conditions
  if (profitPct >= CONFIG.profitTargetPct) {
    exitReason = 'PROFIT_TARGET';
  } else if (profitPct <= -CONFIG.stopLossPct) {
    exitReason = 'STOP_LOSS';
  } else if (pos.trailingActive && currentPrice <= pos.trailingStopPrice) {
    exitReason = 'TRAILING_STOP';
  } else if (holdTimeMin >= CONFIG.maxHoldMin) {
    exitReason = 'TIMEOUT';
  }
  
  return { currentPrice, profitPct, holdTimeMin, exitReason };
}

function simulateSell(pos, exitPrice, exitReason) {
  // Simulate 3% slippage on exit (memecoins have worse exit slippage)
  const actualExitPrice = exitPrice * 0.97;
  const actualProfitPct = ((actualExitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  
  // Simulate gas cost (~0.002 SOL for buy + sell)
  const simulatedGas = 0.002;
  const gasPct = (simulatedGas / pos.tradeSOL) * 100;
  
  const netProfitPct = actualProfitPct - gasPct;
  const netProfitSOL = pos.tradeSOL * (netProfitPct / 100);
  
  return {
    exitPrice: actualExitPrice,
    exitReason,
    profitPct: actualProfitPct,
    gasPct,
    netProfitPct,
    netProfitSOL,
    holdTime: Date.now() - pos.entryTime,
  };
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
    
    // Check liquidity
    if (poolInfo.liquidity < CONFIG.minLiquidity) {
      stats.rejected++;
      continue;
    }
    
    // ML Analysis
    const mlResult = analyzeToken({
      symbol: poolInfo.symbol,
      liquidity: poolInfo.liquidity,
      volume24h: poolInfo.volume24h,
      priceChange24h: poolInfo.priceChange24h,
      age: poolInfo.age,
    });
    
    console.log(`\n📊 ${poolInfo.symbol} | Liq: $${poolInfo.liquidity.toFixed(0)} | ML: ${(mlResult.score * 100).toFixed(0)}% ${mlResult.recommendation}`);
    
    if (mlResult.recommendation === 'AVOID' || mlResult.recommendation === 'SKIP') {
      stats.rejected++;
      continue;
    }
    
    // Check if we have a position already
    if (positions.length > 0) {
      console.log(`   ⏸️ Already have position, skipping`);
      continue;
    }
    
    // SIMULATE BUY
    const pos = await simulateBuy(token.tokenAddress, poolInfo);
    if (!pos) continue;
    
    console.log(`\n🎯 [PAPER] BUYING ${pos.symbol}`);
    console.log(`   💰 Entry: $${pos.entryPrice.toFixed(8)}`);
    console.log(`   📊 Trade: ${pos.tradeSOL.toFixed(4)} SOL (~$${(pos.tradeSOL * CONFIG.solPrice).toFixed(2)})`);
    console.log(`   🤖 ML Score: ${(mlResult.score * 100).toFixed(0)}%`);
    
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
    
    // Status line
    const trailStatus = pos.trailingActive ? `🎯 Trail@${((pos.trailingStopPrice/pos.entryPrice - 1) * 100).toFixed(1)}%` : '';
    console.log(`   ${pos.symbol}: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}% | Peak: ${pos.peakProfitPct.toFixed(1)}% | ${holdTimeMin.toFixed(1)}min ${trailStatus}`);
    
    if (exitReason) {
      const sellResult = simulateSell(pos, currentPrice, exitReason);
      
      const emoji = sellResult.netProfitPct >= 0 ? '✅' : '❌';
      console.log(`\n${emoji} [PAPER] SOLD ${pos.symbol} - ${exitReason}`);
      console.log(`   Entry: $${pos.entryPrice.toFixed(8)}`);
      console.log(`   Exit:  $${sellResult.exitPrice.toFixed(8)}`);
      console.log(`   Profit: ${sellResult.profitPct >= 0 ? '+' : ''}${sellResult.profitPct.toFixed(2)}%`);
      console.log(`   Gas: -${sellResult.gasPct.toFixed(2)}%`);
      console.log(`   NET: ${sellResult.netProfitPct >= 0 ? '+' : ''}${sellResult.netProfitPct.toFixed(2)}% (${sellResult.netProfitSOL >= 0 ? '+' : ''}${sellResult.netProfitSOL.toFixed(4)} SOL)`);
      
      // Record for ML
      recordTradeOutcome(
        pos.symbol,
        pos.liquidity,
        sellResult.netProfitPct,
        sellResult.holdTime,
        { liquidityScore: pos.liquidity / 50000, volumeScore: 0.5, ageScore: 0 }
      );
      
      // Update stats
      if (sellResult.netProfitPct >= 0) {
        stats.wins++;
      } else {
        stats.losses++;
      }
      stats.totalProfitPct += sellResult.netProfitPct;
      stats.simulatedProfit += sellResult.netProfitSOL;
      
      positions.splice(i, 1);
      
      // Print stats
      const mlStats = getModelStats();
      console.log(`\n📈 PAPER TRADING STATS:`);
      console.log(`   Trades: ${stats.trades} | Wins: ${stats.wins} | Losses: ${stats.losses}`);
      console.log(`   Win Rate: ${stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) : 0}%`);
      console.log(`   Simulated P/L: ${stats.simulatedProfit >= 0 ? '+' : ''}${stats.simulatedProfit.toFixed(4)} SOL`);
      console.log(`   ML Accuracy: ${mlStats.accuracy}%`);
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  📝 PAPER TRADING MODE - NO REAL MONEY                         ║');
  console.log('║  Simulating trades to train ML model                           ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Trade Size: $${CONFIG.maxTradeUSD} (simulated)                              ║`);
  console.log(`║  Profit Target: +${CONFIG.profitTargetPct}% | Stop Loss: -${CONFIG.stopLossPct}%                    ║`);
  console.log(`║  Trailing: +${CONFIG.trailingActivatePct}% activate, ${CONFIG.trailingDistancePct}% trail                       ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n🔍 Scanning for tokens...\n');
  
  // Main loops
  setInterval(scan, CONFIG.scanInterval);
  setInterval(monitor, CONFIG.monitorInterval);
  
  // Initial scan
  await scan();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Paper trading stopped');
    console.log('═══════════════════════════════════════');
    console.log(`📊 FINAL RESULTS:`);
    console.log(`   Scanned: ${stats.scanned} tokens`);
    console.log(`   Trades: ${stats.trades}`);
    console.log(`   Wins: ${stats.wins} | Losses: ${stats.losses}`);
    console.log(`   Win Rate: ${stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) : 0}%`);
    console.log(`   Simulated P/L: ${stats.simulatedProfit >= 0 ? '+' : ''}${stats.simulatedProfit.toFixed(4)} SOL (~$${(stats.simulatedProfit * CONFIG.solPrice).toFixed(2)})`);
    const mlStats = getModelStats();
    console.log(`   ML Model Accuracy: ${mlStats.accuracy}%`);
    console.log('═══════════════════════════════════════\n');
    process.exit(0);
  });
}

main().catch(console.error);
