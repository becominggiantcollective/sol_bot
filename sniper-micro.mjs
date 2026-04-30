#!/usr/bin/env node
/**
 * MICRO SNIPER BOT - Build from small balance
 * Trade size: 0.002 SOL (~$0.26) to preserve capital
 * Goal: Build up balance through small wins
 */

import fetch from 'node-fetch';
import { Keypair, Connection, VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// Configuration - MICRO TRADING
const CONFIG = {
  // Wallet
  privateKey: process.env.WALLET_PRIVATE_KEY,
  
  // RPC
  rpcUrl: process.env.HELIUS_RPC_URL,
  
  // Micro trading params - ULTRA SMALL to preserve capital
  tradeAmountSol: 0.001,        // ~$0.13 per trade (ultra small)
  maxPositions: 2,              // Max 2 positions at a time
  slippageBps: 5000,            // 50% slippage for volatile new tokens
  
  // Profit targets
  takeProfitPercent: 50,        // Take profit at +50%
  stopLossPercent: -40,         // Cut loss at -40%
  
  // Scan settings
  scanIntervalMs: 8000,         // Scan every 8 seconds
  minLiquidityUsd: 500,         // Very low liquidity OK for micro
  maxAgeMins: 10,               // Tokens under 10 mins old
  
  // Safety
  minScoreThreshold: 80,        // Minimum score to buy
  cooldownMs: 60000,            // 1 min cooldown between buys
};

// State
const positions = new Map();
const failedTokens = new Set();
let lastBuyTime = 0;
let totalPnL = 0;
let wins = 0;
let losses = 0;

// Initialize
const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.privateKey));
const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                    🔬 MICRO SNIPER BOT 🔬                                ║
║                  Building up from small balance                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║  💰 Trade Size:    ${CONFIG.tradeAmountSol} SOL (~$${(CONFIG.tradeAmountSol * 128).toFixed(2)})                               ║
║  📈 Take Profit:   +${CONFIG.takeProfitPercent}%                                             ║
║  📉 Stop Loss:     ${CONFIG.stopLossPercent}%                                              ║
║  🎯 Min Score:     ${CONFIG.minScoreThreshold}                                                ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
console.log(`🔑 Wallet: ${wallet.publicKey.toBase58()}`);

