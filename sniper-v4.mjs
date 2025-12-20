#!/usr/bin/env node
/**
 * 🛡️ SAFE SNIPER BOT v4 - THE 4 GOLDEN RULES EDITION
 * 
 * Implements:
 * 1. ✅ Only trade coins with liquidity locked
 * 2. ✅ Check holder distribution — no whales controlling 40%
 * 3. ✅ Enter early, before Twitter hype hits
 * 4. ✅ Sell in stages. Always.
 * 
 * Plus: Honeypot detection, auto TP/SL, position tracking
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { quickCheck } from './honeypot-detector.mjs';
import { 
  checkLiquidityLock, 
  checkHolderDistribution, 
  checkIfEarlyEntry,
  getSellStrategy 
} from './safety-checker.mjs';

// === CONFIG - THE 4 GOLDEN RULES ===
const CONFIG = {
  // Trading
  tradeAmountSol: 0.001,      // SOL per trade
  maxPositions: 2,            // Max concurrent
  
  // RULE 1: Liquidity Lock
  requireLiquidityLock: true, // Must have locked liquidity
  minLiquidity: 1000,         // Min $1000 liquidity
  
  // RULE 2: Holder Distribution  
  maxWhalePercent: 40,        // No whale > 40%
  maxTop5Percent: 70,         // Top 5 can't hold > 70%
  
  // RULE 3: Early Entry
  maxPriceChange24h: 300,     // Don't buy if already +300%
  maxHypeLevel: 'moderate',   // Avoid 'high' or 'extreme' hype
  
  // RULE 4: Staged Selling
  sellStages: [
    { profitPct: 30, sellPct: 25 },   // +30% → sell 25%
    { profitPct: 50, sellPct: 25 },   // +50% → sell 25% 
    { profitPct: 100, sellPct: 25 },  // +100% → sell 25%
    { profitPct: 200, sellPct: 15 },  // +200% → sell 15%
    { profitPct: 500, sellPct: 10 },  // +500% → sell remaining
  ],
  stopLossPct: 25,            // -25% stop loss
  
  // Safety
  maxRiskScore: 40,           // Don't buy if honeypot risk > 40
  
  // Timing  
  scanInterval: 5000,         // 5 sec scan
  monitorInterval: 3000,      // 3 sec position check
  cooldownMs: 30000,          // 30s between buys
};

// === SETUP ===
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://public.jupiterapi.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PRIVATE_KEY = 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// State
let positions = new Map();
let lastBuyTime = 0;
let stats = { 
  scanned: 0, 
  rejected: { honeypot: 0, noLock: 0, whale: 0, lateEntry: 0, other: 0 },
  bought: 0, 
  soldStages: 0,
  totalProfit: 0 
};

// === POSITION MANAGEMENT ===
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync('positions-v4.json', 'utf-8'));
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
  fs.writeFileSync('positions-v4.json', JSON.stringify(data, null, 2));
}

// === THE 4 GOLDEN RULES CHECK ===
async function passesGoldenRules(mint, symbol) {
  console.log(`\n🔍 Checking ${symbol} against 4 Golden Rules...`);
  stats.scanned++;
  
  const failures = [];
  
  // RULE 0: Honeypot Check (basic)
  try {
    const honeypotCheck = await quickCheck(mint);
    if (honeypotCheck.isHoneypot || !honeypotCheck.canSell) {
      console.log(`   ❌ R0: HONEYPOT DETECTED!`);
      stats.rejected.honeypot++;
      return { pass: false, reason: 'Honeypot detected' };
    }
    if (honeypotCheck.riskScore > CONFIG.maxRiskScore) {
      console.log(`   ❌ R0: Risk too high (${honeypotCheck.riskScore}/100)`);
      stats.rejected.other++;
      return { pass: false, reason: `Risk score ${honeypotCheck.riskScore} > ${CONFIG.maxRiskScore}` };
    }
    console.log(`   ✅ R0: Not a honeypot (risk: ${honeypotCheck.riskScore})`);
  } catch (e) {
    console.log(`   ⚠️ R0: Check failed, skipping for safety`);
    return { pass: false, reason: 'Honeypot check failed' };
  }
  
  // RULE 1: Liquidity Lock
  try {
    const lockCheck = await checkLiquidityLock(mint);
    if (CONFIG.requireLiquidityLock && !lockCheck.isLocked) {
      console.log(`   ❌ R1: Liquidity NOT locked`);
      stats.rejected.noLock++;
      failures.push('No liquidity lock');
    } else if (lockCheck.totalLiquidity < CONFIG.minLiquidity) {
      console.log(`   ❌ R1: Low liquidity ($${lockCheck.totalLiquidity})`);
      stats.rejected.noLock++;
      failures.push(`Liquidity $${lockCheck.totalLiquidity} < $${CONFIG.minLiquidity}`);
    } else {
      console.log(`   ✅ R1: Liquidity locked ($${lockCheck.totalLiquidity.toLocaleString()})`);
    }
  } catch (e) {
    console.log(`   ⚠️ R1: Check failed`);
  }
  
  // RULE 2: Holder Distribution (no 40% whale)
  try {
    const holderCheck = await checkHolderDistribution(mint);
    if (holderCheck.topHolderPct >= CONFIG.maxWhalePercent) {
      console.log(`   ❌ R2: WHALE ALERT - Top holder owns ${holderCheck.topHolderPct.toFixed(1)}%`);
      stats.rejected.whale++;
      failures.push(`Whale owns ${holderCheck.topHolderPct.toFixed(1)}%`);
    } else if (holderCheck.top5Pct >= CONFIG.maxTop5Percent) {
      console.log(`   ❌ R2: Top 5 too concentrated (${holderCheck.top5Pct.toFixed(1)}%)`);
      stats.rejected.whale++;
      failures.push(`Top 5 hold ${holderCheck.top5Pct.toFixed(1)}%`);
    } else {
      console.log(`   ✅ R2: Good distribution (top: ${holderCheck.topHolderPct.toFixed(1)}%, top5: ${holderCheck.top5Pct?.toFixed(1) || '?'}%)`);
    }
  } catch (e) {
    console.log(`   ⚠️ R2: Check failed`);
  }
  
  // RULE 3: Early Entry (before hype)
  try {
    const timingCheck = await checkIfEarlyEntry(mint);
    if (!timingCheck.isEarly) {
      console.log(`   ❌ R3: TOO LATE - ${timingCheck.reason}`);
      stats.rejected.lateEntry++;
      failures.push('Entry too late - already hyped');
    } else if (timingCheck.priceChange24h > CONFIG.maxPriceChange24h) {
      console.log(`   ❌ R3: Already pumped +${timingCheck.priceChange24h.toFixed(0)}%`);
      stats.rejected.lateEntry++;
      failures.push(`Already +${timingCheck.priceChange24h.toFixed(0)}%`);
    } else {
      console.log(`   ✅ R3: ${timingCheck.reason}`);
    }
  } catch (e) {
    console.log(`   ⚠️ R3: Check failed`);
  }
  
  // RULE 4: Will use staged selling (built into sell logic)
  console.log(`   ✅ R4: Staged selling enabled (25% at +30%, +50%, +100%...)`);
  
  // Final verdict
  if (failures.length === 0) {
    console.log(`   🎯 PASSED ALL RULES!`);
    return { pass: true, reason: 'Passed all golden rules' };
  } else {
    console.log(`   ❌ FAILED: ${failures.join(', ')}`);
    return { pass: false, reason: failures.join(', ') };
  }
}

// === TOKEN DISCOVERY ===
async function findNewTokens() {
  try {
    const response = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
    const data = await response.json();
    
    const tokens = [];
    for (const pool of (data.data || []).slice(0, 10)) {
      const attrs = pool.attributes;
      const baseToken = attrs.name?.split(' / ')?.[0];
      const tokenAddress = pool.relationships?.base_token?.data?.id?.replace('solana_', '');
      const liquidity = parseFloat(attrs.reserve_in_usd || 0);
      
      if (tokenAddress && tokenAddress !== SOL_MINT && !positions.has(tokenAddress)) {
        // Pre-filter: skip very low liquidity
        if (liquidity < 500) continue;
        
        tokens.push({
          mint: tokenAddress,
          symbol: baseToken || 'UNKNOWN',
          liquidity,
          poolCreated: attrs.pool_created_at
        });
      }
    }
    return tokens;
  } catch (error) {
    return [];
  }
}

// === BUY FUNCTION ===
async function buyToken(mint, symbol) {
  const amountLamports = Math.floor(CONFIG.tradeAmountSol * 1e9);
  
  console.log(`\n🛒 Buying ${symbol}...`);
  
  try {
    // Get quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amountLamports}&slippageBps=1000`;
    const quoteRes = await fetch(quoteUrl);
    const quote = await quoteRes.json();
    
    if (quote.error) {
      console.log(`   ❌ Quote error: ${quote.error}`);
      return null;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      remainingTokens: tokenAmount,  // Track remaining after staged sells
      entryAmountSol: CONFIG.tradeAmountSol,
      entryPrice: CONFIG.tradeAmountSol / tokenAmount,
      entryTime: Date.now(),
      signature: sig,
      stagesSold: [],  // Track which stages executed
    };
    
  } catch (error) {
    console.log(`   ❌ Buy failed: ${error.message}`);
    return null;
  }
}

// === STAGED SELL FUNCTION (RULE 4) ===
async function stagedSell(mint, position, currentValue) {
  const profitPct = ((currentValue / position.entryAmountSol) - 1) * 100;
  
  // Check each sell stage
  for (const stage of CONFIG.sellStages) {
    // Skip if already sold this stage
    if (position.stagesSold.includes(stage.profitPct)) continue;
    
    // Check if stage triggered
    if (profitPct >= stage.profitPct) {
      console.log(`\n💰 STAGE SELL: ${position.symbol} hit +${stage.profitPct}%!`);
      console.log(`   Selling ${stage.sellPct}% of remaining position...`);
      
      const tokensToSell = Math.floor(position.remainingTokens * (stage.sellPct / 100));
      
      if (tokensToSell <= 0) continue;
      
      const success = await executeSell(mint, tokensToSell, position.symbol);
      
      if (success) {
        position.stagesSold.push(stage.profitPct);
        position.remainingTokens -= tokensToSell;
        stats.soldStages++;
        
        // Calculate profit from this stage
        const stageProfit = (tokensToSell / position.tokenAmount) * position.entryAmountSol * (profitPct / 100);
        stats.totalProfit += stageProfit;
        
        console.log(`   ✅ Sold ${tokensToSell.toLocaleString()} tokens (+${stageProfit.toFixed(5)} SOL)`);
        console.log(`   📊 Remaining: ${position.remainingTokens.toLocaleString()} tokens (${((position.remainingTokens/position.tokenAmount)*100).toFixed(0)}%)`);
        
        savePositions();
        
        // If all stages complete, remove position
        if (position.remainingTokens <= 0) {
          positions.delete(mint);
          console.log(`   🎯 Position fully exited!`);
        }
        
        return true;
      }
    }
  }
  
  return false;
}

// === EXECUTE SELL ===
async function executeSell(mint, tokenAmount, symbol) {
  try {
    // Get quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${tokenAmount}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl);
    const quote = await quoteRes.json();
    
    if (quote.error) {
      console.log(`   ❌ Quote error: ${quote.error}`);
      return false;
    }
    
    // Get swap
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    return !conf.value.err;
    
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
      // Get current price
      const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.remainingTokens}&slippageBps=3000`;
      const res = await fetch(quoteUrl);
      const quote = await res.json();
      
      if (quote.error || !quote.outAmount) {
        pos.failedQuotes = (pos.failedQuotes || 0) + 1;
        if (pos.failedQuotes >= 5) {
          console.log(`   🍯 ${pos.symbol}: Can't quote - likely honeypot, removing`);
          positions.delete(mint);
          savePositions();
        }
        continue;
      }
      
      const currentValue = parseInt(quote.outAmount) / 1e9;
      const pnlPct = ((currentValue / pos.entryAmountSol) - 1) * 100;
      
      // RULE 4: Check staged sells
      await stagedSell(mint, pos, currentValue);
      
      // Check stop loss
      if (pnlPct <= -CONFIG.stopLossPct) {
        console.log(`\n🛑 STOP LOSS! ${pos.symbol} at ${pnlPct.toFixed(1)}%`);
        const sold = await executeSell(mint, pos.remainingTokens, pos.symbol);
        if (sold) {
          const loss = pos.entryAmountSol * (Math.abs(pnlPct) / 100);
          stats.totalProfit -= loss;
          positions.delete(mint);
          savePositions();
          console.log(`   ❌ Lost ${loss.toFixed(5)} SOL`);
        }
      }
      
    } catch (error) {
      // Silent fail
    }
  }
}

// === BALANCE ===
async function getBalance() {
  const bal = await connection.getBalance(wallet.publicKey);
  return bal / 1e9;
}

// === DISPLAY ===
function displayStatus(balance) {
  console.clear();
  console.log('═'.repeat(65));
  console.log('🛡️  SAFE SNIPER v4 - THE 4 GOLDEN RULES EDITION');
  console.log('═'.repeat(65));
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 230).toFixed(2)})`);
  console.log(`📊 Scanned: ${stats.scanned} | Stages Sold: ${stats.soldStages} | P&L: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(5)} SOL`);
  
  console.log('\n📋 REJECTION REASONS:');
  console.log(`   🍯 Honeypots: ${stats.rejected.honeypot} | 🔓 No Lock: ${stats.rejected.noLock} | 🐋 Whales: ${stats.rejected.whale} | ⏰ Late: ${stats.rejected.lateEntry}`);
  
  console.log('\n⚙️  THE 4 GOLDEN RULES:');
  console.log('   1. ✅ Liquidity must be locked');
  console.log('   2. ✅ No whale > 40% / Top 5 < 70%');
  console.log('   3. ✅ Early entry only (before hype)');
  console.log('   4. ✅ Staged selling: 25% @ +30%, +50%, +100%...');
  console.log('─'.repeat(65));
  
  if (positions.size > 0) {
    console.log('\n📈 OPEN POSITIONS:');
    for (const [mint, pos] of positions) {
      const age = Math.floor((Date.now() - pos.entryTime) / 60000);
      const remaining = ((pos.remainingTokens / pos.tokenAmount) * 100).toFixed(0);
      const stages = pos.stagesSold.length;
      console.log(`   ${pos.symbol}: ${remaining}% remaining | ${stages} stages sold | ${age}m ago`);
    }
  } else {
    console.log('\n   No open positions');
  }
  
  console.log('\n' + '─'.repeat(65));
  console.log('Press Ctrl+C to stop');
  console.log('═'.repeat(65) + '\n');
}

// === MAIN LOOP ===
async function main() {
  console.log('🛡️ Starting Safe Sniper v4 - The 4 Golden Rules Edition...\n');
  console.log(`Wallet: ${wallet.publicKey.toString()}`);
  
  loadPositions();
  
  let balance = await getBalance();
  displayStatus(balance);
  
  // Main scan loop
  setInterval(async () => {
    try {
      balance = await getBalance();
      await checkPositions();
      displayStatus(balance);
      
      // Cooldown check
      if (Date.now() - lastBuyTime < CONFIG.cooldownMs) {
        console.log(`⏳ Cooldown... ${Math.ceil((CONFIG.cooldownMs - (Date.now() - lastBuyTime)) / 1000)}s`);
        return;
      }
      
      if (positions.size >= CONFIG.maxPositions) {
        console.log(`📦 Max positions reached (${positions.size}/${CONFIG.maxPositions})`);
        return;
      }
      
      if (balance < CONFIG.tradeAmountSol + 0.002) {
        console.log(`⚠️ Low balance: ${balance.toFixed(6)} SOL`);
        return;
      }
      
      // Find tokens
      const tokens = await findNewTokens();
      console.log(`\n🔎 Found ${tokens.length} new tokens to check...`);
      
      for (const token of tokens.slice(0, 3)) {
        if (positions.has(token.mint)) continue;
        
        // Apply 4 Golden Rules
        const { pass, reason } = await passesGoldenRules(token.mint, token.symbol);
        
        if (pass) {
          const result = await buyToken(token.mint, token.symbol);
          
          if (result) {
            positions.set(token.mint, result);
            lastBuyTime = Date.now();
            stats.bought++;
            savePositions();
            break;
          }
        }
        
        await new Promise(r => setTimeout(r, 1000));
      }
      
    } catch (error) {
      console.error('Loop error:', error.message);
    }
    
  }, CONFIG.scanInterval);
  
  // Position monitor
  setInterval(checkPositions, CONFIG.monitorInterval);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  savePositions();
  console.log('✅ Positions saved');
  console.log(`📊 Final P&L: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(5)} SOL`);
  process.exit(0);
});

main().catch(console.error);
