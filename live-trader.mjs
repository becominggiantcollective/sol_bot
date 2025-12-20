#!/usr/bin/env node
/**
 * 🤖 LIVE TRADER - ML-Driven with $20 Loss Limit
 * 
 * Features:
 * - ML-based token selection
 * - $20 total loss limit protection
 * - Real-time token discovery from multiple sources
 * - Rug shield integration
 * - Auto position management
 */

import fetch from 'node-fetch';
import fs from 'fs';
import { analyzeToken } from './ml-predictor.mjs';
import { rugShieldCheck } from './rug-shield.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Loss Protection - HARD LIMIT
  MAX_TOTAL_LOSS_USD: 20.00,      // Stop trading after $20 total loss
  MAX_SINGLE_TRADE_USD: 5.00,     // Max $5 per trade
  
  // Trading Parameters
  TRADE_SIZE_SOL: 0.01,           // 0.01 SOL per trade (~$1.20)
  MAX_POSITIONS: 3,                // Max 3 concurrent trades
  
  // Entry Filters
  MIN_LIQUIDITY_USD: 100,         // Lower to find more tokens
  MIN_ML_SCORE: 0.35,             // 35% ML confidence (slightly lower)
  MAX_RUG_RISK: 0.8,              // Max 80% rug probability (trust ML)
  
  // Exit Strategy
  TAKE_PROFIT_PCT: 25,            // +25% = sell (quicker wins)
  STOP_LOSS_PCT: 12,              // -12% = sell (tighter to reduce losses)
  TRAILING_STOP_PCT: 12,          // -12% from peak
  MAX_HOLD_MINUTES: 10,           // 10 min max
  
  // Discovery Settings
  SCAN_INTERVAL_MS: 8000,         // Scan every 8 seconds
  PRICE_UPDATE_MS: 5000,          // Update prices every 5s
  
  // Data Sources
  TOKEN_SOURCES: [
    'https://api.dexscreener.com/token-boosts/latest/v1',
    'https://api.geckoterminal.com/api/v2/networks/solana/new_pools',
    'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools',
    'https://api.dexscreener.com/latest/dex/search?q=solana'
  ],
  
  // RPC
  HELIUS_RPC: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  
  // Persistence
  POSITIONS_FILE: 'positions-live.json',
  STATS_FILE: 'live-trader-stats.json'
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  running: true,
  positions: new Map(),
  totalPnL: 0,
  totalLossUSD: 0,
  stats: {
    scans: 0,
    tokensEvaluated: 0,
    mlRejected: 0,
    rugShieldBlocked: 0,
    tradesEntered: 0,
    wins: 0,
    losses: 0,
    startTime: Date.now(),
    lastScan: 0
  },
  solPrice: 120,
  seenTokens: new Set(),
  lastError: null
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const icons = {
    INFO: 'ℹ️',
    SUCCESS: '✅',
    WARNING: '⚠️',
    ERROR: '❌',
    TRADE: '💰',
    ML: '🤖',
    SHIELD: '🛡️'
  };
  console.log(`[${timestamp}] ${icons[level] || '•'} ${msg}`);
}

async function getSOLPrice() {
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const data = await res.json();
    const price = parseFloat(data.pairs?.[0]?.priceUsd);
    if (price && price > 0) {
      state.solPrice = price;
      return price;
    }
  } catch (e) {}
  return state.solPrice;
}

function saveState() {
  try {
    const positions = Array.from(state.positions.entries()).map(([mint, pos]) => [mint, pos]);
    fs.writeFileSync(CONFIG.POSITIONS_FILE, JSON.stringify({ positions }, null, 2));
    fs.writeFileSync(CONFIG.STATS_FILE, JSON.stringify(state.stats, null, 2));
  } catch (e) {
    log(`Failed to save state: ${e.message}`, 'ERROR');
  }
}