// Get wallet balance
async function getBalance() {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

// Fetch new tokens from GeckoTerminal
async function fetchNewTokens() {
  try {
    const response = await fetch(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    return [];
  }
}

// Score a token opportunity
function scoreToken(pool) {
  let score = 50; // Base score
  const attrs = pool.attributes;
  
  // Age bonus (newer = better for sniping)
  const createdAt = new Date(attrs.pool_created_at);
  const ageMinutes = (Date.now() - createdAt.getTime()) / 60000;
  
  if (ageMinutes < 2) score += 30;      // Very new
  else if (ageMinutes < 5) score += 20;
  else if (ageMinutes < 10) score += 10;
  else if (ageMinutes > CONFIG.maxAgeMins) return 0; // Too old
  
  // Liquidity check
  const liquidity = parseFloat(attrs.reserve_in_usd || '0');
  if (liquidity < CONFIG.minLiquidityUsd) return 0;
  if (liquidity > 5000) score += 15;
  if (liquidity > 10000) score += 10;
  
  // Volume bonus
  const volume = parseFloat(attrs.volume_usd?.h1 || '0');
  if (volume > 1000) score += 10;
  if (volume > 5000) score += 10;
  
  // Transaction count bonus
  const txns = parseInt(attrs.transactions?.h1?.buys || '0') + parseInt(attrs.transactions?.h1?.sells || '0');
  if (txns > 20) score += 10;
  if (txns > 50) score += 10;
  
  // Buy/sell ratio (more buys = bullish)
  const buys = parseInt(attrs.transactions?.h1?.buys || '0');
  const sells = parseInt(attrs.transactions?.h1?.sells || '0');
  if (buys > 0 && sells > 0) {
    const ratio = buys / sells;
    if (ratio > 2) score += 15;
    else if (ratio > 1.5) score += 10;
    else if (ratio < 0.5) score -= 20; // More sells than buys = bad
  }
  
  return Math.min(score, 150);
}

// Extract token mint from pool
function getTokenMint(pool) {
  const name = pool.attributes.name || '';
  const relationships = pool.relationships;
  
  // Try to get from relationships
  if (relationships?.base_token?.data?.id) {
    const tokenId = relationships.base_token.data.id;
    if (tokenId.startsWith('solana_')) {
      return tokenId.replace('solana_', '');
    }
  }
  
  // Check if it's a SOL pair
  if (name.includes('/SOL') || name.includes('/ SOL')) {
    return null; // Need to fetch separately
  }
  
  return null;
}

// Get token address from pool
async function getTokenAddress(pool) {
  try {
    const poolAddress = pool.attributes.address;
    
    // Method 1: Try to get from pool details with include
    const response = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}?include=base_token,quote_token`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      console.log(`   API response: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const included = data.included || [];
    
    // Find the non-SOL token from included
    for (const item of included) {
      if (item.type === 'token' && item.attributes) {
        const symbol = item.attributes.symbol?.toUpperCase();
        const address = item.attributes.address;
        if (symbol !== 'SOL' && symbol !== 'WSOL' && address) {
          return address;
        }
      }
    }
    
    // Method 2: Try relationships from main data
    const poolData = data.data;
    if (poolData?.relationships?.base_token?.data?.id) {
      const tokenId = poolData.relationships.base_token.data.id;
      // Format: solana_<address>
      if (tokenId.includes('_')) {
        const parts = tokenId.split('_');
        if (parts.length >= 2 && parts[1].length > 30) {
          return parts[1];
        }
      }
    }
    
    // Method 3: Try to extract from pool address relationships
    if (poolData?.attributes?.address) {
      // Fetch token info directly 
      const tokensResponse = await fetch(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/info`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (tokensResponse.ok) {
        const tokensData = await tokensResponse.json();
        const tokens = tokensData.data?.attributes?.tokens || [];
        for (const token of tokens) {
          if (token.symbol?.toUpperCase() !== 'SOL' && token.symbol?.toUpperCase() !== 'WSOL') {
            return token.address;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`   Token fetch error: ${error.message}`);
    return null;
  }
}

// Execute swap via Jupiter
async function executeSwap(inputMint, outputMint, amountLamports, isBuy = true) {
  const action = isBuy ? 'BUY' : 'SELL';
  
  try {
    // Get quote - use public API
    const quoteUrl = `https://public.jupiterapi.com/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${CONFIG.slippageBps}`;
    const quoteResponse = await fetch(quoteUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      console.log(`   ❌ Quote failed: ${quoteResponse.status} - ${errorText.slice(0, 100)}`);
      return null;
    }
    
    const quote = await quoteResponse.json();
    
    if (quote.error) {
      console.log(`   ❌ Quote error: ${quote.error}`);
      return null;
    }
    
    console.log(`   📊 Quote: ${(parseInt(quote.outAmount) / 1e9).toFixed(6)} tokens`);
    
    // Get swap transaction - use public API with auto slippage
    const swapResponse = await fetch('https://public.jupiterapi.com/swap', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        useSharedAccounts: false,  // Disable shared accounts for new tokens
        dynamicComputeUnitLimit: true,
        skipUserAccountsRpcCalls: false,
        autoSlippage: true,
        autoSlippageCollisionUsdValue: 1000,
        maxAutoSlippageBps: 10000,  // Allow up to 100% slippage
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 50000,
            priorityLevel: "veryHigh"
          }
        }
      })
    });
    
    if (!swapResponse.ok) {
      const errorText = await swapResponse.text();
      console.log(`   ❌ Swap request failed: ${swapResponse.status} - ${errorText.slice(0, 100)}`);
      return null;
    }
    
    const swapData = await swapResponse.json();
    
    if (!swapData.swapTransaction) {
      console.log(`   ❌ No swap transaction returned`);
      return null;
    }
    
    // Deserialize and sign
    const txBuffer = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);
    
    // Send with retry
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
      preflightCommitment: 'confirmed'
    });
    
    console.log(`   🚀 TX: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.log(`   ❌ TX Failed: ${JSON.stringify(confirmation.value.err)}`);
      return null;
    }
    
    return {
      signature,
      inputAmount: amountLamports,
      outputAmount: parseInt(quote.outAmount || '0'),
      quote
    };
    
  } catch (error) {
    console.log(`   ❌ ${action} Error: ${error.message}`);
    return null;
  }
}

// Buy token
async function buyToken(tokenMint, tokenSymbol, score) {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const amountLamports = Math.floor(CONFIG.tradeAmountSol * LAMPORTS_PER_SOL);
  
  console.log(`\n🎯 BUYING ${tokenSymbol} (Score: ${score})`);
  console.log(`   Amount: ${CONFIG.tradeAmountSol} SOL`);
  
  const result = await executeSwap(SOL_MINT, tokenMint, amountLamports, true);
  
  if (result) {
    console.log(`   ✅ Bought! Got ${result.outputAmount} tokens`);
    
    // Record position
    positions.set(tokenMint, {
      symbol: tokenSymbol,
      entryTime: Date.now(),
      entryAmountSol: CONFIG.tradeAmountSol,
      tokenAmount: result.outputAmount,
      signature: result.signature
    });
    
    lastBuyTime = Date.now();
    return true;
  }
  
  failedTokens.add(tokenMint);
  return false;
}

// Check and manage positions
async function managePositions() {
  if (positions.size === 0) return;
  
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  for (const [tokenMint, position] of positions) {
    try {
      // Get current value
      const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${tokenMint}&outputMint=${SOL_MINT}&amount=${position.tokenAmount}&slippageBps=${CONFIG.slippageBps}`;
      const quoteResponse = await fetch(quoteUrl);
      
      if (!quoteResponse.ok) continue;
      
      const quote = await quoteResponse.json();
      if (quote.error) continue;
      
      const currentValueSol = parseInt(quote.outAmount || '0') / LAMPORTS_PER_SOL;
      const pnlPercent = ((currentValueSol - position.entryAmountSol) / position.entryAmountSol) * 100;
      
      const emoji = pnlPercent >= 0 ? '📈' : '📉';
      console.log(`   ${emoji} ${position.symbol}: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% (${currentValueSol.toFixed(6)} SOL)`);
      
      // Check take profit
      if (pnlPercent >= CONFIG.takeProfitPercent) {
        console.log(`\n💰 TAKING PROFIT on ${position.symbol} (+${pnlPercent.toFixed(1)}%)`);
        const sellResult = await executeSwap(tokenMint, SOL_MINT, position.tokenAmount, false);
        
        if (sellResult) {
          const profit = currentValueSol - position.entryAmountSol;
          totalPnL += profit;
          wins++;
          console.log(`   ✅ SOLD! Profit: +${profit.toFixed(6)} SOL`);
          positions.delete(tokenMint);
        }
      }
      // Check stop loss
      else if (pnlPercent <= CONFIG.stopLossPercent) {
        console.log(`\n🛑 STOP LOSS on ${position.symbol} (${pnlPercent.toFixed(1)}%)`);
        const sellResult = await executeSwap(tokenMint, SOL_MINT, position.tokenAmount, false);
        
        if (sellResult) {
          const loss = currentValueSol - position.entryAmountSol;
          totalPnL += loss;
          losses++;
          console.log(`   ❌ SOLD! Loss: ${loss.toFixed(6)} SOL`);
          positions.delete(tokenMint);
        }
      }
      
    } catch (error) {
      // Skip this position check
    }
  }
}

