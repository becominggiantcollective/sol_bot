#!/usr/bin/env node
/**
 * 🛡️ SAFE SNIPER BOT v3
 * With Honeypot Detection BEFORE buying
 * 
 * Features:
 * - Pre-buy honeypot scan
 * - Risk score threshold
 * - Auto take-profit/stop-loss
 * - Position tracking
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { preBuyCheck, quickHoneypotCheck } from './pre-buy-simulator.mjs';
import { analyzeToken, recordTradeOutcome, getModelStats } from './ml-predictor.mjs';

// === CONFIG ===
const CONFIG = {
  // Trading - Got 0.19 SOL in the tank!
  tradeAmountSol: 0.01,       // ~$2.30 per trade
  maxPositions: 3,            // Can hold 3 positions
  takeProfitPct: 12,          // +12% take profit (tighter, lock gains faster)
  stopLossPct: 7,             // -7% HARD stop loss (tighter!)
  trailingStopPct: 3,         // -3% trailing from peak (tight trail)
  maxHoldMinutes: 5,          // 5 min max hold - NO BAGHOLDING

  // Entry Signals - Only buy GOOD setups
  minPriceChange5m: 1,        // Must be up at least 1% in 5min (momentum)
  maxPriceChange5m: 60,       // Skip if already pumped 60%+ (too late)
  minVolume24h: 5000,         // $5K min 24h volume (lowered for boosted tokens)
  minBuySellRatio: 0.35,      // At least 35% buys (not pure dumping)

  // Safety - Protected but with chances
  maxRiskScore: 55,           // Tighter safety
  minLiquidity: 8000,         // $8K min liquidity (more buffer)
  minTokenAge: 3,             // 3 min token age
  maxWhaleHolding: 45,        // Reject if whale >45%
  requireSellable: true,      // Must pass sell simulation
  useBirdeyeSimulation: true, // Use Birdeye API for pre-buy simulation (more accurate)

  // Timing - Fast monitoring
  scanInterval: 3000,         // 3 sec scan (faster!)
  monitorInterval: 1500,      // 1.5 sec position check (super fast exits!)
  cooldownMs: 10000,          // 10s between buys
};

// === SETUP ===
const HELIUS_RPC = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '2bYF7j9KWjEfuLLpiYezrH9z7HUpBc3J29zE7j6ZviNkavRkZZFPNurog251FNxHzgs56PwwcrX4DbEN4FSpqkcx';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// Activity logging
function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const colors = {
    INFO: '\x1b[36m',    // Cyan
    SUCCESS: '\x1b[32m', // Green
    WARN: '\x1b[33m',    // Yellow
    ERROR: '\x1b[31m',   // Red
    PROFIT: '\x1b[32m',  // Green
    LOSS: '\x1b[31m'     // Red
  };
  const reset = '\x1b[0m';
  const color = colors[type] || colors.INFO;
  const logMsg = `[${timestamp}] ${color}${type}${reset}: ${message}`;
  
  console.log(logMsg);
  
  // Also write to activity log file
  try {
    const cleanMsg = `[${timestamp}] ${type}: ${message}\n`;
    fs.appendFileSync('sniper-activity.log', cleanMsg);
  } catch (e) {
    // Ignore file write errors
  }
}

// State
let positions = new Map();
let lastBuyTime = 0;
let recentlyTraded = new Map();  // mint -> timestamp (avoid re-buying same token)
let avoidList = new Set();       // Tokens that caused losses - never trade again
const TOKEN_COOLDOWN_MS = 600000; // 10 min cooldown per token (increased)
let stats = { scanned: 0, rejected: 0, bought: 0, sold: 0, honeypots: 0 };

// Load avoid list from file
function loadAvoidList() {
  try {
    const data = JSON.parse(fs.readFileSync('avoid-tokens.json', 'utf-8'));
    avoidList = new Set(data.tokens || []);
    console.log(`🚫 Loaded ${avoidList.size} tokens to avoid`);
  } catch {
    // No avoid list yet
  }
}

// Save avoid list
function saveAvoidList() {
  fs.writeFileSync('avoid-tokens.json', JSON.stringify({
    tokens: Array.from(avoidList),
    lastUpdated: Date.now()
  }, null, 2));
}

// === POSITION MANAGEMENT ===
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync('positions-safe.json', 'utf-8'));
    positions = new Map(data.positions || []);
    stats = data.stats || stats;
    console.log(`📂 Loaded ${positions.size} positions`);
  } catch { 
    console.log('📂 Starting fresh');
  }
}

function savePositions() {
  const data = {
    positions: Array.from(positions.entries()),
    stats,
    lastSaved: Date.now()
  };
  fs.writeFileSync('positions-safe.json', JSON.stringify(data, null, 2));
}

// === BALANCE ===
async function getBalance() {
  const bal = await connection.getBalance(wallet.publicKey);
  return bal / 1e9;
}

// === TOKEN DISCOVERY ===
// Uses DexScreener boosted tokens - higher quality than random new pools
async function findNewTokens() {
  try {
    // Get boosted tokens (projects that paid for visibility = more serious)
    const response = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const data = await response.json();

    const tokens = [];
    const solTokens = (data || []).filter(t => t.chainId === 'solana').slice(0, 15);

    for (const token of solTokens) {
      if (token.tokenAddress && token.tokenAddress !== SOL_MINT && !positions.has(token.tokenAddress)) {
        tokens.push({
          mint: token.tokenAddress,
          symbol: token.description?.split(' ')?.[0] || 'BOOST',
          boosted: true
        });
      }
    }

    // Also check trending tokens
    try {
      const trendingRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
      const trending = await trendingRes.json();
      const solTrending = (trending || []).filter(t => t.chainId === 'solana').slice(0, 5);

      for (const token of solTrending) {
        if (token.tokenAddress && !positions.has(token.tokenAddress) && !tokens.find(t => t.mint === token.tokenAddress)) {
          tokens.push({
            mint: token.tokenAddress,
            symbol: token.description?.split(' ')?.[0] || 'TREND',
            trending: true
          });
        }
      }
    } catch (e) {}

    return tokens;
  } catch (error) {
    return [];
  }
}

// === ENTRY SIGNAL CHECK ===
async function checkEntrySignals(mint, symbol) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data.pairs?.[0];

    if (!pair) {
      console.log(`   📊 No market data - SKIP`);
      return { valid: false, reason: 'No market data' };
    }

    const liquidity = pair.liquidity?.usd || 0;
    const volume24h = pair.volume?.h24 || 0;
    const priceChange5m = pair.priceChange?.m5 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const buys = pair.txns?.h1?.buys || 0;
    const sells = pair.txns?.h1?.sells || 0;
    const buyRatio = (buys + sells) > 0 ? buys / (buys + sells) : 0;

    // Check liquidity
    if (liquidity < CONFIG.minLiquidity) {
      console.log(`   💧 Liquidity $${liquidity.toFixed(0)} < $${CONFIG.minLiquidity} - SKIP`);
      return { valid: false, reason: 'Low liquidity' };
    }

    // Check volume
    if (volume24h < CONFIG.minVolume24h) {
      console.log(`   📉 Volume $${volume24h.toFixed(0)} < $${CONFIG.minVolume24h} - SKIP`);
      return { valid: false, reason: 'Low volume' };
    }

    // Check momentum - must be going UP
    if (priceChange5m < CONFIG.minPriceChange5m) {
      console.log(`   📈 5m change ${priceChange5m.toFixed(1)}% < ${CONFIG.minPriceChange5m}% - NO MOMENTUM`);
      return { valid: false, reason: 'No momentum' };
    }

    // Check not buying the top
    if (priceChange5m > CONFIG.maxPriceChange5m) {
      console.log(`   🔝 5m change ${priceChange5m.toFixed(1)}% > ${CONFIG.maxPriceChange5m}% - TOO LATE`);
      return { valid: false, reason: 'Already pumped' };
    }

    // Check buy/sell ratio
    if (buyRatio < CONFIG.minBuySellRatio) {
      console.log(`   ⚖️ Buy ratio ${(buyRatio*100).toFixed(0)}% < ${CONFIG.minBuySellRatio*100}% - DUMPING`);
      return { valid: false, reason: 'More sells than buys' };
    }

    // Get ML prediction score
    let mlScore = 0.5;
    try {
      const mlResult = analyzeToken({
        liquidity,
        volume: volume24h,
        ageHours: 0.5, // New tokens
        priceVelocity: priceChange5m / 100,
        volumeSpike: volume24h > 50000 ? 0.8 : 0.4,
        holderConcentration: 0.3
      });
      mlScore = mlResult.score;
      console.log(`   🧠 ML Score: ${(mlScore * 100).toFixed(0)}% (${mlResult.action})`);
    } catch (e) {
      // ML not available, use default
    }

    console.log(`   ✅ GOOD ENTRY: Liq $${(liquidity/1000).toFixed(1)}K | Vol $${(volume24h/1000).toFixed(1)}K | 5m +${priceChange5m.toFixed(1)}% | Buys ${(buyRatio*100).toFixed(0)}%`);

    return {
      valid: true,
      data: { liquidity, volume24h, priceChange5m, priceChange1h, buyRatio, mlScore }
    };

  } catch (error) {
    console.log(`   ❌ Signal check failed: ${error.message}`);
    return { valid: false, reason: 'API error' };
  }
}

// === HONEYPOT CHECK ===
async function isTokenSafe(mint, symbol) {
  console.log(`\n🔍 Scanning ${symbol} for honeypot...`);
  stats.scanned++;

  try {
    const check = await quickCheck(mint, CONFIG.maxRiskScore);

    // Log results
    if (check.isHoneypot) {
      console.log(`   🍯 HONEYPOT DETECTED! Skipping.`);
      console.log(`   Reason: ${check.flags.slice(0, 2).join(', ')}`);
      stats.honeypots++;
      return false;
    }

    if (!check.safe) {
      console.log(`   ⚠️ Risk too high: ${check.riskScore}/100 (max: ${CONFIG.maxRiskScore})`);
      console.log(`   ${check.recommendation}`);
      stats.rejected++;
      return false;
    }

    if (!check.canSell && CONFIG.requireSellable) {
      console.log(`   ❌ Cannot sell this token. Skipping.`);
      stats.rejected++;
      return false;
    }

    console.log(`   ✅ SAFE! Risk: ${check.riskScore}/100`);
    console.log(`   ${check.recommendation}`);
    return true;

  } catch (error) {
    console.log(`   ❓ Check failed: ${error.message}. Skipping for safety.`);
    stats.rejected++;
    return false;
  }
}

// === SWAP FUNCTIONS ===
async function buyToken(mint, symbol) {
  const amountLamports = Math.floor(CONFIG.tradeAmountSol * 1e9);
  
  console.log(`\n🛒 Buying ${symbol}...`);
  
  try {
    // Get quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amountLamports}&slippageBps=1000`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
    });
    const quote = await quoteRes.json();
    
    if (quote.error) {
      console.log(`   ❌ Quote error: ${quote.error}`);
      return null;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05'
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000
      })
    });
    
    const { swapTransaction, error } = await swapRes.json();
    if (error) {
      console.log(`   ❌ Swap error: ${error}`);
      return null;
    }
    
    // Sign and send
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });
    
    console.log(`   📤 TX: ${sig.slice(0, 20)}...`);
    
    // Wait for confirmation
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) {
      console.log(`   ❌ TX failed`);
      return null;
    }
    
    const tokenAmount = parseInt(quote.outAmount);
    console.log(`   ✅ Bought ${tokenAmount.toLocaleString()} ${symbol}`);
    
    return {
      symbol,
      tokenAmount,
      entryAmountSol: CONFIG.tradeAmountSol,
      entryTime: Date.now(),
      signature: sig
    };
    
  } catch (error) {
    console.log(`   ❌ Buy failed: ${error.message}`);
    return null;
  }
}

async function sellToken(mint, position) {
  log(`💰 Attempting to sell ${position.symbol} (${position.tokenAmount.toLocaleString()} tokens)...`, 'INFO');
  
  try {
    // Get current token balance from chain
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      mint: new PublicKey(mint)
    });
    
    if (tokenAccounts.value.length === 0) {
      log(`⚠️ No token account found for ${position.symbol} - position already closed or never opened`, 'WARN');
      return true; // Remove position anyway
    }
    
    const accountData = tokenAccounts.value[0].account.data;
    const tokenAmount = accountData.readBigUInt64LE(64);
    
    if (tokenAmount <= 0n) {
      log(`⚠️ Zero balance for ${position.symbol} - already sold or burned`, 'WARN');
      return true;
    }
    
    log(`   Token balance: ${tokenAmount.toString()} units`, 'INFO');
    
    // Get quote for actual balance
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${tokenAmount.toString()}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
    });
    const quote = await quoteRes.json();
    
    if (quote.error) {
      log(`❌ ${position.symbol} SELL QUOTE FAILED: ${quote.error}`, 'ERROR');
      log(`   This is likely a HONEYPOT - cannot sell this token!`, 'ERROR');
      
      // Mark as honeypot after quote failure
      position.failedQuotes = (position.failedQuotes || 0) + 1;
      if (position.failedQuotes >= 2) {
        log(`🍯 Confirming ${position.symbol} is HONEYPOT - adding to avoid list`, 'ERROR');
        avoidList.add(mint);
        saveAvoidList();
        stats.honeypots++;
        return true; // Remove position
      }
      return false;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05'
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 100000
      })
    });
    
    const { swapTransaction, error } = await swapRes.json();
    if (error) {
      console.log(`   ❌ Swap error: ${error}`);
      return false;
    }
    
    // Sign and send
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });
    
    console.log(`   📤 TX: ${sig.slice(0, 20)}...`);
    
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) {
      console.log(`   ❌ Sell TX failed - might be honeypot!`);
      return false;
    }
    
    const soldFor = parseInt(quote.outAmount) / 1e9;
    const pnl = ((soldFor / position.entryAmountSol) - 1) * 100;
    const profitSOL = soldFor - position.entryAmountSol;
    const profitUSD = profitSOL * 230;

    const logType = pnl >= 0 ? 'PROFIT' : 'LOSS';
    log(`✅ SOLD ${position.symbol}: ${soldFor.toFixed(6)} SOL (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)`, logType);
    log(`   Entry: ${position.entryAmountSol.toFixed(6)} SOL → Exit: ${soldFor.toFixed(6)} SOL`, 'INFO');
    log(`   Profit: ${profitSOL >= 0 ? '+' : ''}${profitSOL.toFixed(6)} SOL ($${profitUSD >= 0 ? '+' : ''}${profitUSD.toFixed(2)})`, logType);
    stats.sold++;

    // 🧠 ML LEARNING: Record this trade outcome
    try {
      recordTradeOutcome({
        mint,
        symbol: position.symbol,
        entryAmountSol: position.entryAmountSol,
        exitAmountSol: soldFor,
        pnlPercent: pnl,
        holdTimeMinutes: (Date.now() - position.entryTime) / 60000,
        won: pnl > 0,
        entrySignals: position.entrySignals || {},
        timestamp: Date.now()
      });
      console.log(`   🧠 ML: Trade recorded for learning`);
    } catch (e) {
      // ML recording failed, continue
    }

    // 🚫 Add to avoid list if significant loss (> -5%)
    if (pnl < -5) {
      avoidList.add(mint);
      saveAvoidList();
      console.log(`   🚫 Added ${position.symbol} to avoid list (${pnl.toFixed(1)}% loss)`);
    }

    return true;
    
  } catch (error) {
    console.log(`   ❌ Sell failed: ${error.message}`);
    return false;
  }
}

// === POSITION MONITORING ===
async function checkPositions() {
  if (positions.size === 0) return;
  
  for (const [mint, pos] of positions) {
    try {
      // Check if position is too old
      const positionAgeMinutes = (Date.now() - pos.entryTime) / 60000;
      if (positionAgeMinutes > CONFIG.maxHoldMinutes) {
        console.log(`\n⏰ ${pos.symbol}: Held ${positionAgeMinutes.toFixed(1)} min (max ${CONFIG.maxHoldMinutes}) - AUTO-EXIT`);
        const sold = await sellToken(mint, pos);
        if (sold || !sold) {  // Try to sell, but remove either way
          positions.delete(mint);
          savePositions();
        }
        continue;
      }

      // Get current price
      const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.tokenAmount}&slippageBps=3000`;
      const res = await fetch(quoteUrl, {
        headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
      });
      const quote = await res.json();
      
      if (quote.error || !quote.outAmount) {
        // Can't get quote - might be honeypot or dead
        pos.failedQuotes = (pos.failedQuotes || 0) + 1;
        const holdMinutes = (Date.now() - pos.entryTime) / 60000;
        
        if (pos.failedQuotes >= 2 || holdMinutes > 30) {  // 2 failed quotes OR stuck >30min = honeypot
          log(`🍯 HONEYPOT DETECTED: ${pos.symbol} - can't get sell quote after ${pos.failedQuotes} attempts (${holdMinutes.toFixed(1)}min hold)`, 'ERROR');
          log(`   Lost: ${pos.entryAmountSol.toFixed(6)} SOL (~$${(pos.entryAmountSol * 230).toFixed(2)})`, 'LOSS');
          
          // Add to avoid list immediately
          avoidList.add(mint);
          saveAvoidList();
          
          positions.delete(mint);
          stats.honeypots++;
          savePositions();
        } else {
          log(`⚠️ ${pos.symbol}: Quote failed (attempt ${pos.failedQuotes}/2)`, 'WARN');
        }
        continue;
      }
      
      const currentValue = parseInt(quote.outAmount) / 1e9;
      const entryValue = pos.entryAmountSol;
      const profitSOL = currentValue - entryValue;
      const profitUSD = profitSOL * 230; // ~$230 per SOL
      const pnlPct = ((currentValue / entryValue) - 1) * 100;
      
      // Update position with current metrics
      pos.currentValue = currentValue;
      pos.profitSOL = profitSOL;
      pos.profitUSD = profitUSD;
      pos.pnlPct = pnlPct;

      // Track peak value for trailing stop
      if (!pos.peakValue || currentValue > pos.peakValue) {
        pos.peakValue = currentValue;
        pos.peakPnlPct = pnlPct;
        savePositions();
      }

      // Calculate drop from peak for trailing stop
      const dropFromPeak = pos.peakPnlPct ? (pos.peakPnlPct - pnlPct) : 0;

      // Check take profit
      if (pnlPct >= CONFIG.takeProfitPct) {
        log(`🎯 TAKE PROFIT! ${pos.symbol} at +${pnlPct.toFixed(2)}% (+${profitSOL.toFixed(6)} SOL / $${profitUSD.toFixed(2)})`, 'PROFIT');
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }

      // Check HARD stop loss
      if (pnlPct <= -CONFIG.stopLossPct) {
        log(`🛑 HARD STOP! ${pos.symbol} at ${pnlPct.toFixed(2)}% (${profitSOL.toFixed(6)} SOL / $${profitUSD.toFixed(2)}) - limit: -${CONFIG.stopLossPct}%`, 'LOSS');
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }

      // Check TRAILING stop (dropped 5% from peak, only if we were up)
      if (pos.peakPnlPct > 0 && dropFromPeak >= CONFIG.trailingStopPct) {
        console.log(`\n📉 TRAILING STOP! ${pos.symbol} dropped ${dropFromPeak.toFixed(1)}% from peak (+${pos.peakPnlPct.toFixed(1)}%)`);
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }
      
    } catch (error) {
      // Silent fail for monitoring
    }
  }
}

// === DISPLAY ===
function displayStatus(balance) {
  console.clear();
  console.log('═'.repeat(60));
  console.log('🛡️  SAFE SNIPER BOT v3 - ML Enhanced');
  console.log('═'.repeat(60));

  // Get ML stats
  let mlInfo = '';
  try {
    const ml = getModelStats();
    mlInfo = ` | 🧠 ML: ${ml.accuracy || 0}% acc (${ml.tradesRecorded || 0} trades)`;
  } catch (e) {}

  console.log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 230).toFixed(2)})${mlInfo}`);
  console.log(`📊 Scanned: ${stats.scanned} | 🍯 Honeypots: ${stats.honeypots} | ❌ Rejected: ${stats.rejected}`);
  console.log(`🛒 Bought: ${stats.bought} | 💰 Sold: ${stats.sold}`);
  console.log(`⚙️  Risk Threshold: ${CONFIG.maxRiskScore}/100`);
  console.log('─'.repeat(60));
  
  if (positions.size > 0) {
    console.log('\n📈 OPEN POSITIONS:');
    for (const [mint, pos] of positions) {
      const age = Math.floor((Date.now() - pos.entryTime) / 60000);
      console.log(`   ${pos.symbol}: ${pos.tokenAmount.toLocaleString()} tokens | Entry: ${pos.entryAmountSol} SOL | ${age}m ago`);
    }
  } else {
    console.log('\n   No open positions');
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('Press Ctrl+C to stop');
  console.log('═'.repeat(60) + '\n');
}

// === STARTUP PROTECTION ===
// Immediately exit any stale positions from previous sessions
async function cleanupStalePositions() {
  if (positions.size === 0) return;

  console.log('\n🔍 Checking for stale positions from previous session...');

  for (const [mint, pos] of positions) {
    const ageMinutes = (Date.now() - pos.entryTime) / 60000;

    // If held longer than max hold time, force exit
    if (ageMinutes > CONFIG.maxHoldMinutes) {
      console.log(`⚠️ STALE POSITION: ${pos.symbol} held ${ageMinutes.toFixed(0)} min - FORCE SELLING`);

      const sold = await sellToken(mint, pos);
      if (sold) {
        positions.delete(mint);
        console.log(`   ✅ Closed stale position`);
      } else {
        // Can't sell - might be honeypot, just remove from tracking
        console.log(`   ❌ Cannot sell - removing from tracking (possible honeypot)`);
        positions.delete(mint);
      }
      savePositions();
    }
  }

  console.log('✅ Startup cleanup complete\n');
}

// === MAIN LOOP ===
async function main() {
  console.log('🛡️ Starting Safe Sniper Bot v3...\n');
  console.log(`Wallet: ${wallet.publicKey.toString()}`);

  loadPositions();
  loadAvoidList();  // Load tokens we should never trade again

  // CRITICAL: Clean up any stale positions FIRST
  await cleanupStalePositions();

  let balance = await getBalance();
  displayStatus(balance);
  
  // Scan for new tokens
  setInterval(async () => {
    try {
      // Update balance
      balance = await getBalance();
      
      // Check existing positions
      await checkPositions();
      
      // Display
      displayStatus(balance);
      
      // Cooldown check
      if (Date.now() - lastBuyTime < CONFIG.cooldownMs) {
        console.log(`⏳ Cooldown... ${Math.ceil((CONFIG.cooldownMs - (Date.now() - lastBuyTime)) / 1000)}s`);
        return;
      }
      
      // Don't buy if we have max positions or low balance
      if (positions.size >= CONFIG.maxPositions) {
        console.log(`📦 Max positions reached (${positions.size}/${CONFIG.maxPositions})`);
        return;
      }
      
      if (balance < CONFIG.tradeAmountSol + 0.002) {
        console.log(`⚠️ Low balance: ${balance.toFixed(6)} SOL`);
        return;
      }
      
      // Find new tokens
      const tokens = await findNewTokens();
      console.log(`\n🔎 Found ${tokens.length} new tokens to scan...`);
      
      for (const token of tokens.slice(0, 5)) {
        // Skip if already have position
        if (positions.has(token.mint)) continue;

        // Skip if on permanent avoid list (caused losses before)
        if (avoidList.has(token.mint)) {
          console.log(`   🚫 ${token.symbol}: On avoid list - SKIPPING`);
          continue;
        }

        // Skip if recently traded this token (10 min cooldown)
        const lastTradeTime = recentlyTraded.get(token.mint);
        if (lastTradeTime && (Date.now() - lastTradeTime) < TOKEN_COOLDOWN_MS) {
          const cooldownLeft = Math.ceil((TOKEN_COOLDOWN_MS - (Date.now() - lastTradeTime)) / 60000);
          console.log(`   ⏳ ${token.symbol}: Cooldown ${cooldownLeft}m remaining`);
          continue;
        }

        // STEP 1: Check entry signals FIRST (fast - just API call)
        const signals = await checkEntrySignals(token.mint, token.symbol);
        if (!signals.valid) {
          stats.rejected++;
          continue;  // Skip to next token
        }

        // STEP 2: Only if signals good, do honeypot check (slower)
        const safe = await isTokenSafe(token.mint, token.symbol);
        if (!safe) continue;

        // STEP 3: Both checks passed - BUY!
        console.log(`\n🚀 EXECUTING TRADE: ${token.symbol}`);
        const result = await buyToken(token.mint, token.symbol);

        if (result) {
          // Store entry data for better tracking
          result.entrySignals = signals.data;
          positions.set(token.mint, result);
          recentlyTraded.set(token.mint, Date.now());  // Add to cooldown
          lastBuyTime = Date.now();
          stats.bought++;
          savePositions();
          break;  // One buy per cycle
        }

        // Small delay between checks
        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error) {
      console.error('Loop error:', error.message);
    }
    
  }, CONFIG.scanInterval);
  
  // Position monitor (faster)
  setInterval(checkPositions, CONFIG.monitorInterval);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  savePositions();
  console.log('✅ Positions saved');
  process.exit(0);
});

main().catch(console.error);
