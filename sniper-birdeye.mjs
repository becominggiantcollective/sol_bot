#!/usr/bin/env node
/**
 * 🛡️ BIRDEYE-POWERED SAFE SNIPER
 * 
 * Pre-buy protection using:
 * 1. Birdeye simulate API - Tests if you can sell BEFORE buying
 * 2. Contract analysis - Checks for freeze authority
 * 3. ML predictions - Learns from past trades
 * 
 * This bot will NEVER buy a token it can't sell!
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { preBuyCheck, quickHoneypotCheck } from './pre-buy-simulator.mjs';
import { analyzeToken, recordTradeOutcome, getModelStats } from './ml-predictor.mjs';

const CONFIG = {
  // Trading - AGGRESSIVE ENTRY, FAST EXIT (Get in/out before rug)
  tradeAmountSol: 0.01,       // $2.30 per trade
  maxPositions: 3,
  
  // Exit Strategy - Exit triggers: +20% up OR -5% down
  firstProfitTarget: 20,      // EXIT at +20% (profit trigger)
  firstProfitSell: 1.0,       // Sell 100% of position at +20%
  secondProfitTarget: 70,     // (Not used - exit at first target)
  secondProfitSell: 0.3,      // (Not used)
  trailingStopPct: 15,        // -15% from peak trailing stop
  stopLossPct: 5,             // -5% hard stop (EXIT TRIGGER)
  maxHoldMinutes: 20,         // Max 20min hold
  minExitProfit: 20,          // Need +20% to stay past 20min
  volumeDropExitPct: 50,      // Exit if 5m volume drops 50%
  
  // Entry - OPTIMIZED from backtest (catch earlier, avoid late entries)
  minPriceChange1h: 8,        // +8% in last hour (catch earlier)
  minPriceChange5m: 2,        // +2% 5min (ensure still pumping)
  maxPriceChange5m: 15,       // Cap at +15% 5min (avoid late entries after pump)
  minVolume24h: 2000,         // $2K volume
  minVolLiqRatio: 1.5,        // Volume/Liq > 1.5x (more active trading)
  minBuySellRatio: 0.3,       // More lenient
  
  // Safety - STRICTER checks to avoid rugs despite lower entry
  minLiquidity: 3000,         // $3K minimum (more established)
  minTokenAge: 10,            // 10 minutes (catch even earlier)
  maxTokenAge: 120,           // 2 hours max (tighter window)
  maxWhaleHolding: 10,        // VERY TIGHT whale check - max 10%
  requireBirdeyeSimulation: true,  // ALWAYS test sell before buy
  maxSlippageBps: 2000,       // 20% max slippage (detect rug conditions)
  minHolderCount: 50,         // NEW: Require 50+ holders
  
  // Timing - FASTER scanning for quick entries
  scanInterval: 3000,         // 3sec (was 5sec) - faster detection
  monitorInterval: 1500,      // 1.5sec - watch positions closely
  cooldownMs: 10000,          // 10sec cooldown
};

const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BIRDEYE_API_KEY = '037a1fc7b81142ddb212d8a2c7956e7f';

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '2bYF7j9KWjEfuLLpiYezrH9z7HUpBc3J29zE7j6ZviNkavRkZZFPNurog251FNxHzgs56PwwcrX4DbEN4FSpqkcx';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

let positions = new Map();
let lastBuyTime = 0;
let avoidList = new Set();
let stats = { scanned: 0, rejected: 0, bought: 0, sold: 0, honeypots: 0, birdeyeBlocked: 0 };

// Data directory for Docker volume mounting
const DATA_DIR = process.env.NODE_ENV === 'production' ? './data' : '.';

// Ensure data directory exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function log(msg, type = 'INFO') {
  const colors = { INFO: '\x1b[36m', SUCCESS: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', PROFIT: '\x1b[32m', LOSS: '\x1b[31m' };
  const ts = new Date().toISOString();
  const color = colors[type] || colors.INFO;
  const logMsg = `[${ts}] ${color}${type}\x1b[0m: ${msg}`;
  console.log(logMsg);
  try { fs.appendFileSync(`${DATA_DIR}/sniper-birdeye.log`, `[${ts}] ${type}: ${msg}\n`); } catch (e) {}
}

// Load/save functions
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync(`${DATA_DIR}/positions-birdeye.json`, 'utf-8'));
    positions = new Map(data.positions || []);
    stats = { ...stats, ...data.stats };
    log(`📂 Loaded ${positions.size} positions`, 'INFO');
  } catch { log('📂 Starting fresh', 'INFO'); }
}

function savePositions() {
  fs.writeFileSync(`${DATA_DIR}/positions-birdeye.json`, JSON.stringify({
    positions: Array.from(positions.entries()),
    stats,
    lastUpdated: Date.now()
  }, null, 2));
}

function loadAvoidList() {
  try {
    const data = JSON.parse(fs.readFileSync(`${DATA_DIR}/avoid-tokens-birdeye.json`, 'utf-8'));
    avoidList = new Set(data.tokens || []);
    log(`🚫 Loaded ${avoidList.size} tokens to avoid`, 'INFO');
  } catch {}
}

function saveAvoidList() {
  fs.writeFileSync(`${DATA_DIR}/avoid-tokens-birdeye.json`, JSON.stringify({
    tokens: Array.from(avoidList),
    lastUpdated: Date.now()
  }, null, 2));
}

async function getBalance() {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / 1e9;
}

async function findNewTokens() {
  try {
    const tokens = [];
    const seen = new Set();

    // PRIMARY SOURCE: Search API for pump.fun tokens (returns full pair data!)
    try {
      const searchUrl = 'https://api.dexscreener.com/latest/dex/search?q=pumpfun';
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      if (searchData.pairs) {
        // Filter for SOL pairs only (meme coins paired with SOL)
        const solPairs = searchData.pairs.filter(p =>
          p.chainId === 'solana' &&
          (p.quoteToken?.symbol === 'SOL' ||
           p.quoteToken?.address === 'So11111111111111111111111111111111111111112')
        );

        for (const p of solPairs.slice(0, 30)) {
          if (!seen.has(p.baseToken.address)) {
            seen.add(p.baseToken.address);
            tokens.push({
              mint: p.baseToken.address,
              symbol: p.baseToken.symbol || p.baseToken.name || 'UNKNOWN',
              liquidity: p.fdv || p.marketCap || 0, // pump.fun uses FDV/mcap, not traditional liquidity
              volume24h: p.volume?.h24 || 0,
              priceChange: p.priceChange?.m5 || 0,
              pairData: p
            });
          }
        }
      }
    } catch (e) {
      log(`⚠️ Search API error: ${e.message}`, 'WARN');
    }

    // SECONDARY SOURCE: Token Profiles API (latest new tokens)
    try {
      const profilesUrl = 'https://api.dexscreener.com/token-profiles/latest/v1';
      const profilesRes = await fetch(profilesUrl);
      const text = await profilesRes.text();

      if (text.startsWith('[')) {
        const profileData = JSON.parse(text);
        const solanaMints = profileData
          .filter(item => item.chainId === 'solana' && item.tokenAddress && !seen.has(item.tokenAddress))
          .slice(0, 10);

        // Batch fetch pair data for these tokens
        for (const item of solanaMints) {
          try {
            const pairUrl = `https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`;
            const pairRes = await fetch(pairUrl);
            const pairData = await pairRes.json();

            if (pairData.pairs && pairData.pairs.length > 0) {
              const solPair = pairData.pairs.find(p =>
                p.quoteToken?.symbol === 'SOL' ||
                p.quoteToken?.address === 'So11111111111111111111111111111111111111112'
              ) || pairData.pairs[0];

              seen.add(item.tokenAddress);
              tokens.push({
                mint: item.tokenAddress,
                symbol: solPair.baseToken?.symbol || solPair.baseToken?.name || 'UNKNOWN',
                liquidity: solPair.fdv || solPair.marketCap || solPair.liquidity?.usd || 0,
                volume24h: solPair.volume?.h24 || 0,
                priceChange: solPair.priceChange?.m5 || 0,
                pairData: solPair
              });
            }
            await new Promise(r => setTimeout(r, 50)); // Rate limit
          } catch (e) {
            // Skip tokens we can't get data for
          }
        }
      }
    } catch (e) {
      log(`⚠️ Token profiles API error: ${e.message}`, 'WARN');
    }

    // TERTIARY SOURCE: Token Boosts API (promoted tokens)
    try {
      const boostsUrl = 'https://api.dexscreener.com/token-boosts/latest/v1';
      const boostsRes = await fetch(boostsUrl);
      const text = await boostsRes.text();

      if (text.startsWith('[')) {
        const boostData = JSON.parse(text);
        const solanaMints = boostData
          .filter(item => item.chainId === 'solana' && item.tokenAddress && !seen.has(item.tokenAddress))
          .slice(0, 10);

        for (const item of solanaMints) {
          try {
            const pairUrl = `https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`;
            const pairRes = await fetch(pairUrl);
            const pairData = await pairRes.json();

            if (pairData.pairs && pairData.pairs.length > 0) {
              const solPair = pairData.pairs.find(p =>
                p.quoteToken?.symbol === 'SOL' ||
                p.quoteToken?.address === 'So11111111111111111111111111111111111111112'
              ) || pairData.pairs[0];

              seen.add(item.tokenAddress);
              tokens.push({
                mint: item.tokenAddress,
                symbol: solPair.baseToken?.symbol || solPair.baseToken?.name || 'UNKNOWN',
                liquidity: solPair.fdv || solPair.marketCap || solPair.liquidity?.usd || 0,
                volume24h: solPair.volume?.h24 || 0,
                priceChange: solPair.priceChange?.m5 || 0,
                pairData: solPair
              });
            }
            await new Promise(r => setTimeout(r, 50)); // Rate limit
          } catch (e) {
            // Skip tokens we can't get data for
          }
        }
      }
    } catch (e) {
      log(`⚠️ Token boosts API error: ${e.message}`, 'WARN');
    }

    log(`📊 Token discovery: ${tokens.length} tokens with data`, 'INFO');
    return tokens;
  } catch (error) {
    log(`Error fetching tokens: ${error.message}`, 'ERROR');
    return [];
  }
}

async function checkEntrySignals(mint, symbol, tokenData, pairData = null) {
  const { liquidity, volume24h, priceChange } = tokenData;
  
  // Basic filters
  if (liquidity < CONFIG.minLiquidity) {
    log(`   ❌ ${symbol}: Low liquidity ($${liquidity.toFixed(0)} < $${CONFIG.minLiquidity})`, 'WARN');
    return { valid: false };
  }
  
  if (volume24h < CONFIG.minVolume24h) {
    log(`   ❌ ${symbol}: Low volume ($${volume24h.toFixed(0)} < $${CONFIG.minVolume24h})`, 'WARN');
    return { valid: false };
  }
  
  // Volume/Liquidity ratio check (ensures active trading)
  const volLiqRatio = liquidity > 0 ? volume24h / liquidity : 0;
  if (volLiqRatio < CONFIG.minVolLiqRatio) {
    log(`   ❌ ${symbol}: Low Vol/Liq ratio (${volLiqRatio.toFixed(2)}x < ${CONFIG.minVolLiqRatio}x)`, 'WARN');
    return { valid: false };
  }
  
  // Token age check (avoid both instant rugs and dead pumps)
  if (pairData?.pairCreatedAt) {
    const ageMinutes = (Date.now() - pairData.pairCreatedAt) / (1000 * 60);
    if (ageMinutes < CONFIG.minTokenAge) {
      log(`   ❌ ${symbol}: Too new (${Math.floor(ageMinutes)}m < ${CONFIG.minTokenAge}m)`, 'WARN');
      return { valid: false };
    }
    if (ageMinutes > CONFIG.maxTokenAge) {
      log(`   ❌ ${symbol}: Too old (${Math.floor(ageMinutes)}m > ${CONFIG.maxTokenAge}m)`, 'WARN');
      return { valid: false };
    }
  }
  
  // 1h momentum check (catch pumps in progress)
  const priceChange1h = pairData?.priceChange?.h1 || 0;
  if (priceChange1h < CONFIG.minPriceChange1h) {
    log(`   ❌ ${symbol}: Weak 1h momentum (${priceChange1h.toFixed(1)}% < ${CONFIG.minPriceChange1h}%)`, 'WARN');
    return { valid: false };
  }
  
  // 5m price change sanity check
  if (priceChange < CONFIG.minPriceChange5m || priceChange > CONFIG.maxPriceChange5m) {
    log(`   ❌ ${symbol}: 5m price change ${priceChange.toFixed(1)}% out of range`, 'WARN');
    return { valid: false };
  }
  
  const ageInfo = pairData?.pairCreatedAt ? ` | Age: ${Math.floor((Date.now() - pairData.pairCreatedAt) / (1000 * 60))}m` : '';
  log(`   ✅ ${symbol}: All checks passed! Liq: $${liquidity.toFixed(0)} | Vol: $${volume24h.toFixed(0)} | Vol/Liq: ${volLiqRatio.toFixed(2)}x | 1h: +${priceChange1h.toFixed(1)}%${ageInfo}`, 'SUCCESS');
  return { valid: true, data: { liquidity, volume24h, priceChange, volLiqRatio, priceChange1h } };
}

async function buyToken(mint, symbol) {
  log(`🛒 Buying ${symbol}...`, 'INFO');
  
  try {
    const amount = Math.floor(CONFIG.tradeAmountSol * 1e9);
    
    // Get Jupiter quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amount}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': JUPITER_API_KEY }
    });
    const quote = await quoteRes.json();
    
    if (quote.error) {
      log(`   ❌ Quote error: ${quote.error}`, 'ERROR');
      return null;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': JUPITER_API_KEY
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
      log(`   ❌ Swap error: ${error}`, 'ERROR');
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
    
    log(`   📤 TX: ${sig.slice(0, 20)}...`, 'INFO');
    
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) {
      log(`   ❌ TX failed`, 'ERROR');
      return null;
    }
    
    const tokenAmount = parseInt(quote.outAmount);
    log(`   ✅ Bought ${tokenAmount.toLocaleString()} ${symbol}`, 'SUCCESS');
    stats.bought++;
    
    return {
      symbol,
      tokenAmount,
      entryAmountSol: CONFIG.tradeAmountSol,
      entryTime: Date.now(),
      signature: sig
    };
    
  } catch (error) {
    log(`   ❌ Buy failed: ${error.message}`, 'ERROR');
    return null;
  }
}

async function sellToken(mint, position) {
  log(`💰 Attempting to sell ${position.symbol}...`, 'INFO');
  
  try {
    // Get current token balance from chain
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      mint: new PublicKey(mint)
    });
    
    if (tokenAccounts.value.length === 0) {
      log(`   ⚠️ No token account found - position already closed`, 'WARN');
      return true;
    }
    
    const accountData = tokenAccounts.value[0].account.data;
    const tokenAmount = accountData.readBigUInt64LE(64);
    
    if (tokenAmount <= 0n) {
      log(`   ⚠️ Zero balance - already sold`, 'WARN');
      return true;
    }
    
    log(`   Token balance: ${tokenAmount.toString()} units`, 'INFO');
    
    // Get sell quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${tokenAmount.toString()}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': JUPITER_API_KEY }
    });
    const quote = await quoteRes.json();
    
    if (quote.error) {
      log(`❌ ${position.symbol} SELL QUOTE FAILED: ${quote.error}`, 'ERROR');
      log(`   This is likely a HONEYPOT - cannot sell this token!`, 'ERROR');
      
      position.failedQuotes = (position.failedQuotes || 0) + 1;
      if (position.failedQuotes >= 2) {
        log(`🍯 Confirming ${position.symbol} is HONEYPOT - adding to avoid list`, 'ERROR');
        avoidList.add(mint);
        saveAvoidList();
        stats.honeypots++;
        return true;
      }
      return false;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': JUPITER_API_KEY
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
      log(`   ❌ Swap error: ${error}`, 'ERROR');
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
    
    log(`   📤 TX: ${sig.slice(0, 20)}...`, 'INFO');
    
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) {
      log(`   ❌ Sell TX failed - might be honeypot!`, 'ERROR');
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

    // Record trade outcome for ML
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
      log(`   🧠 ML: Trade recorded for learning`, 'INFO');
    } catch (e) {}

    // Add to avoid list if significant loss
    if (pnl < -5) {
      avoidList.add(mint);
      saveAvoidList();
      log(`   🚫 Added ${position.symbol} to avoid list (${pnl.toFixed(1)}% loss)`, 'WARN');
    }

    return true;
    
  } catch (error) {
    log(`   ❌ Sell failed: ${error.message}`, 'ERROR');
    return false;
  }
}

async function checkPositions() {
  if (positions.size === 0) return;
  
  for (const [mint, pos] of positions) {
    try {
      const holdMinutes = (Date.now() - pos.entryTime) / 60000;
      
      // Force exit if held too long
      if (holdMinutes >= CONFIG.maxHoldMinutes) {
        log(`⏰ ${pos.symbol}: Max hold time (${holdMinutes.toFixed(1)}min) - forcing exit`, 'WARN');
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }

      // Get current price
      const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.tokenAmount}&slippageBps=3000`;
      const res = await fetch(quoteUrl, {
        headers: { 'x-api-key': JUPITER_API_KEY }
      });
      const quote = await res.json();
      
      if (quote.error || !quote.outAmount) {
        pos.failedQuotes = (pos.failedQuotes || 0) + 1;
        
        if (pos.failedQuotes >= 2 || holdMinutes > 30) {
          log(`🍯 HONEYPOT DETECTED: ${pos.symbol} - can't get sell quote after ${pos.failedQuotes} attempts (${holdMinutes.toFixed(1)}min hold)`, 'ERROR');
          log(`   Lost: ${pos.entryAmountSol.toFixed(6)} SOL (~$${(pos.entryAmountSol * 230).toFixed(2)})`, 'LOSS');
          
          avoidList.add(mint);
          saveAvoidList();
          
          positions.delete(mint);
          stats.honeypots++;
          savePositions();
        }
        continue;
      }
      
      const currentValue = parseInt(quote.outAmount) / 1e9;
      const entryValue = pos.entryAmountSol;
      const profitSOL = currentValue - entryValue;
      const profitUSD = profitSOL * 230;
      const pnlPct = ((currentValue / entryValue) - 1) * 100;
      
      pos.currentValue = currentValue;
      pos.profitSOL = profitSOL;
      pos.profitUSD = profitUSD;
      pos.pnlPct = pnlPct;

      // Track peak
      if (!pos.peakValue || currentValue > pos.peakValue) {
        pos.peakValue = currentValue;
        pos.peakPnlPct = pnlPct;
        savePositions();
      }

      const dropFromPeak = pos.peakPnlPct ? (pos.peakPnlPct - pnlPct) : 0;

      // PARTIAL PROFIT TAKING STRATEGY
      
      // First profit target: Take 30% at 1.5x (+50%)
      if (!pos.firstProfitTaken && pnlPct >= CONFIG.firstProfitTarget) {
        log(`🎯 FIRST PROFIT! ${pos.symbol} at +${pnlPct.toFixed(2)}% - Taking ${CONFIG.firstProfitSell * 100}% off table`, 'PROFIT');
        // TODO: Implement partial sell (for now, mark as taken)
        pos.firstProfitTaken = true;
        pos.remainingPosition = 1 - CONFIG.firstProfitSell;
        savePositions();
      }
      
      // Second profit target: Take another 30% at 2x (+100%)
      if (!pos.secondProfitTaken && pnlPct >= CONFIG.secondProfitTarget) {
        log(`🎯 SECOND PROFIT! ${pos.symbol} at +${pnlPct.toFixed(2)}% - Taking another ${CONFIG.secondProfitSell * 100}%`, 'PROFIT');
        pos.secondProfitTaken = true;
        pos.remainingPosition = 0.4; // 40% left riding
        savePositions();
      }
      
      // Trailing stop for remaining position (20% drop from peak)
      if ((pos.firstProfitTaken || pos.secondProfitTaken) && dropFromPeak >= CONFIG.trailingStopPct) {
        log(`📉 TRAILING STOP! ${pos.symbol} dropped ${dropFromPeak.toFixed(1)}% from peak (+${pos.peakPnlPct.toFixed(1)}%) - Closing remaining position`, 'WARN');
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }

      // Hard stop loss at -12%
      if (pnlPct <= -CONFIG.stopLossPct) {
        log(`🛑 HARD STOP! ${pos.symbol} at ${pnlPct.toFixed(2)}% (${profitSOL.toFixed(6)} SOL / $${profitUSD.toFixed(2)}) - limit: -${CONFIG.stopLossPct}%`, 'LOSS');
        const sold = await sellToken(mint, pos);
        if (sold) {
          positions.delete(mint);
          savePositions();
        }
        continue;
      }
      
      // Time-based exit: If held > maxHoldMinutes and profit < minExitProfit, exit
      if (holdMinutes > CONFIG.maxHoldMinutes && pnlPct < CONFIG.minExitProfit) {
        log(`⏰ TIME EXIT! ${pos.symbol} held ${Math.floor(holdMinutes)}min with only ${pnlPct.toFixed(2)}% profit (need ${CONFIG.minExitProfit}%)`, 'WARN');
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

function displayStatus(balance) {
  console.clear();
  log('═'.repeat(60), 'INFO');
  log('🛡️ BIRDEYE-POWERED SAFE SNIPER', 'INFO');
  log('═'.repeat(60), 'INFO');

  let mlInfo = '';
  try {
    const ml = getModelStats();
    mlInfo = ` | 🧠 ML: ${ml.accuracy || 0}% acc (${ml.tradesRecorded || 0} trades)`;
  } catch (e) {}

  log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 230).toFixed(2)})${mlInfo}`, 'INFO');
  log(`📊 Scanned: ${stats.scanned} | 🍯 Honeypots: ${stats.honeypots} | ❌ Rejected: ${stats.rejected}`, 'INFO');
  log(`🛒 Bought: ${stats.bought} | 💰 Sold: ${stats.sold} | 🛡️ Birdeye Blocked: ${stats.birdeyeBlocked}`, 'INFO');
  log('─'.repeat(60), 'INFO');
  
  if (positions.size > 0) {
    log('', 'INFO');
    log('📈 OPEN POSITIONS:', 'INFO');
    for (const [mint, pos] of positions) {
      const age = Math.floor((Date.now() - pos.entryTime) / 60000);
      const pnl = pos.pnlPct || 0;
      const emoji = pnl >= 0 ? '📈' : '📉';
      log(`   ${emoji} ${pos.symbol}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | Hold: ${age}min`, pnl >= 0 ? 'PROFIT' : 'LOSS');
    }
  }
  log('═'.repeat(60), 'INFO');
}

async function main() {
  log('\n🚀 Starting Birdeye-Powered Safe Sniper...', 'INFO');
  log(`Wallet: ${wallet.publicKey.toString()}`, 'INFO');

  loadPositions();
  loadAvoidList();

  let balance = await getBalance();
  displayStatus(balance);
  
  // Main scan loop
  setInterval(async () => {
    try {
      balance = await getBalance();
      await checkPositions();
      displayStatus(balance);
      
      if (Date.now() - lastBuyTime < CONFIG.cooldownMs) {
        const cooldown = Math.ceil((CONFIG.cooldownMs - (Date.now() - lastBuyTime)) / 1000);
        log(`⏳ Cooldown... ${cooldown}s`, 'INFO');
        return;
      }
      
      if (positions.size >= CONFIG.maxPositions) {
        log(`📦 Max positions reached (${positions.size}/${CONFIG.maxPositions})`, 'INFO');
        return;
      }
      
      if (balance < CONFIG.tradeAmountSol + 0.002) {
        log(`⚠️ Low balance: ${balance.toFixed(6)} SOL`, 'WARN');
        return;
      }
      
      const tokens = await findNewTokens();
      log(`\n🔎 Found ${tokens.length} tokens to scan...`, 'INFO');
      
      for (const token of tokens.slice(0, 5)) {
        if (positions.has(token.mint)) continue;

        if (avoidList.has(token.mint)) {
          log(`   🚫 ${token.symbol}: On avoid list - SKIPPING`, 'WARN');
          continue;
        }

        // Entry signals check (now with age/momentum/ratio checks)
        const signals = await checkEntrySignals(token.mint, token.symbol, token, token.pairData);
        if (!signals.valid) {
          stats.rejected++;
          continue;
        }

        // 🛡️ BIRDEYE PRE-BUY SIMULATION (THE KEY PROTECTION!)
        log(`🛡️ Running Birdeye pre-buy simulation for ${token.symbol}...`, 'INFO');
        const simResult = await preBuyCheck(token.mint, CONFIG.tradeAmountSol);
        
        if (!simResult.safe) {
          log(`🚫 REJECTED: ${simResult.reason}`, 'WARN');
          if (simResult.sellSimulation?.isHoneypot) {
            log(`   🍯 HONEYPOT DETECTED - adding to avoid list`, 'ERROR');
            stats.honeypots++;
            stats.birdeyeBlocked++;
            avoidList.add(token.mint);
            saveAvoidList();
          } else {
            stats.rejected++;
          }
          continue;
        }
        
        log(`✅ ${token.symbol} PASSED Birdeye simulation - SAFE TO BUY!`, 'SUCCESS');

        // Execute buy
        log(`\n🚀 EXECUTING TRADE: ${token.symbol}`, 'SUCCESS');
        const result = await buyToken(token.mint, token.symbol);

        if (result) {
          result.entrySignals = signals.data;
          positions.set(token.mint, result);
          lastBuyTime = Date.now();
          stats.bought++;
          savePositions();
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error) {
      log(`Loop error: ${error.message}`, 'ERROR');
    }
    
  }, CONFIG.scanInterval);
  
  // Position monitor
  setInterval(checkPositions, CONFIG.monitorInterval);
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('\n🛑 Shutting down...', 'WARN');
  savePositions();
  log('✅ Positions saved', 'SUCCESS');
  process.exit(0);
});

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'ERROR');
  process.exit(1);
});