// Main scan loop
async function scan() {
  const balance = await getBalance();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL | Positions: ${positions.size}/${CONFIG.maxPositions}`);
  console.log(`📊 P&L: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(6)} SOL | W/L: ${wins}/${losses}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  // Check if we can afford to trade
  if (balance < CONFIG.tradeAmountSol + 0.002) {
    console.log(`⚠️  Low balance! Need ${(CONFIG.tradeAmountSol + 0.002).toFixed(4)} SOL to trade`);
    await managePositions();
    return;
  }
  
  // Manage existing positions first
  await managePositions();
  
  // Check cooldown
  const timeSinceLastBuy = Date.now() - lastBuyTime;
  if (timeSinceLastBuy < CONFIG.cooldownMs) {
    const remaining = Math.ceil((CONFIG.cooldownMs - timeSinceLastBuy) / 1000);
    console.log(`⏳ Cooldown: ${remaining}s remaining`);
    return;
  }
  
  // Check position limit
  if (positions.size >= CONFIG.maxPositions) {
    console.log(`📊 Max positions reached (${positions.size}/${CONFIG.maxPositions})`);
    return;
  }
  
  // Fetch new tokens
  console.log(`🔍 Scanning for opportunities...`);
  const pools = await fetchNewTokens();
  
  if (pools.length === 0) {
    console.log(`   No new pools found`);
    return;
  }
  
  // Score and filter
  const candidates = [];
  
  for (const pool of pools.slice(0, 15)) {
    const score = scoreToken(pool);
    if (score >= CONFIG.minScoreThreshold) {
      candidates.push({ pool, score });
    }
  }
  
  // Sort by score
  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length === 0) {
    console.log(`   No tokens passed score threshold (${CONFIG.minScoreThreshold})`);
    return;
  }
  
  // Try best candidate
  const best = candidates[0];
  const poolAttrs = best.pool.attributes;
  const name = poolAttrs.name || 'Unknown';
  const symbol = name.split('/')[0].trim();
  
  console.log(`\n🎯 Best: ${name} (Score: ${best.score})`);
  console.log(`   Liquidity: $${parseFloat(poolAttrs.reserve_in_usd || 0).toFixed(0)}`);
  console.log(`   Age: ${((Date.now() - new Date(poolAttrs.pool_created_at).getTime()) / 60000).toFixed(1)} mins`);
  
  // Get token address
  const tokenMint = await getTokenAddress(best.pool);
  
  if (!tokenMint) {
    console.log(`   ❌ Could not get token address`);
    return;
  }
  
  if (failedTokens.has(tokenMint) || positions.has(tokenMint)) {
    console.log(`   ⏭️  Skipping (already tried or holding)`);
    return;
  }
  
  console.log(`   Token: ${tokenMint}`);
  
  // Execute buy
  await buyToken(tokenMint, symbol, best.score);
}

