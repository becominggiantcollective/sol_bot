#!/usr/bin/env node
/**
 * 🛡️ SAFE SNIPER BOT v5 - THE 6 GOLDEN RULES EDITION
 * 
 * THE 6 GOLDEN RULES:
 * 1. ✅ Liquidity must be locked
 * 2. ✅ Contract clean (renounced, no hidden functions)
 * 3. ✅ No whales >40% / healthy distribution
 * 4. ✅ Community strength (Twitter/Telegram active)
 * 5. ✅ Whale tracking (follow smart money)
 * 6. ✅ Exit strategy (staged selling, never aim for top)
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { quickSafetyCheck, EXIT_STRATEGY, printSafetyReport, fullSafetyCheck } from './safety-checker-v2.mjs';

// === CONFIG ===
const CONFIG = {
  // Trading
  tradeAmountSol: 0.001,      // SOL per trade
  maxPositions: 2,            // Max concurrent
  
  // Safety Requirements
  minSafetyScore: 350,        // Min score out of 600 (58%)
  minRulesPassedbuys: 4,       // At least 4/6 rules must pass
  maxRiskLevel: 'MEDIUM',     // Accept LOW and MEDIUM risk
  
  // The 6 Golden Rules Thresholds
  rules: {
    minLiquidity: 1000,       // R1: Min $1000 liquidity
    requireRenounced: true,   // R2: Must have renounced authorities
    maxWhalePercent: 40,      // R3: No whale > 40%
    requireCommunity: false,  // R4: Community check (optional for new tokens)
    preferBullishWhales: true,// R5: Prefer bullish whale signal
  },
  
  // Rule 6: Exit Strategy (staged selling)
  sellStages: EXIT_STRATEGY.stages,
  stopLossPct: 25,
  
  // Timing
  scanInterval: 6000,         // 6 sec scan
  monitorInterval: 4000,      // 4 sec position check
  cooldownMs: 45000,          // 45s between buys
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
  rejected: { 
    lowScore: 0, 
    noLiquidity: 0, 
    badContract: 0, 
    whales: 0, 
    noCommunity: 0,
    bearishWhales: 0
  },
  bought: 0, 
  stagesSold: 0,
  totalProfit: 0 
};

// === POSITION MANAGEMENT ===
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync('positions-v5.json', 'utf-8'));
    positions = new Map(data.positions || []);
    stats = data.stats || stats;
    console.log(`📂 Loaded ${positions.size} positions`);
  } catch { 
    console.log('📂 Starting fresh');
  }
}

function savePositions() {
  fs.writeFileSync('positions-v5.json', JSON.stringify({
    positions: Array.from(positions.entries()),
    stats,
    lastSaved: Date.now()
  }, null, 2));
}

// === THE 6 GOLDEN RULES CHECK ===
async function passes6Rules(mint, symbol) {
  console.log(`\n🛡️ Checking ${symbol} against 6 Golden Rules...`);
  stats.scanned++;
  
  try {
    const check = await quickSafetyCheck(mint);
    
    console.log(`   Score: ${check.score}/${check.maxScore} (${(check.score/check.maxScore*100).toFixed(0)}%)`);
    console.log(`   Rules Passed: ${check.passedRules}/6`);
    console.log(`   Risk Level: ${check.riskLevel}`);
    
    // Check minimum score
    if (check.score < CONFIG.minSafetyScore) {
      console.log(`   ❌ Score too low (${check.score} < ${CONFIG.minSafetyScore})`);
      stats.rejected.lowScore++;
      return { pass: false, reason: `Score ${check.score} < ${CONFIG.minSafetyScore}` };
    }
    
    // Check risk level
    const acceptableRisk = ['LOW', 'MEDIUM'];
    if (CONFIG.maxRiskLevel === 'LOW') acceptableRisk.pop();
    
    if (!acceptableRisk.includes(check.riskLevel)) {
      console.log(`   ❌ Risk too high: ${check.riskLevel}`);
      stats.rejected.lowScore++;
      return { pass: false, reason: `Risk level ${check.riskLevel} not acceptable` };
    }
    
    // Check individual rules
    if (!check.liquidityLocked) {
      console.log(`   ❌ R1 FAIL: Liquidity not locked`);
      stats.rejected.noLiquidity++;
      return { pass: false, reason: 'Liquidity not locked' };
    }
    
    if (CONFIG.rules.requireRenounced && !check.contractClean) {
      console.log(`   ❌ R2 FAIL: Contract not clean`);
      stats.rejected.badContract++;
      return { pass: false, reason: 'Contract has active authorities' };
    }
    
    if (!check.noWhales) {
      console.log(`   ❌ R3 FAIL: Whale concentration too high`);
      stats.rejected.whales++;
      return { pass: false, reason: 'Whale owns >40%' };
    }
    
    if (CONFIG.rules.requireCommunity && !check.hasCommunity) {
      console.log(`   ❌ R4 FAIL: No active community`);
      stats.rejected.noCommunity++;
      return { pass: false, reason: 'No Twitter/Telegram' };
    }
    
    if (CONFIG.rules.preferBullishWhales && check.whaleSignal === 'bearish') {
      console.log(`   ⚠️ R5 WARN: Whales are selling`);
      stats.rejected.bearishWhales++;
      return { pass: false, reason: 'Bearish whale activity' };
    }
    
    console.log(`   ✅ PASSED ALL CHECKS!`);
    console.log(`   ${check.recommendation}`);
    
    return { pass: true, check, reason: 'Passed 6 golden rules' };
    
  } catch (error) {
    console.log(`   ❌ Check failed: ${error.message}`);
    return { pass: false, reason: error.message };
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
      const name = attrs.name?.split(' / ')?.[0] || 'UNKNOWN';
      const mint = pool.relationships?.base_token?.data?.id?.replace('solana_', '');
      const liquidity = parseFloat(attrs.reserve_in_usd || 0);
      const volume = parseFloat(attrs.volume_usd?.h24 || 0);
      
      if (mint && mint !== SOL_MINT && !positions.has(mint)) {
        // Pre-filter: skip obvious duds
        if (liquidity < CONFIG.rules.minLiquidity) continue;
        
        tokens.push({ mint, symbol: name, liquidity, volume });
      }
    }
    return tokens;
  } catch (error) {
    return [];
  }
}

// === BUY FUNCTION ===
async function buyToken(mint, symbol, safetyCheck) {
  const amountLamports = Math.floor(CONFIG.tradeAmountSol * 1e9);
  
  console.log(`\n🛒 Buying ${symbol}...`);
  
  try {
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amountLamports}&slippageBps=1000`;
    const quoteRes = await fetch(quoteUrl);
    const quote = await quoteRes.json();
    
    if (quote.error) {
      console.log(`   ❌ Quote error: ${quote.error}`);
      return null;
    }
    
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
      console.log(`   ❌ TX failed`);
      return null;
    }
    
    const tokenAmount = parseInt(quote.outAmount);
    console.log(`   ✅ Bought ${tokenAmount.toLocaleString()} ${symbol}`);
    
    return {
      symbol,
      tokenAmount,
      remainingTokens: tokenAmount,
      entryAmountSol: CONFIG.tradeAmountSol,
      entryTime: Date.now(),
      signature: sig,
      stagesSold: [],
      safetyScore: safetyCheck?.score || 0,
      riskLevel: safetyCheck?.riskLevel || 'UNKNOWN'
    };
    
  } catch (error) {
    console.log(`   ❌ Buy failed: ${error.message}`);
    return null;
  }
}

// === STAGED SELL (RULE 6) ===
async function checkStagedSell(mint, pos, currentValue) {
  const profitPct = ((currentValue / pos.entryAmountSol) - 1) * 100;
  
  // Get exit action
  const action = EXIT_STRATEGY.getAction(profitPct, pos.stagesSold);
  
  if (action.action === 'STOP_LOSS') {
    console.log(`\n🛑 STOP LOSS: ${pos.symbol} at ${profitPct.toFixed(1)}%`);
    return await executeSell(mint, pos.remainingTokens, pos, 'STOP_LOSS');
  }
  
  if (action.action === 'SELL_STAGE') {
    console.log(`\n💰 STAGED SELL: ${pos.symbol} ${action.reason}`);
    const tokensToSell = Math.floor(pos.remainingTokens * (action.sellPct / 100));
    
    if (tokensToSell > 0) {
      const success = await executeSell(mint, tokensToSell, pos, 'STAGED');
      if (success) {
        pos.stagesSold.push(action.triggerProfit);
        pos.remainingTokens -= tokensToSell;
        stats.stagesSold++;
        
        const stageProfit = (tokensToSell / pos.tokenAmount) * pos.entryAmountSol * (profitPct / 100);
        stats.totalProfit += stageProfit;
        
        console.log(`   ✅ Sold ${action.sellPct}% (+${stageProfit.toFixed(5)} SOL)`);
        console.log(`   📊 Remaining: ${((pos.remainingTokens/pos.tokenAmount)*100).toFixed(0)}%`);
        
        savePositions();
        
        if (pos.remainingTokens <= 0) {
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
async function executeSell(mint, amount, pos, reason) {
  try {
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl);
    const quote = await quoteRes.json();
    
    if (quote.error) return false;
    
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
    if (error) return false;
    
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });
    
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    
    if (reason === 'STOP_LOSS' && !conf.value.err) {
      const loss = pos.entryAmountSol * (CONFIG.stopLossPct / 100);
      stats.totalProfit -= loss;
      positions.delete(mint);
      console.log(`   ❌ Stop loss executed (-${loss.toFixed(5)} SOL)`);
    }
    
    return !conf.value.err;
    
  } catch (error) {
    return false;
  }
}

// === POSITION MONITORING ===
async function checkPositions() {
  if (positions.size === 0) return;
  
  for (const [mint, pos] of positions) {
    try {
      const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.remainingTokens}&slippageBps=3000`;
      const res = await fetch(quoteUrl);
      const quote = await res.json();
      
      if (quote.error || !quote.outAmount) {
        pos.failedQuotes = (pos.failedQuotes || 0) + 1;
        if (pos.failedQuotes >= 5) {
          console.log(`   🍯 ${pos.symbol}: Likely honeypot - removing`);
          positions.delete(mint);
          savePositions();
        }
        continue;
      }
      
      const currentValue = parseInt(quote.outAmount) / 1e9;
      await checkStagedSell(mint, pos, currentValue);
      
    } catch (error) {}
  }
}

// === BALANCE ===
async function getBalance() {
  return (await connection.getBalance(wallet.publicKey)) / 1e9;
}

// === DISPLAY ===
function displayStatus(balance) {
  console.clear();
  console.log('═'.repeat(68));
  console.log('🛡️  SAFE SNIPER v5 - THE 6 GOLDEN RULES EDITION');
  console.log('═'.repeat(68));
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 230).toFixed(2)})`);
  console.log(`📊 P&L: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(5)} SOL | Stages Sold: ${stats.stagesSold}`);
  
  console.log('\n📋 SCAN STATS:');
  console.log(`   Scanned: ${stats.scanned} | Bought: ${stats.bought}`);
  console.log(`   Rejected: Score=${stats.rejected.lowScore} | Liq=${stats.rejected.noLiquidity} | Contract=${stats.rejected.badContract} | Whales=${stats.rejected.whales}`);
  
  console.log('\n🛡️ THE 6 GOLDEN RULES:');
  console.log('   1. 🔒 Liquidity locked      4. 🌐 Community active');
  console.log('   2. 📜 Contract renounced    5. 🐋 Whale signal OK');
  console.log('   3. 👥 No whale >40%         6. 💰 Staged selling');
  
  console.log('─'.repeat(68));
  
  if (positions.size > 0) {
    console.log('\n📈 POSITIONS:');
    for (const [mint, pos] of positions) {
      const age = Math.floor((Date.now() - pos.entryTime) / 60000);
      const remaining = ((pos.remainingTokens / pos.tokenAmount) * 100).toFixed(0);
      console.log(`   ${pos.symbol}: ${remaining}% left | ${pos.stagesSold.length} stages sold | Score: ${pos.safetyScore} | ${age}m`);
    }
  } else {
    console.log('\n   No positions');
  }
  
  console.log('\n' + '─'.repeat(68));
  console.log('Press Ctrl+C to stop');
  console.log('═'.repeat(68) + '\n');
}

// === MAIN ===
async function main() {
  console.log('🛡️ Starting Safe Sniper v5 - The 6 Golden Rules...\n');
  console.log(`Wallet: ${wallet.publicKey.toString()}`);
  
  loadPositions();
  let balance = await getBalance();
  displayStatus(balance);
  
  setInterval(async () => {
    try {
      balance = await getBalance();
      await checkPositions();
      displayStatus(balance);
      
      if (Date.now() - lastBuyTime < CONFIG.cooldownMs) {
        console.log(`⏳ Cooldown... ${Math.ceil((CONFIG.cooldownMs - (Date.now() - lastBuyTime)) / 1000)}s`);
        return;
      }
      
      if (positions.size >= CONFIG.maxPositions) {
        console.log(`📦 Max positions (${positions.size}/${CONFIG.maxPositions})`);
        return;
      }
      
      if (balance < CONFIG.tradeAmountSol + 0.002) {
        console.log(`⚠️ Low balance: ${balance.toFixed(6)} SOL`);
        return;
      }
      
      const tokens = await findNewTokens();
      console.log(`\n🔎 Found ${tokens.length} candidates...`);
      
      for (const token of tokens.slice(0, 3)) {
        if (positions.has(token.mint)) continue;
        
        const { pass, check, reason } = await passes6Rules(token.mint, token.symbol);
        
        if (pass) {
          const result = await buyToken(token.mint, token.symbol, check);
          
          if (result) {
            positions.set(token.mint, result);
            lastBuyTime = Date.now();
            stats.bought++;
            savePositions();
            break;
          }
        }
        
        await new Promise(r => setTimeout(r, 1500));
      }
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
  }, CONFIG.scanInterval);
  
  setInterval(checkPositions, CONFIG.monitorInterval);
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  savePositions();
  console.log(`📊 Final P&L: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(5)} SOL`);
  process.exit(0);
});

main().catch(console.error);
