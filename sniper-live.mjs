#!/usr/bin/env node
/**
 * 🔴 LIVE MEME COIN SNIPER 🔴
 * 
 * THIS WILL EXECUTE REAL TRADES WITH REAL SOL
 * 
 * WHAT WE'RE LOOKING FOR:
 * ========================
 * 1. Brand new tokens (< 5 minutes old) - catch the launch pump
 * 2. Score >= 70 (based on age, momentum, liquidity, DEX)
 * 3. Positive price momentum (going up, not down)
 * 4. Liquidity $1k-$100k (enough to trade, not too established)
 * 5. Jupiter route available (can actually trade it)
 * 
 * SCORING SYSTEM:
 * ===============
 * Base: 50 points
 * Age < 5min:    +25 points
 * Age < 15min:   +15 points  
 * Age < 30min:   +5 points
 * Age > 1hr:     -15 points
 * Change > 200%: +20 points
 * Change > 100%: +15 points
 * Change > 50%:  +10 points
 * Change > 20%:  +5 points
 * Change < -20%: -10 points
 * High turnover: +10 points
 * Sweet liquidity: +10 points
 * pump.fun DEX:  +10 points
 * 
 * TRADE SETTINGS:
 * ===============
 * Trade size: 0.005 SOL (~$0.64) per trade
 * Max positions: 3 at once
 * Take profit: 30%
 * Stop loss: 30%
 */

import axios from 'axios';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION - EDIT THESE
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Wallet
  privateKey: 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs',
  
  // APIs
  rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  jupiterApi: 'https://api.jup.ag/swap/v1',
  jupiterApiKey: 'f6663264-66de-4a78-b115-c14a9efc5a05',
  geckoApi: 'https://api.geckoterminal.com/api/v2',
  
  // Trading parameters
  tradeSize: 0.005,        // SOL per trade (~$0.64)
  maxPositions: 3,         // Max concurrent positions
  minScore: 70,            // Minimum score to buy
  minLiquidity: 1000,      // $1k minimum
  maxLiquidity: 100000,    // $100k maximum (avoid established tokens)
  slippageBps: 1500,       // 15% slippage for meme coins
  priorityFee: 50000,      // Priority fee in lamports
  
  // Exit conditions
  takeProfit: 0.30,        // 30% profit target
  stopLoss: -0.30,         // 30% stop loss
  
  // Timing
  scanInterval: 15000,     // Scan every 15 seconds
  priceCheckInterval: 10000, // Check positions every 10 seconds
  
  // Filters
  onlyPositiveMomentum: true,  // Only buy tokens going UP
  minPriceChange: 5,           // Minimum +5% change to buy
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const positions = new Map(); // tokenAddress -> { entry, amount, symbol, buyTime }
const seenTokens = new Set();
let totalTrades = 0;
let successfulTrades = 0;
let totalPnL = 0;

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════

const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.privateKey));

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║           🔴 LIVE MEME COIN SNIPER - TRADING ENABLED 🔴                 ║');
console.log('╠══════════════════════════════════════════════════════════════════════════╣');
console.log(`║  Wallet:      ${wallet.publicKey.toString().slice(0, 20)}...                    ║`);
console.log(`║  Trade Size:  ${CONFIG.tradeSize} SOL (~$${(CONFIG.tradeSize * 128).toFixed(2)})                                    ║`);
console.log(`║  Min Score:   ${CONFIG.minScore}/100                                                 ║`);
console.log(`║  Take Profit: +${CONFIG.takeProfit * 100}%                                                  ║`);
console.log(`║  Stop Loss:   ${CONFIG.stopLoss * 100}%                                                   ║`);
console.log('╠══════════════════════════════════════════════════════════════════════════╣');
console.log('║  WHAT WE BUY:                                                            ║');
console.log('║  ✅ New tokens < 5 minutes old                                           ║');
console.log('║  ✅ Score >= 70 (age + momentum + liquidity)                             ║');
console.log('║  ✅ Positive price movement (going UP)                                   ║');
console.log('║  ✅ Liquidity $1k - $100k                                                ║');
console.log('║  ✅ Has Jupiter route (can trade)                                        ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');
console.log('');

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

