#!/usr/bin/env node
/**
 * AUTOMATIC SNIPER BOT v2
 * - Auto-buys new tokens
 * - Auto-sells at take profit OR stop loss
 * - Persists positions to file
 * - Checks positions EVERY scan cycle
 * - NO MANUAL INTERVENTION NEEDED
 */

import fetch from 'node-fetch';
import fs from 'fs';
import { Keypair, Connection, VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// ═══════════════════════════════════════════════════════════════════
//                         CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  privateKey: 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs',
  rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  
  // Trading params
  tradeAmountSol: 0.001,        // Trade size
  maxPositions: 2,              // Max concurrent positions
  
  // CRITICAL: Take profit / Stop loss
  takeProfitPercent: 30,        // Sell at +30% (lowered for faster exits)
  stopLossPercent: -25,         // Sell at -25%
  
  // Timing - FAST
  scanIntervalMs: 3000,         // Check every 3 seconds
  positionCheckMs: 2000,        // Check positions every 2 seconds
  
  // Token filtering
  minLiquidityUsd: 1000,
  maxAgeMins: 10,
  minScoreThreshold: 80,
  cooldownMs: 30000,            // 30 sec between buys
  
  // File to persist positions
  positionsFile: '/home/technocalypse/sol_bot/positions.json',
};

// ═══════════════════════════════════════════════════════════════════
//                         STATE
// ═══════════════════════════════════════════════════════════════════
let positions = new Map();
const failedTokens = new Set();
let lastBuyTime = 0;
let totalPnL = 0;
let wins = 0;
let losses = 0;
let isSellingPosition = false; // Lock to prevent double-sells

// Initialize wallet
const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.privateKey));
const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ═══════════════════════════════════════════════════════════════════
//                    POSITION PERSISTENCE
// ═══════════════════════════════════════════════════════════════════
function savePositions() {
  const data = {
    positions: Array.from(positions.entries()),
    totalPnL,
    wins,
    losses,
    lastBuyTime
  };
  fs.writeFileSync(CONFIG.positionsFile, JSON.stringify(data, null, 2));
}