function loadState() {
  try {
    if (fs.existsSync(CONFIG.POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.POSITIONS_FILE, 'utf8'));
      if (data.positions) {
        state.positions = new Map(data.positions);
        log(`Loaded ${state.positions.size} positions from disk`, 'INFO');
      }
    }
    if (fs.existsSync(CONFIG.STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(CONFIG.STATS_FILE, 'utf8'));
      state.stats = { ...state.stats, ...stats };
    }
    
    // Calculate total loss from closed positions
    for (const [mint, pos] of state.positions) {
      if (pos.status === 'CLOSED' && pos.profitUSD < 0) {
        state.totalLossUSD += Math.abs(pos.profitUSD);
      }
    }
  } catch (e) {
    log(`Failed to load state: ${e.message}`, 'WARNING');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

async function discoverTokens() {
  const tokens = new Set();
  
  // Source 1: DexScreener Boosted Tokens
  try {
    const res = await fetch(CONFIG.TOKEN_SOURCES[0]);
    const data = await res.json();
    const solTokens = data.filter(t => t.chainId === 'solana');
    solTokens.forEach(t => tokens.add(t.tokenAddress));
    log(`Found ${solTokens.length} boosted tokens on DexScreener`, 'INFO');
  } catch (e) {
    log(`DexScreener boosted failed: ${e.message}`, 'WARNING');
  }
  
  // Source 2: GeckoTerminal New Pools
  try {
    const res = await fetch(CONFIG.TOKEN_SOURCES[1]);
    const data = await res.json();
    if (data.data) {
      data.data.forEach(pool => {
        const baseToken = pool.relationships?.base_token?.data?.id?.split('_')[1];
        if (baseToken) tokens.add(baseToken);
      });
      log(`Found ${data.data.length} new pools on GeckoTerminal`, 'INFO');
    }
  } catch (e) {
    log(`GeckoTerminal failed: ${e.message}`, 'WARNING');
  }
  
  // Source 3: DexScreener Trending
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/solana');
    const data = await res.json();
    if (data.pairs) {
      data.pairs.slice(0, 20).forEach(p => {
        tokens.add(p.baseToken.address);
      });
      log(`Found ${data.pairs.length} trending tokens`, 'INFO');
    }
  } catch (e) {
    log(`DexScreener trending failed: ${e.message}`, 'WARNING');
  }
  
  return Array.from(tokens);
}