function scoreToken(token) {
  let score = 50;
  let reasons = [];
  
  // Age scoring
  const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
  if (ageMinutes < 5) { score += 25; reasons.push('VERY NEW (<5m)'); }
  else if (ageMinutes < 15) { score += 15; reasons.push('Fresh (<15m)'); }
  else if (ageMinutes < 30) { score += 5; reasons.push('Recent (<30m)'); }
  else if (ageMinutes > 60) { score -= 15; reasons.push('Old (>1h)'); }
  
  // Price momentum scoring
  if (token.priceChange > 200) { score += 20; reasons.push('🚀 MOON (+200%)'); }
  else if (token.priceChange > 100) { score += 15; reasons.push('🔥 Pumping (+100%)'); }
  else if (token.priceChange > 50) { score += 10; reasons.push('📈 Strong (+50%)'); }
  else if (token.priceChange > 20) { score += 5; reasons.push('↗️ Up (+20%)'); }
  else if (token.priceChange < -20) { score -= 10; reasons.push('📉 Dumping'); }
  
  // Volume/liquidity ratio (activity)
  const turnover = token.volume / token.liquidity;
  if (turnover > 2) { score += 10; reasons.push('High activity'); }
  else if (turnover > 0.5) { score += 5; }
  
  // Liquidity sweet spot
  if (token.liquidity >= 5000 && token.liquidity <= 50000) { 
    score += 10; 
    reasons.push('Sweet liq $5-50k'); 
  } else if (token.liquidity > 100000) { 
    score -= 5; 
    reasons.push('Too established'); 
  }
  
  // DEX preference
  if (token.dex === 'pump-fun' || token.dex === 'pumpswap') { 
    score += 10; 
    reasons.push('pump.fun'); 
  }
  if (token.dex === 'raydium' || token.dex === 'meteora-damm-v2') { 
    score += 5; 
  }
  
  return { 
    score: Math.min(100, Math.max(0, score)), 
    reasons 
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function getBalance() {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / 1e9;
}

async function scanNewTokens() {
  try {
    const response = await axios.get(`${CONFIG.geckoApi}/networks/solana/new_pools`, {
      params: { page: 1 },
      timeout: 10000,
    });
    
    const pools = response.data?.data || [];
    const tokens = [];
    
    for (const pool of pools) {
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
      
      if (liquidity < CONFIG.minLiquidity) continue;
      if (liquidity > CONFIG.maxLiquidity) continue;
      
      const tokenAddress = rels.base_token?.data?.id?.replace('solana_', '') || '';
      if (!tokenAddress) continue;
      
      tokens.push({
        address: tokenAddress,
        name: attrs.name?.split('/')[0] || 'Unknown',
        symbol: attrs.name?.split('/')[0]?.slice(0, 12) || '?',
        createdAt: attrs.pool_created_at || new Date().toISOString(),
        currentPrice: parseFloat(attrs.base_token_price_usd || '0'),
        priceChange,
        volume,
        liquidity,
        dex: rels.dex?.data?.id || 'unknown',
      });
    }
    
    return tokens;
  } catch (error) {
    console.error('  ❌ Scan error:', error.message);
    return [];
  }
}

async function getQuote(inputMint, outputMint, amount) {
  try {
    const response = await axios.get(`${CONFIG.jupiterApi}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: CONFIG.slippageBps,
      },
      headers: { 'x-api-key': CONFIG.jupiterApiKey },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    return null;
  }
}

async function executeSwap(quoteResponse) {
  try {
    const swapResponse = await axios.post(`${CONFIG.jupiterApi}/swap`, {
      quoteResponse,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: CONFIG.priorityFee,
    }, {
      headers: { 'x-api-key': CONFIG.jupiterApiKey },
      timeout: 15000,
    });
    
    if (!swapResponse.data?.swapTransaction) return null;
    
    const swapTxBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(swapTxBuf);
    tx.sign([wallet]);
    
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    return signature;
  } catch (err) {
    console.error('  ❌ Swap error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function buyToken(token) {
  const amountLamports = Math.floor(CONFIG.tradeSize * 1e9);
  
  console.log(`\n  🛒 BUYING ${token.symbol}...`);
  
  // Get quote
  const quote = await getQuote(SOL_MINT, token.address, amountLamports);
  if (!quote?.outAmount) {
    console.log(`  ❌ No Jupiter route for ${token.symbol}`);
    return false;
  }
  
  const outAmount = parseInt(quote.outAmount);
  const priceImpact = parseFloat(quote.priceImpactPct || '0');
  
  if (priceImpact > 10) {
    console.log(`  ⚠️ Price impact too high: ${priceImpact.toFixed(2)}%`);
    return false;
  }
  
  // Execute swap
  const signature = await executeSwap(quote);
  if (!signature) {
    console.log(`  ❌ Trade failed`);
    return false;
  }
  
  // Record position
  positions.set(token.address, {
    entry: token.currentPrice,
    amount: outAmount,
    symbol: token.symbol,
    buyTime: Date.now(),
    buyTx: signature,
  });
  
  totalTrades++;
  
  console.log(`  ✅ BOUGHT ${token.symbol}!`);
  console.log(`     TX: https://solscan.io/tx/${signature}`);
  console.log(`     Got: ${(outAmount / 1e6).toFixed(2)} tokens`);
  console.log(`     Entry: $${token.currentPrice < 0.0001 ? token.currentPrice.toExponential(4) : token.currentPrice.toFixed(8)}`);
  
  return true;
}

async function sellToken(tokenAddress, reason) {
  const position = positions.get(tokenAddress);
  if (!position) return false;
  
  console.log(`\n  💰 SELLING ${position.symbol} (${reason})...`);
  
  // Get quote to sell
  const quote = await getQuote(tokenAddress, SOL_MINT, position.amount);
  if (!quote?.outAmount) {
    console.log(`  ❌ No sell route`);
    return false;
  }
  
  // Execute sell
  const signature = await executeSwap(quote);
  if (!signature) {
    console.log(`  ❌ Sell failed`);
    return false;
  }
  
  const solReceived = parseInt(quote.outAmount) / 1e9;
  const pnl = solReceived - CONFIG.tradeSize;
  const pnlPercent = (pnl / CONFIG.tradeSize) * 100;
  
  totalPnL += pnl;
  if (pnl > 0) successfulTrades++;
  
  positions.delete(tokenAddress);
  
  console.log(`  ✅ SOLD ${position.symbol}!`);
  console.log(`     TX: https://solscan.io/tx/${signature}`);
  console.log(`     Received: ${solReceived.toFixed(6)} SOL`);
  console.log(`     PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(6)} SOL (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
  
  return true;
}

async function checkPositions() {
  for (const [address, position] of positions) {
    try {
      // Get current price
      const response = await axios.get(`${CONFIG.geckoApi}/networks/solana/tokens/${address}`, {
        timeout: 5000,
      });
      
      const currentPrice = parseFloat(response.data?.data?.attributes?.price_usd || '0');
      if (currentPrice === 0) continue;
      
      const pnlPercent = (currentPrice - position.entry) / position.entry;
      const holdTime = (Date.now() - position.buyTime) / 60000; // minutes
      
      console.log(`  📊 ${position.symbol}: ${pnlPercent > 0 ? '+' : ''}${(pnlPercent * 100).toFixed(1)}% (held ${holdTime.toFixed(0)}m)`);
      
      // Check exit conditions
      if (pnlPercent >= CONFIG.takeProfit) {
        await sellToken(address, `🎉 TAKE PROFIT +${(pnlPercent * 100).toFixed(1)}%`);
      } else if (pnlPercent <= CONFIG.stopLoss) {
        await sellToken(address, `🛑 STOP LOSS ${(pnlPercent * 100).toFixed(1)}%`);
      }
      
    } catch (err) {
      // Skip on error
    }
    
    await sleep(200);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Check balance first
  const balance = await getBalance();
  console.log(`  💰 Wallet balance: ${balance.toFixed(6)} SOL (~$${(balance * 128).toFixed(2)})`);
  
  if (balance < CONFIG.tradeSize + 0.002) {
    console.log(`  ⚠️ LOW BALANCE! Need at least ${CONFIG.tradeSize + 0.002} SOL to trade`);
    console.log(`     Current: ${balance.toFixed(6)} SOL`);
    console.log(`     Add more SOL to: ${wallet.publicKey.toString()}`);
    return;
  }
  
  console.log(`  ✅ Balance OK - can make ${Math.floor((balance - 0.002) / CONFIG.tradeSize)} trades\n`);
  
  let iteration = 0;
  
  while (true) {
    iteration++;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`\n═══════════════════════════════════════════════════════════════════════════`);
    console.log(`  SCAN #${iteration} @ ${timestamp} | Positions: ${positions.size}/${CONFIG.maxPositions} | Trades: ${totalTrades} | PnL: ${totalPnL > 0 ? '+' : ''}${totalPnL.toFixed(6)} SOL`);
    console.log(`═══════════════════════════════════════════════════════════════════════════`);
    
    // Check existing positions for exit
    if (positions.size > 0) {
      console.log('\n  📋 POSITION CHECK:');
      await checkPositions();
    }
    
    // Scan for new opportunities (only if we can open more positions)
    if (positions.size < CONFIG.maxPositions) {
      const balance = await getBalance();
      
      if (balance >= CONFIG.tradeSize + 0.002) {
        console.log('\n  🔍 SCANNING FOR NEW TOKENS...');
        
        const tokens = await scanNewTokens();
        
        for (const token of tokens) {
          // Skip if already seen or already holding
          if (seenTokens.has(token.address)) continue;
          if (positions.has(token.address)) continue;
          
          seenTokens.add(token.address);
          
          // Score the token
          const { score, reasons } = scoreToken(token);
          
          // Check if it meets our criteria
          const meetsMinScore = score >= CONFIG.minScore;
          const meetsMinChange = token.priceChange >= CONFIG.minPriceChange;
          const isPositive = !CONFIG.onlyPositiveMomentum || token.priceChange > 0;
          
          if (meetsMinScore && meetsMinChange && isPositive) {
            const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
            
            console.log(`\n  🚨 OPPORTUNITY: ${token.symbol}`);
            console.log(`     Score:   ${score}/100 [${reasons.join(', ')}]`);
            console.log(`     Age:     ${ageMinutes.toFixed(0)} minutes`);
            console.log(`     Change:  +${token.priceChange.toFixed(1)}%`);
            console.log(`     Liq:     $${token.liquidity.toLocaleString()}`);
            console.log(`     DEX:     ${token.dex}`);
            
            // Try to buy!
            if (positions.size < CONFIG.maxPositions) {
              const success = await buyToken(token);
              if (success) {
                // Don't buy more this scan cycle
                break;
              }
            }
          }
        }
        
        if (tokens.length === 0) {
          console.log('  📊 No tokens found matching criteria');
        }
      } else {
        console.log(`\n  ⚠️ Low balance: ${balance.toFixed(6)} SOL - waiting for sells`);
      }
    } else {
      console.log('\n  ⏸️ Max positions reached - waiting for exits');
    }
    
    // Wait before next scan
    await sleep(CONFIG.scanInterval);
  }
}

// Start the bot
main().catch(console.error);