// Main loop
async function main() {
  console.log(`\n🚀 Starting micro sniper...`);
  console.log(`   Press Ctrl+C to stop\n`);
  
  const balance = await getBalance();
  console.log(`💰 Starting balance: ${balance.toFixed(6)} SOL (~$${(balance * 128).toFixed(2)})`);
  
  if (balance < CONFIG.tradeAmountSol + 0.002) {
    console.log(`\n⚠️  WARNING: Very low balance!`);
    console.log(`   Need at least ${(CONFIG.tradeAmountSol + 0.002).toFixed(4)} SOL to trade`);
    console.log(`   Current: ${balance.toFixed(6)} SOL`);
    console.log(`   Will monitor only until balance increases.\n`);
  }
  
  // Run scan loop
  while (true) {
    try {
      await scan();
    } catch (error) {
      console.log(`❌ Scan error: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, CONFIG.scanIntervalMs));
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log(`\n\n🛑 Shutting down...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Final Stats:`);
  console.log(`   Total P&L: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(6)} SOL`);
  console.log(`   Wins: ${wins} | Losses: ${losses}`);
  console.log(`   Win Rate: ${wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0}%`);
  
  if (positions.size > 0) {
    console.log(`\n⚠️  Open Positions (${positions.size}):`);
    for (const [mint, pos] of positions) {
      console.log(`   • ${pos.symbol}: ${pos.tokenAmount} tokens`);
    }
  }
  
  const balance = await getBalance();
  console.log(`\n💰 Final Balance: ${balance.toFixed(6)} SOL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(0);
});

main().catch(console.error);
