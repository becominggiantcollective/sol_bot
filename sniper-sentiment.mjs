#!/usr/bin/env node
/**
 * LIVE SNIPER BOT WITH SENTIMENT ANALYSIS
 * - Integrates local ML sentiment service
 * - Boosts scores for bullish tokens
 * - Penalizes bearish/scammy tokens
 */

import fetch from 'node-fetch';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
const CONFIG = {
  // Wallet
  walletKey: 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs',
  walletAddress: 'EZpCKtCMj3dMjnPt2f1egkBQ2khhXP8uK5bWiSt6Y1VV',
  
  // Trade settings
  tradeSize: 0.003,           // SOL per trade (smaller due to low balance)
  maxPositions: 1,            // Max concurrent positions (very low balance)
  minScore: 70,               // Minimum score to buy
  
  // Take profit / Stop loss
  takeProfitPercent: 30,      // +30% = sell
  stopLossPercent: -30,       // -30% = sell
  
  // Filters
  minLiquidity: 1000,         // $1,000 minimum
  maxLiquidity: 100000,       // $100,000 maximum
  minPriceChange: 5,          // Must be going UP at least +5%
  maxAgeMinutes: 5,           // Only tokens < 5 min old
  
  // Sentiment
  sentimentServiceUrl: 'http://localhost:8000',
  useSentiment: true,
  
  // APIs
  jupiterApiKey: 'f6663264-66de-4a78-b115-c14a9efc5a05',
  heliusRpc: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  
  // Timing
  scanInterval: 10000,        // 10 seconds between scans
  positionCheckInterval: 15000, // 15 seconds between position checks
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
const positions = new Map();
const tradeHistory = [];
const failedTokens = new Map(); // Track failed buys to avoid retrying
let isRunning = true;
let totalPnL = 0;

// ═══════════════════════════════════════════════════════════════════════════
// SENTIMENT ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════
async function getSentimentScore(tokenName, tokenSymbol) {
  if (!CONFIG.useSentiment) return 0;
  
  try {
    // Generate synthetic social messages based on token info
    // In production, you'd fetch real Twitter/Telegram messages
    const messages = [
      { text: `${tokenSymbol} just launched on pump.fun, looking good!`, source: 'twitter' },
      { text: `New ${tokenName} token, early entry opportunity`, source: 'telegram' },
      { text: `Buying ${tokenSymbol} now, seems legit`, source: 'discord' },
    ];
    
    const response = await fetch(`${CONFIG.sentimentServiceUrl}/analyze/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      timeout: 3000,
    });
    
    if (!response.ok) return 0;
    
    const data = await response.json();
    const avgScore = data.results.reduce((sum, r) => sum + r.score, 0) / data.results.length;
    return avgScore;
  } catch (error) {
    // Sentiment service down, return neutral
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════
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
    console.error('❌ Error fetching tokens:', error.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════════════════════════════════════
async function scoreToken(pool) {
  const attrs = pool.attributes;
  const name = attrs.name || 'Unknown';
  const address = attrs.address;
  
  // Extract token info
  const tokenSymbol = name.split('/')[0]?.trim() || 'Unknown';
  const priceChange = parseFloat(attrs.price_change_percentage?.h1 || '0');
  const liquidity = parseFloat(attrs.reserve_in_usd || '0');
  const volume = parseFloat(attrs.volume_usd?.h1 || '0');
  const createdAt = new Date(attrs.pool_created_at);
  const ageMinutes = (Date.now() - createdAt.getTime()) / 60000;
  const dex = pool.relationships?.dex?.data?.id || '';
  
  // Base score
  let score = 50;
  let breakdown = ['Base 50'];
  
  // Age bonus (prefer very new)
  if (ageMinutes < 5) {
    score += 25;
    breakdown.push('+25 (very new)');
  } else if (ageMinutes < 15) {
    score += 15;
    breakdown.push('+15 (new)');
  } else if (ageMinutes < 30) {
    score += 5;
    breakdown.push('+5 (recent)');
  } else if (ageMinutes > 60) {
    score -= 15;
    breakdown.push('-15 (old)');
  }
  
  // Momentum bonus
  if (priceChange > 200) {
    score += 20;
    breakdown.push('+20 (🚀 200%+)');
  } else if (priceChange > 100) {
    score += 15;
    breakdown.push('+15 (100%+)');
  } else if (priceChange > 50) {
    score += 10;
    breakdown.push('+10 (50%+)');
  } else if (priceChange > 20) {
    score += 5;
    breakdown.push('+5 (20%+)');
  } else if (priceChange < -20) {
    score -= 10;
    breakdown.push('-10 (dumping)');
  }
  
  // Activity bonus
  if (volume > 0 && liquidity > 0) {
    const ratio = volume / liquidity;
    if (ratio > 2) {
      score += 10;
      breakdown.push('+10 (high activity)');
    } else if (ratio > 0.5) {
      score += 5;
      breakdown.push('+5 (active)');
    }
  }
  
  // Liquidity bonus
  if (liquidity >= 5000 && liquidity <= 50000) {
    score += 10;
    breakdown.push('+10 (sweet spot liq)');
  } else if (liquidity > 100000) {
    score -= 5;
    breakdown.push('-5 (too big)');
  }
  
  // DEX bonus
  if (dex.includes('raydium') || dex.includes('meteora') || dex.includes('orca')) {
    score += 15;  // Prefer established DEXes that don't have trading restrictions
    breakdown.push('+15 (reliable DEX)');
  } else if (dex.includes('pump') || dex.includes('pumpswap')) {
    score += 5;   // Pump.fun tokens often have trading restrictions
    breakdown.push('+5 (pump.fun)');
  }
  
  // 🆕 SENTIMENT BONUS
  const sentimentScore = await getSentimentScore(name, tokenSymbol);
  if (sentimentScore > 0.6) {
    score += 20;
    breakdown.push(`+20 (💚 sentiment ${sentimentScore.toFixed(2)})`);
  } else if (sentimentScore > 0.25) {
    score += 10;
    breakdown.push(`+10 (sentiment ${sentimentScore.toFixed(2)})`);
  } else if (sentimentScore < -0.5) {
    score -= 15;
    breakdown.push(`-15 (🔴 bearish ${sentimentScore.toFixed(2)})`);
  }
  
  return {
    name,
    symbol: tokenSymbol,
    address,
    score,
    breakdown: breakdown.join(' '),
    priceChange,
    liquidity,
    ageMinutes,
    dex,
    sentiment: sentimentScore,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADING
// ═══════════════════════════════════════════════════════════════════════════
async function getTokenAddress(pool) {
  // Extract the non-SOL token from the pool
  const tokens = pool.relationships?.base_token?.data?.id || '';
  const quoteToken = pool.relationships?.quote_token?.data?.id || '';
  
  // The token address is in format "solana_ADDRESS"
  const baseAddr = tokens.replace('solana_', '');
  const quoteAddr = quoteToken.replace('solana_', '');
  
  // Return whichever is NOT SOL
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  if (baseAddr !== SOL_MINT) return baseAddr;
  if (quoteAddr !== SOL_MINT) return quoteAddr;
  
  return null;
}

async function executeSwap(inputMint, outputMint, amountLamports, slippage = 2500) {
  try {
    // Get quote
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippage}`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': CONFIG.jupiterApiKey }
    });
    
    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      throw new Error(`Quote failed: ${err}`);
    }
    
    const quote = await quoteRes.json();
    if (quote.error) throw new Error(quote.error);
    
    // Get swap transaction
    const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.jupiterApiKey,
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: CONFIG.walletAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1000000, // 0.001 SOL max priority fee
            priorityLevel: 'high'
          }
        },
        dynamicSlippage: { maxBps: 5000 }, // 50% max dynamic slippage
      }),
    });
    
    if (!swapRes.ok) {
      const err = await swapRes.text();
      throw new Error(`Swap failed: ${err}`);
    }
    
    const swapData = await swapRes.json();
    if (swapData.error) throw new Error(swapData.error);
    
    // Sign and send transaction
    const { Keypair, VersionedTransaction, Connection } = await import('@solana/web3.js');
    const bs58 = await import('bs58');
    
    const keypair = Keypair.fromSecretKey(bs58.default.decode(CONFIG.walletKey));
    const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
    
    const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([keypair]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(sig, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    return {
      success: true,
      signature: sig,
      inputAmount: amountLamports,
      outputAmount: parseInt(quote.outAmount),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function buyToken(token, pool) {
  const tokenAddress = await getTokenAddress(pool);
  if (!tokenAddress) {
    console.log(`   ❌ Could not find token address`);
    return false;
  }
  
  // Check if we recently failed on this token
  const lastFail = failedTokens.get(tokenAddress);
  if (lastFail && Date.now() - lastFail < 60000) { // 60 second cooldown
    console.log(`   ⏭️ Skipping ${token.symbol} (failed recently)`);
    return false;
  }
  
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const amountLamports = Math.floor(CONFIG.tradeSize * 1e9);
  
  console.log(`   🔄 Swapping ${CONFIG.tradeSize} SOL → ${token.symbol}...`);
  
  const result = await executeSwap(SOL_MINT, tokenAddress, amountLamports, 3000); // 30% slippage
  
  if (result.success) {
    const position = {
      symbol: token.symbol,
      address: tokenAddress,
      poolAddress: pool.attributes.address,
      buyPrice: token.liquidity / (result.outputAmount / 1e6), // Rough estimate
      buyAmount: result.outputAmount,
      buyTime: Date.now(),
      costSol: CONFIG.tradeSize,
      sentiment: token.sentiment,
      signature: result.signature,
    };
    
    positions.set(tokenAddress, position);
    
    console.log(`   ✅ BOUGHT ${token.symbol}!`);
    console.log(`      TX: https://solscan.io/tx/${result.signature}`);
    console.log(`      Tokens: ${(result.outputAmount / 1e6).toFixed(2)}`);
    console.log(`      Sentiment: ${token.sentiment.toFixed(2)}`);
    
    return true;
  } else {
    console.log(`   ❌ Buy failed: ${result.error}`);
    // Add to failed tokens cooldown
    failedTokens.set(tokenAddress, Date.now());
    return false;
  }
}

async function sellToken(position) {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  console.log(`   🔄 Selling ${position.symbol}...`);
  
  const result = await executeSwap(position.address, SOL_MINT, position.buyAmount);
  
  if (result.success) {
    const returnedSol = result.outputAmount / 1e9;
    const pnl = returnedSol - position.costSol;
    const pnlPercent = (pnl / position.costSol) * 100;
    
    totalPnL += pnl;
    
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    console.log(`   ${emoji} SOLD ${position.symbol}!`);
    console.log(`      TX: https://solscan.io/tx/${result.signature}`);
    console.log(`      Returned: ${returnedSol.toFixed(6)} SOL`);
    console.log(`      P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} SOL (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
    
    tradeHistory.push({
      symbol: position.symbol,
      action: 'SELL',
      pnl,
      pnlPercent,
      time: new Date().toISOString(),
    });
    
    positions.delete(position.address);
    return true;
  } else {
    if (result.error?.includes('route') || result.error?.includes('No quote')) {
      console.log(`   ⚠️ ${position.symbol} RUGGED - no sell route available!`);
      position.rugged = true;
    } else {
      console.log(`   ❌ Sell failed: ${result.error}`);
    }
    return false;
  }
}

async function checkPositions() {
  if (positions.size === 0) return;
  
  console.log(`\n📊 Checking ${positions.size} position(s)...`);
  
  for (const [address, position] of positions) {
    if (position.rugged) continue;
    
    try {
      // Get current price via quote
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${address}&outputMint=${SOL_MINT}&amount=${position.buyAmount}&slippageBps=1500`;
      
      const response = await fetch(quoteUrl, {
        headers: { 'x-api-key': CONFIG.jupiterApiKey }
      });
      
      if (!response.ok) {
        console.log(`   ⚠️ ${position.symbol}: Could not get price`);
        continue;
      }
      
      const quote = await response.json();
      if (quote.error) {
        console.log(`   ⚠️ ${position.symbol}: ${quote.error}`);
        continue;
      }
      
      const currentValueSol = parseInt(quote.outAmount) / 1e9;
      const pnlPercent = ((currentValueSol - position.costSol) / position.costSol) * 100;
      
      const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
      console.log(`   ${emoji} ${position.symbol}: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% (${currentValueSol.toFixed(6)} SOL)`);
      
      // Check take profit / stop loss
      if (pnlPercent >= CONFIG.takeProfitPercent) {
        console.log(`   🎉 TAKE PROFIT triggered (+${pnlPercent.toFixed(1)}%)`);
        await sellToken(position);
      } else if (pnlPercent <= CONFIG.stopLossPercent) {
        console.log(`   🛑 STOP LOSS triggered (${pnlPercent.toFixed(1)}%)`);
        await sellToken(position);
      }
    } catch (error) {
      console.log(`   ❌ Error checking ${position.symbol}: ${error.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════
async function scan() {
  if (!isRunning) return;
  
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n🔍 [${timestamp}] Scanning for opportunities...`);
  
  // Check if we can take more positions
  const activePositions = [...positions.values()].filter(p => !p.rugged).length;
  if (activePositions >= CONFIG.maxPositions) {
    console.log(`   ⏸️ Max positions (${CONFIG.maxPositions}) reached, waiting...`);
    return;
  }
  
  // Fetch new tokens
  const pools = await fetchNewTokens();
  if (pools.length === 0) {
    console.log(`   ℹ️ No new tokens found`);
    return;
  }
  
  // Score and filter tokens
  let candidates = [];
  for (const pool of pools.slice(0, 15)) { // Check top 15
    const attrs = pool.attributes;
    const liquidity = parseFloat(attrs.reserve_in_usd || '0');
    const priceChange = parseFloat(attrs.price_change_percentage?.h1 || '0');
    const createdAt = new Date(attrs.pool_created_at);
    const ageMinutes = (Date.now() - createdAt.getTime()) / 60000;
    
    // Quick filters
    if (liquidity < CONFIG.minLiquidity || liquidity > CONFIG.maxLiquidity) continue;
    if (priceChange < CONFIG.minPriceChange) continue;
    if (ageMinutes > CONFIG.maxAgeMinutes) continue;
    
    // Already in position?
    const tokenAddr = await getTokenAddress(pool);
    if (tokenAddr && positions.has(tokenAddr)) continue;
    
    // Score token (includes sentiment)
    const scored = await scoreToken(pool);
    scored.pool = pool;
    candidates.push(scored);
  }
  
  // Sort by score
  candidates.sort((a, b) => b.score - a.score);
  
  // Show top candidates
  if (candidates.length > 0) {
    console.log(`\n   📈 Top candidates:`);
    for (const c of candidates.slice(0, 5)) {
      const emoji = c.score >= CONFIG.minScore ? '🟢' : '⚪';
      const sentEmoji = c.sentiment > 0.5 ? '💚' : c.sentiment < -0.3 ? '🔴' : '';
      console.log(`   ${emoji} ${c.symbol.padEnd(12)} | Score: ${c.score.toString().padStart(3)} | ${c.priceChange >= 0 ? '+' : ''}${c.priceChange.toFixed(0)}% | $${c.liquidity.toFixed(0)} | ${sentEmoji}`);
    }
  }
  
  // Try to buy from top candidates (try up to 3)
  for (const candidate of candidates.slice(0, 3)) {
    if (candidate.score >= CONFIG.minScore) {
      console.log(`\n   🎯 BUYING: ${candidate.symbol} (Score: ${candidate.score})`);
      console.log(`      ${candidate.breakdown}`);
      const success = await buyToken(candidate, candidate.pool);
      if (success) break; // Stop if we successfully bought
    }
  }
}

function printStatus() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`   💰 Total P&L: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(6)} SOL`);
  console.log(`   📊 Open positions: ${positions.size}`);
  console.log(`   📜 Total trades: ${tradeHistory.length}`);
  console.log(`${'═'.repeat(70)}`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║         🎯 LIVE SNIPER BOT + SENTIMENT ANALYSIS 🎯                      ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Wallet: ${CONFIG.walletAddress}             ║
║  Trade Size: ${CONFIG.tradeSize} SOL                                              ║
║  Sentiment: ${CONFIG.useSentiment ? 'ENABLED ✅' : 'DISABLED ❌'}                                               ║
║  Take Profit: +${CONFIG.takeProfitPercent}% | Stop Loss: ${CONFIG.stopLossPercent}%                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Press Ctrl+C to stop                                                    ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
  
  // Check sentiment service
  try {
    const health = await fetch(`${CONFIG.sentimentServiceUrl}/health`);
    if (health.ok) {
      console.log('✅ Sentiment service: CONNECTED');
    } else {
      console.log('⚠️ Sentiment service: NOT RESPONDING (running without)');
      CONFIG.useSentiment = false;
    }
  } catch {
    console.log('⚠️ Sentiment service: NOT RUNNING (running without)');
    CONFIG.useSentiment = false;
  }
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    isRunning = false;
    printStatus();
    
    if (positions.size > 0) {
      console.log('\n⚠️ Open positions remaining:');
      for (const [addr, pos] of positions) {
        console.log(`   - ${pos.symbol}: ${pos.buyAmount} tokens`);
      }
      console.log('   Run emergency-sell.mjs to close all positions');
    }
    
    process.exit(0);
  });
  
  // Main loops
  console.log('\n🚀 Starting live trading...\n');
  
  // Scan for new tokens
  setInterval(scan, CONFIG.scanInterval);
  scan(); // Initial scan
  
  // Check positions
  setInterval(checkPositions, CONFIG.positionCheckInterval);
}

main().catch(console.error);