async function getTokenData(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data.pairs?.[0];
    
    if (!pair) return null;
    
    return {
      mint,
      symbol: pair.baseToken.symbol || 'UNKNOWN',
      name: pair.baseToken.name || 'Unknown',
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      volume: parseFloat(pair.volume?.h24 || 0),
      priceUsd: parseFloat(pair.priceUsd || 0),
      priceNative: parseFloat(pair.priceNative || 0),
      priceChange5m: parseFloat(pair.priceChange?.m5 || 0),
      priceChange1h: parseFloat(pair.priceChange?.h1 || 0),
      priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
      txns24h: pair.txns?.h24 || {},
      pairAge: pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 1000 / 60 / 60 : 999,
      dexId: pair.dexId
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADING LOGIC
// ═══════════════════════════════════════════════════════════════════════════

async function evaluateToken(tokenData) {
  state.stats.tokensEvaluated++;
  
  // Check if already evaluated or trading
  if (state.seenTokens.has(tokenData.mint)) return null;
  if (state.positions.has(tokenData.mint)) return null;
  
  state.seenTokens.add(tokenData.mint);
  
  log(`Evaluating ${tokenData.symbol} (${tokenData.mint.slice(0, 8)}...)`, 'INFO');
  
  // Quick filters first
  if (tokenData.liquidity < CONFIG.MIN_LIQUIDITY_USD) {
    log(`  ❌ Low liquidity: $${tokenData.liquidity.toFixed(0)}`, 'WARNING');
    return null;
  }
  
  // ML Analysis
  log(`  🤖 Running ML analysis...`, 'ML');
  const mlData = {
    liquidity: tokenData.liquidity,
    volume: tokenData.volume,
    ageHours: tokenData.pairAge,
    priceVelocity: Math.abs(tokenData.priceChange5m) / 100,
    volumeSpike: tokenData.volume > tokenData.liquidity * 2 ? 0.8 : 0.3,
    holderConcentration: 0.5 // Default (would need on-chain data)
  };
  
  const mlResult = analyzeToken(mlData);
  
  log(`  📊 ML Score: ${(mlResult.score * 100).toFixed(1)}%`, 'ML');
  log(`  📊 Confidence: ${(mlResult.confidence * 100).toFixed(1)}%`, 'ML');
  log(`  📊 Should Trade: ${mlResult.shouldTrade}`, 'ML');
  
  if (mlResult.score < CONFIG.MIN_ML_SCORE) {
    state.stats.mlRejected++;
    log(`  ❌ ML score too low: ${(mlResult.score * 100).toFixed(1)}%`, 'ML');
    return null;
  }
  
  if (mlResult.rugRisk > CONFIG.MAX_RUG_RISK) {
    state.stats.rugShieldBlocked++;
    log(`  🛡️ High rug risk: ${(mlResult.rugRisk * 100).toFixed(1)}%`, 'SHIELD');
    return null;
  }
  
  // Rug Shield Check
  log(`  🛡️ Running Rug Shield...`, 'SHIELD');
  const rugCheck = await rugShieldCheck(tokenData.mint, tokenData.symbol);
  
  if (!rugCheck.isSafe) {
    state.stats.rugShieldBlocked++;
    log(`  🚫 RUG SHIELD BLOCKED: ${rugCheck.recommendation}`, 'SHIELD');
    return null;
  }
  
  log(`  ✅ ${rugCheck.recommendation}`, 'SHIELD');
  
  // PASSED ALL CHECKS
  return {
    tokenData,
    mlResult,
    rugCheck
  };
}

async function enterTrade(analysis) {
  const { tokenData, mlResult } = analysis;
  
  // Check loss limit
  if (state.totalLossUSD >= CONFIG.MAX_TOTAL_LOSS_USD) {
    log(`🚫 LOSS LIMIT REACHED: $${state.totalLossUSD.toFixed(2)} / $${CONFIG.MAX_TOTAL_LOSS_USD}`, 'ERROR');
    log(`🛑 STOPPING BOT - Maximum loss limit hit`, 'ERROR');
    state.running = false;
    return;
  }
  
  // Check max positions
  const openPositions = Array.from(state.positions.values()).filter(p => p.status === 'OPEN').length;
  if (openPositions >= CONFIG.MAX_POSITIONS) {
    log(`⚠️ Max positions reached: ${openPositions}/${CONFIG.MAX_POSITIONS}`, 'WARNING');
    return;
  }
  
  const position = {
    mint: tokenData.mint,
    symbol: tokenData.symbol,
    status: 'OPEN',
    entryTime: Date.now(),
    entrySOL: CONFIG.TRADE_SIZE_SOL,
    entryPriceUsd: tokenData.priceUsd,
    entryPriceNative: tokenData.priceNative,
    mlScore: mlResult.score,
    mlConfidence: mlResult.confidence,
    strategy: mlResult.suggestedStrategy || {
      target: CONFIG.TAKE_PROFIT_PCT,
      stop: CONFIG.STOP_LOSS_PCT,
      maxHold: CONFIG.MAX_HOLD_MINUTES
    },
    peakPct: 0,
    peakTime: 0,
    lastPrice: tokenData.priceNative,
    profitSOL: 0,
    profitUSD: 0,
    profitPct: 0
  };
  
  state.positions.set(tokenData.mint, position);
  state.stats.tradesEntered++;
  
  log(``, 'TRADE');
  log(`═══════════════════════════════════════════`, 'TRADE');
  log(`🚀 ENTERED TRADE #${state.stats.tradesEntered}`, 'TRADE');
  log(`Token:     ${tokenData.symbol}`, 'TRADE');
  log(`Entry:     $${(CONFIG.TRADE_SIZE_SOL * state.solPrice).toFixed(2)}`, 'TRADE');
  log(`ML Score:  ${(mlResult.score * 100).toFixed(1)}%`, 'TRADE');
  log(`Target:    +${position.strategy.target}%`, 'TRADE');
  log(`Stop:      -${position.strategy.stop}%`, 'TRADE');
  log(`Max Hold:  ${position.strategy.maxHold} min`, 'TRADE');
  log(`═══════════════════════════════════════════`, 'TRADE');
  
  saveState();
}

async function updatePosition(mint, position) {
  const tokenData = await getTokenData(mint);
  if (!tokenData) return;
  
  const currentPriceNative = tokenData.priceNative;
  const profitPct = ((currentPriceNative - position.entryPriceNative) / position.entryPriceNative) * 100;
  
  // Update peak
  if (profitPct > position.peakPct) {
    position.peakPct = profitPct;
    position.peakTime = Date.now() - position.entryTime;
  }
  
  position.lastPrice = currentPriceNative;
  position.profitPct = profitPct;
  position.profitSOL = (profitPct / 100) * position.entrySOL;
  position.profitUSD = position.profitSOL * state.solPrice;
  
  const holdTimeMin = (Date.now() - position.entryTime) / 1000 / 60;
  
  // Exit conditions
  let exitReason = null;
  
  // Take profit
  if (profitPct >= position.strategy.target) {
    exitReason = `✅ TAKE PROFIT: +${profitPct.toFixed(1)}%`;
  }
  // Stop loss
  else if (profitPct <= -position.strategy.stop) {
    exitReason = `🛑 STOP LOSS: ${profitPct.toFixed(1)}%`;
  }
  // Trailing stop
  else if (position.peakPct > CONFIG.TRAILING_STOP_PCT && 
           profitPct < position.peakPct - CONFIG.TRAILING_STOP_PCT) {
    exitReason = `📉 TRAILING STOP: ${profitPct.toFixed(1)}% (peak: +${position.peakPct.toFixed(1)}%)`;
  }
  // Max hold time
  else if (holdTimeMin >= position.strategy.maxHold) {
    exitReason = `⏰ MAX HOLD: ${holdTimeMin.toFixed(1)} min`;
  }
  
  if (exitReason) {
    await exitTrade(mint, position, exitReason);
  }
}

async function exitTrade(mint, position, reason) {
  position.status = 'CLOSED';
  position.exitTime = Date.now();
  position.exitReason = reason;
  position.holdTimeMin = (position.exitTime - position.entryTime) / 1000 / 60;
  
  // Update stats
  state.totalPnL += position.profitUSD;
  
  if (position.profitUSD > 0) {
    state.stats.wins++;
  } else {
    state.stats.losses++;
    state.totalLossUSD += Math.abs(position.profitUSD);
  }
  
  const winRate = state.stats.wins + state.stats.losses > 0 
    ? (state.stats.wins / (state.stats.wins + state.stats.losses) * 100).toFixed(1)
    : 0;
  
  log(``, 'TRADE');
  log(`═══════════════════════════════════════════`, 'TRADE');
  log(`${position.profitUSD >= 0 ? '💰' : '📉'} EXITED TRADE`, 'TRADE');
  log(`Token:     ${position.symbol}`, 'TRADE');
  log(`Reason:    ${reason}`, 'TRADE');
  log(`Hold Time: ${position.holdTimeMin.toFixed(1)} min`, 'TRADE');
  log(`P&L:       ${position.profitUSD >= 0 ? '+' : ''}$${position.profitUSD.toFixed(2)} (${position.profitPct.toFixed(1)}%)`, 'TRADE');
  log(`Peak:      +${position.peakPct.toFixed(1)}%`, 'TRADE');
  log(`═══════════════════════════════════════════`, 'TRADE');
  log(`Total P&L: ${state.totalPnL >= 0 ? '+' : ''}$${state.totalPnL.toFixed(2)}`, 'TRADE');
  log(`Win Rate:  ${winRate}% (${state.stats.wins}W/${state.stats.losses}L)`, 'TRADE');
  log(`Total Loss: $${state.totalLossUSD.toFixed(2)} / $${CONFIG.MAX_TOTAL_LOSS_USD} limit`, 'TRADE');
  log(`═══════════════════════════════════════════`, 'TRADE');
  
  saveState();
  
  // Check loss limit
  if (state.totalLossUSD >= CONFIG.MAX_TOTAL_LOSS_USD) {
    log(``, 'ERROR');
    log(`🚫 LOSS LIMIT REACHED!`, 'ERROR');
    log(`Total Losses: $${state.totalLossUSD.toFixed(2)}`, 'ERROR');
    log(`Limit: $${CONFIG.MAX_TOTAL_LOSS_USD}`, 'ERROR');
    log(`🛑 STOPPING BOT`, 'ERROR');
    state.running = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function scanLoop() {
  while (state.running) {
    try {
      state.stats.scans++;
      state.stats.lastScan = Date.now();
      
      log(``, 'INFO');
      log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'INFO');
      log(`Scan #${state.stats.scans}`, 'INFO');
      log(`Positions: ${Array.from(state.positions.values()).filter(p => p.status === 'OPEN').length}/${CONFIG.MAX_POSITIONS}`, 'INFO');
      log(`Win Rate: ${state.stats.wins + state.stats.losses > 0 ? ((state.stats.wins / (state.stats.wins + state.stats.losses)) * 100).toFixed(1) : 0}%`, 'INFO');
      log(`Total P&L: ${state.totalPnL >= 0 ? '+' : ''}$${state.totalPnL.toFixed(2)}`, 'INFO');
      log(`Loss Limit: $${state.totalLossUSD.toFixed(2)} / $${CONFIG.MAX_TOTAL_LOSS_USD}`, 'INFO');
      log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'INFO');
      
      // Update SOL price
      await getSOLPrice();
      
      // Update existing positions
      for (const [mint, position] of state.positions) {
        if (position.status === 'OPEN') {
          await updatePosition(mint, position);
        }
      }
      
      // Look for new opportunities (if under position limit)
      const openPositions = Array.from(state.positions.values()).filter(p => p.status === 'OPEN').length;
      if (openPositions < CONFIG.MAX_POSITIONS && state.totalLossUSD < CONFIG.MAX_TOTAL_LOSS_USD) {
        log(`Discovering new tokens...`, 'INFO');
        const tokens = await discoverTokens();
        log(`Found ${tokens.length} unique tokens to evaluate`, 'INFO');
        
        for (const mint of tokens.slice(0, 10)) { // Evaluate top 10
          const tokenData = await getTokenData(mint);
          if (!tokenData) continue;
          
          const analysis = await evaluateToken(tokenData);
          if (analysis) {
            await enterTrade(analysis);
            break; // Enter one at a time
          }
          
          await new Promise(r => setTimeout(r, 500)); // Rate limit
        }
      }
      
      await new Promise(r => setTimeout(r, CONFIG.SCAN_INTERVAL_MS));
      
    } catch (e) {
      log(`Scan error: ${e.message}`, 'ERROR');
      state.lastError = e.message;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  log(``, 'INFO');
  log(`🛑 Trading stopped`, 'INFO');
  log(`Final Stats:`, 'INFO');
  log(`  Trades: ${state.stats.tradesEntered}`, 'INFO');
  log(`  Wins: ${state.stats.wins}`, 'INFO');
  log(`  Losses: ${state.stats.losses}`, 'INFO');
  log(`  Win Rate: ${state.stats.wins + state.stats.losses > 0 ? ((state.stats.wins / (state.stats.wins + state.stats.losses)) * 100).toFixed(1) : 0}%`, 'INFO');
  log(`  Total P&L: ${state.totalPnL >= 0 ? '+' : ''}$${state.totalPnL.toFixed(2)}`, 'INFO');
  log(`  Total Losses: $${state.totalLossUSD.toFixed(2)}`, 'INFO');
}

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════

log(``, 'SUCCESS');
log(`═══════════════════════════════════════════════════════════════`, 'SUCCESS');
log(`🤖 LIVE TRADER - ML-Driven with Loss Protection`, 'SUCCESS');
log(`═══════════════════════════════════════════════════════════════`, 'SUCCESS');
log(`Trade Size:     $${(CONFIG.TRADE_SIZE_SOL * state.solPrice).toFixed(2)} (${CONFIG.TRADE_SIZE_SOL} SOL)`, 'INFO');
log(`Max Positions:  ${CONFIG.MAX_POSITIONS}`, 'INFO');
log(`Loss Limit:     $${CONFIG.MAX_TOTAL_LOSS_USD}`, 'INFO');
log(`Take Profit:    +${CONFIG.TAKE_PROFIT_PCT}%`, 'INFO');
log(`Stop Loss:      -${CONFIG.STOP_LOSS_PCT}%`, 'INFO');
log(`Trailing Stop:  -${CONFIG.TRAILING_STOP_PCT}%`, 'INFO');
log(`Max Hold:       ${CONFIG.MAX_HOLD_MINUTES} minutes`, 'INFO');
log(`ML Min Score:   ${(CONFIG.MIN_ML_SCORE * 100).toFixed(0)}%`, 'INFO');
log(`═══════════════════════════════════════════════════════════════`, 'SUCCESS');

loadState();

if (state.totalLossUSD >= CONFIG.MAX_TOTAL_LOSS_USD) {
  log(``, 'ERROR');
  log(`🚫 CANNOT START - Loss limit already reached!`, 'ERROR');
  log(`Total Losses: $${state.totalLossUSD.toFixed(2)}`, 'ERROR');
  log(`Limit: $${CONFIG.MAX_TOTAL_LOSS_USD}`, 'ERROR');
  log(``, 'ERROR');
  log(`Reset by deleting: ${CONFIG.STATS_FILE}`, 'INFO');
  process.exit(1);
}

log(`Starting in 3 seconds...`, 'INFO');
await new Promise(r => setTimeout(r, 3000));

scanLoop();

// Handle graceful shutdown
process.on('SIGINT', () => {
  log(``, 'WARNING');
  log(`Received SIGINT, shutting down...`, 'WARNING');
  state.running = false;
  saveState();
  setTimeout(() => process.exit(0), 2000);
});