function loadPositions() {
  try {
    if (fs.existsSync(CONFIG.positionsFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.positionsFile, 'utf8'));
      positions = new Map(data.positions || []);
      totalPnL = data.totalPnL || 0;
      wins = data.wins || 0;
      losses = data.losses || 0;
      lastBuyTime = data.lastBuyTime || 0;
      console.log(`📂 Loaded ${positions.size} positions from file`);
    }
  } catch (e) {
    console.log(`📂 No existing positions file`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    JUPITER SWAP EXECUTION
// ═══════════════════════════════════════════════════════════════════
async function executeSwap(inputMint, outputMint, amount, action = 'SWAP') {
  try {
    // Get quote
    const quoteUrl = `https://public.jupiterapi.com/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=5000`;
    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) return null;
    
    const quote = await quoteRes.json();
    if (quote.error) return null;
    
    // Get swap transaction
    const swapRes = await fetch('https://public.jupiterapi.com/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        useSharedAccounts: false,
        dynamicComputeUnitLimit: true,
        autoSlippage: true,
        maxAutoSlippageBps: 10000,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 100000,
            priorityLevel: "veryHigh"
          }
        }
      })
    });
    
    if (!swapRes.ok) return null;
    const swapData = await swapRes.json();
    if (!swapData.swapTransaction) return null;
    
    // Sign and send
    const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });
    
    // Wait for confirmation (with timeout)
    const confirmPromise = connection.confirmTransaction(sig, 'confirmed');
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 30000)
    );
    
    const result = await Promise.race([confirmPromise, timeoutPromise]);
    
    if (result.value?.err) {
      return null;
    }
    
    return {
      signature: sig,
      outAmount: parseInt(quote.outAmount || '0'),
      inAmount: amount
    };
    
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    POSITION MANAGEMENT (CRITICAL)
// ═══════════════════════════════════════════════════════════════════
async function checkAndSellPositions() {
  if (positions.size === 0 || isSellingPosition) return;
  
  for (const [mint, pos] of positions) {
    try {
      // Get current value quote
      const quoteUrl = `https://public.jupiterapi.com/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.tokenAmount}&slippageBps=5000`;
      const quoteRes = await fetch(quoteUrl);
      if (!quoteRes.ok) continue;
      
      const quote = await quoteRes.json();
      if (quote.error || !quote.outAmount) continue;
      
      const currentValueSol = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
      const pnlPercent = ((currentValueSol - pos.entryAmountSol) / pos.entryAmountSol) * 100;
      
      const emoji = pnlPercent >= 0 ? '📈' : '📉';
      const pnlStr = pnlPercent >= 0 ? `+${pnlPercent.toFixed(1)}%` : `${pnlPercent.toFixed(1)}%`;
      console.log(`   ${emoji} ${pos.symbol}: ${pnlStr} (${currentValueSol.toFixed(6)} SOL)`);
      
      // ═══════════════════════════════════════════════════════════════
      //              AUTO-SELL LOGIC - EXECUTES IMMEDIATELY
      // ═══════════════════════════════════════════════════════════════
      
      // TAKE PROFIT
      if (pnlPercent >= CONFIG.takeProfitPercent) {
        isSellingPosition = true;
        console.log(`\n🎯 TAKE PROFIT! ${pos.symbol} at +${pnlPercent.toFixed(1)}%`);
        console.log(`   Selling ${pos.tokenAmount} tokens...`);
        
        const result = await executeSwap(mint, SOL_MINT, pos.tokenAmount, 'SELL');
        
        if (result) {
          const soldFor = result.outAmount / LAMPORTS_PER_SOL;
          const profit = soldFor - pos.entryAmountSol;
          totalPnL += profit;
          wins++;
          positions.delete(mint);
          savePositions();
          console.log(`   ✅ SOLD! +${profit.toFixed(6)} SOL`);
          console.log(`   TX: https://solscan.io/tx/${result.signature}`);
        } else {
          console.log(`   ❌ Sell failed, will retry`);
        }
        isSellingPosition = false;
      }
      // STOP LOSS
      else if (pnlPercent <= CONFIG.stopLossPercent) {
        isSellingPosition = true;
        console.log(`\n🛑 STOP LOSS! ${pos.symbol} at ${pnlPercent.toFixed(1)}%`);
        console.log(`   Selling ${pos.tokenAmount} tokens...`);
        
        const result = await executeSwap(mint, SOL_MINT, pos.tokenAmount, 'SELL');
        
        if (result) {
          const soldFor = result.outAmount / LAMPORTS_PER_SOL;
          const loss = soldFor - pos.entryAmountSol;
          totalPnL += loss;
          losses++;
          positions.delete(mint);
          savePositions();
          console.log(`   ❌ SOLD! ${loss.toFixed(6)} SOL`);
          console.log(`   TX: https://solscan.io/tx/${result.signature}`);
        } else {
          console.log(`   ❌ Sell failed, will retry`);
        }
        isSellingPosition = false;
      }
      
    } catch (e) {
      // Continue checking other positions
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    TOKEN DISCOVERY
// ═══════════════════════════════════════════════════════════════════
async function fetchNewTokens() {
  try {
    const res = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    return [];
  }
}

function scoreToken(pool) {
  let score = 50;
  const attrs = pool.attributes;
  
  const ageMinutes = (Date.now() - new Date(attrs.pool_created_at).getTime()) / 60000;
  if (ageMinutes < 2) score += 30;
  else if (ageMinutes < 5) score += 20;
  else if (ageMinutes < 10) score += 10;
  else if (ageMinutes > CONFIG.maxAgeMins) return 0;
  
  const liquidity = parseFloat(attrs.reserve_in_usd || '0');
  if (liquidity < CONFIG.minLiquidityUsd) return 0;
  if (liquidity > 5000) score += 15;
  if (liquidity > 10000) score += 10;
  
  const volume = parseFloat(attrs.volume_usd?.h1 || '0');
  if (volume > 1000) score += 10;
  if (volume > 5000) score += 10;
  
  const buys = parseInt(attrs.transactions?.h1?.buys || '0');
  const sells = parseInt(attrs.transactions?.h1?.sells || '0');
  if (buys > 0 && sells > 0) {
    const ratio = buys / sells;
    if (ratio > 2) score += 15;
    else if (ratio > 1.5) score += 10;
    else if (ratio < 0.5) score -= 20;
  }
  
  return Math.min(score, 150);
}

async function getTokenAddress(pool) {
  try {
    const poolAddress = pool.attributes.address;
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}?include=base_token,quote_token`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    
    const data = await res.json();
    for (const item of (data.included || [])) {
      if (item.type === 'token' && item.attributes) {
        const symbol = item.attributes.symbol?.toUpperCase();
        if (symbol !== 'SOL' && symbol !== 'WSOL' && item.attributes.address) {
          return item.attributes.address;
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    BUY EXECUTION
// ═══════════════════════════════════════════════════════════════════
async function buyToken(tokenMint, symbol, score) {
  const amountLamports = Math.floor(CONFIG.tradeAmountSol * LAMPORTS_PER_SOL);
  
  console.log(`\n🎯 BUYING ${symbol} (Score: ${score})`);
  
  const result = await executeSwap(SOL_MINT, tokenMint, amountLamports, 'BUY');
  
  if (result) {
    console.log(`   ✅ Bought! Got ${result.outAmount} tokens`);
    console.log(`   TX: https://solscan.io/tx/${result.signature}`);
    
    positions.set(tokenMint, {
      symbol,
      entryTime: Date.now(),
      entryAmountSol: CONFIG.tradeAmountSol,
      tokenAmount: result.outAmount,
      signature: result.signature
    });
    
    lastBuyTime = Date.now();
    savePositions();
    return true;
  }
  
  failedTokens.add(tokenMint);
  console.log(`   ❌ Buy failed`);
  return false;
}

// ═══════════════════════════════════════════════════════════════════
//                    MAIN LOOP
// ═══════════════════════════════════════════════════════════════════
async function scan() {
  const balance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`💰 ${balance.toFixed(6)} SOL | 📊 P&L: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(6)} | W/L: ${wins}/${losses} | Pos: ${positions.size}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  // ═══════════════════════════════════════════════════════════════
  //     CHECK POSITIONS FIRST - MOST IMPORTANT
  // ═══════════════════════════════════════════════════════════════
  if (positions.size > 0) {
    console.log(`📊 Checking ${positions.size} position(s)...`);
    await checkAndSellPositions();
  }
  
  // Check if we can buy
  if (balance < CONFIG.tradeAmountSol + 0.003) {
    console.log(`⚠️ Low balance for new buys`);
    return;
  }
  
  // Cooldown check
  if (Date.now() - lastBuyTime < CONFIG.cooldownMs) {
    const remaining = Math.ceil((CONFIG.cooldownMs - (Date.now() - lastBuyTime)) / 1000);
    console.log(`⏳ Buy cooldown: ${remaining}s`);
    return;
  }
  
  // Position limit
  if (positions.size >= CONFIG.maxPositions) {
    console.log(`📊 Max positions reached`);
    return;
  }
  
  // Find new tokens
  console.log(`🔍 Scanning for opportunities...`);
  const pools = await fetchNewTokens();
  
  const candidates = [];
  for (const pool of pools.slice(0, 15)) {
    const score = scoreToken(pool);
    if (score >= CONFIG.minScoreThreshold) {
      candidates.push({ pool, score });
    }
  }
  
  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length === 0) {
    console.log(`   No candidates above ${CONFIG.minScoreThreshold} score`);
    return;
  }
  
  // Try best candidate
  const best = candidates[0];
  const name = best.pool.attributes.name || 'Unknown';
  const symbol = name.split('/')[0].trim();
  const tokenMint = await getTokenAddress(best.pool);
  
  if (!tokenMint || failedTokens.has(tokenMint) || positions.has(tokenMint)) {
    return;
  }
  
  console.log(`🎯 Best: ${name} (Score: ${best.score})`);
  await buyToken(tokenMint, symbol, best.score);
}

// ═══════════════════════════════════════════════════════════════════
//                    STARTUP
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                    🚀 AUTO SNIPER BOT v2 🚀                              ║
║                   Fully Automatic Execution                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  💰 Trade:      ${CONFIG.tradeAmountSol} SOL                                                ║
║  📈 TP:         +${CONFIG.takeProfitPercent}%                                                ║
║  📉 SL:         ${CONFIG.stopLossPercent}%                                                ║
║  ⏱️  Scan:       ${CONFIG.scanIntervalMs/1000}s                                                  ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
  
  console.log(`🔑 Wallet: ${wallet.publicKey.toBase58()}`);
  
  // Load existing positions
  loadPositions();
  
  const balance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL`);
  
  if (positions.size > 0) {
    console.log(`\n📊 Open Positions:`);
    for (const [mint, pos] of positions) {
      console.log(`   • ${pos.symbol}: ${pos.tokenAmount} tokens (entry: ${pos.entryAmountSol} SOL)`);
    }
  }
  
  console.log(`\n🚀 Starting auto-sniper... (Ctrl+C to stop)\n`);
  
  // Main loop
  while (true) {
    try {
      await scan();
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, CONFIG.scanIntervalMs));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(`\n\n🛑 Shutting down...`);
  savePositions();
  
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Session Stats:`);
  console.log(`   P&L: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(6)} SOL`);
  console.log(`   Wins: ${wins} | Losses: ${losses}`);
  
  if (positions.size > 0) {
    console.log(`\n⚠️  Open Positions (saved to file):`);
    for (const [mint, pos] of positions) {
      console.log(`   • ${pos.symbol}: ${pos.tokenAmount} tokens`);
    }
  }
  
  const balance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  console.log(`\n💰 Final Balance: ${balance.toFixed(6)} SOL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(0);
});

main().catch(console.error);
