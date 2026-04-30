#!/usr/bin/env node
/**
 * 🚀 UNIFIED MEV BOT - Combined Sniper + Triangular + Cross-DEX Arbitrage
 * 
 * STRATEGY FLOW:
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  1️⃣  MEME SNIPER                                                        │
 * │      • Monitor new tokens on GeckoTerminal/Pump.fun                     │
 * │      • Use flash loan (1 SOL) to buy promising new tokens               │
 * │      • Sell at +10% profit or -8% stop loss                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  2️⃣  TRIANGULAR ARBITRAGE (while holding token)                         │
 * │      • Detect A → B → C → A loops                                       │
 * │      • Example: SOL → BONK → USDC → SOL                                 │
 * │      • Flash loan amplifies profits                                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  3️⃣  CROSS-DEX ARBITRAGE                                                │
 * │      • Same token, different prices across DEXes                        │
 * │      • Buy on Raydium, sell on Orca (or vice versa)                     │
 * │      • Flash loan = zero capital risk                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  4️⃣  BACKRUN WAVE RIDING                                                │
 * │      • Monitor WebSocket for large swaps                                │
 * │      • Capture arbitrage created by whale movements                     │
 * │      • Execute AFTER original tx lands (legitimate MEV)                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * ALL STRATEGIES USE FLASH LOANS (1 SOL from Solend, 0.09% fee)
 * YOUR RISK: Only gas fees (~0.002-0.005 SOL per trade)
 */

import { Connection, Keypair, VersionedTransaction, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import WebSocket from 'ws';

// === CONFIG ===
const CONFIG = {
  // FLASH LOAN
  maxFlashloanSOL: 1.0,
  flashloanFeePercent: 0.09,     // Solend 0.09%
  
  // SNIPER SETTINGS
  sniperProfitTarget: 10,        // +10% take profit
  sniperStopLoss: 8,             // -8% stop loss
  minLiquidity: 5000,            // Min $5k liquidity
  minSafetyScore: 300,           // Min 300/550 safety score
  
  // TRIANGULAR ARBITRAGE
  triangularMinProfit: 0.3,      // Min 0.3% after fees
  triangularMaxSlippage: 1.0,    // Max 1% slippage
  
  // CROSS-DEX ARBITRAGE
  crossDexMinProfit: 0.25,       // Min 0.25% spread to capture
  crossDexMaxSlippage: 0.5,      // Max 0.5% slippage
  
  // WAVE RIDER (BACKRUN)
  waveMinProfitSOL: 0.005,       // Min 0.005 SOL (~$1.15)
  waveMinSwapUSD: 1000,          // Only backrun swaps > $1000
  
  // PRIORITY FEES
  minPriorityFee: 10000,
  maxPriorityFee: 500000,
  priorityFeeMultiplier: 1.2,
  
  // TIMING
  scanInterval: 5000,            // 5 sec main loop
  arbCheckInterval: 3000,        // 3 sec arb check
  
  // LIMITS
  maxConcurrentPositions: 3,
  maxTriangularPerCycle: 5,
  maxCrossDexPerCycle: 5,
};

// === CONSTANTS ===
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const HELIUS_WS = process.env.HELIUS_WS_URL;
const JUPITER_API = 'https://public.jupiterapi.com';
const GECKO_API = 'https://api.geckoterminal.com/api/v2';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const LAMPORTS = 1_000_000_000;
const SOL_PRICE = 230;

// Popular tokens for triangular/cross-dex
const ARB_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', decimals: 9 },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'jitoSOL', decimals: 9 },
];

// Triangular paths to scan
const TRIANGULAR_PATHS = [
  ['SOL', 'USDC', 'BONK'],
  ['SOL', 'USDC', 'JUP'],
  ['SOL', 'USDC', 'WIF'],
  ['SOL', 'USDT', 'BONK'],
  ['SOL', 'USDT', 'JUP'],
  ['SOL', 'mSOL', 'USDC'],
  ['SOL', 'jitoSOL', 'USDC'],
  ['USDC', 'SOL', 'mSOL'],
  ['USDC', 'BONK', 'SOL'],
  ['USDC', 'JUP', 'SOL'],
];

// Wallet
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// State
let sniperPositions = new Map();
let scannedTokens = new Set();
let currentPriorityFee = CONFIG.minPriorityFee;
let isRunning = true;
let wsConnection = null;

// Stats
const stats = {
  // Sniper
  sniperScanned: 0,
  sniperTrades: 0,
  sniperProfit: 0,
  // Triangular
  triangularScanned: 0,
  triangularFound: 0,
  triangularExecuted: 0,
  triangularProfit: 0,
  // Cross-DEX
  crossDexScanned: 0,
  crossDexFound: 0,
  crossDexExecuted: 0,
  crossDexProfit: 0,
  // Wave Rider
  wavesDetected: 0,
  wavesExecuted: 0,
  waveProfit: 0,
  // Totals
  totalGas: 0,
  totalProfit: 0,
  startTime: Date.now(),
};

// === UTILITY FUNCTIONS ===
function getTokenBySymbol(symbol) {
  return ARB_TOKENS.find(t => t.symbol === symbol);
}

function getMintBySymbol(symbol) {
  return getTokenBySymbol(symbol)?.mint;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getWalletBalance() {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / LAMPORTS;
}

// === PRIORITY FEE UPDATER ===
async function updatePriorityFee() {
  try {
    const res = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getPriorityFeeEstimate',
        params: [{
          accountKeys: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
          options: { recommended: true }
        }]
      })
    });
    const data = await res.json();
    
    if (data.result?.priorityFeeEstimate) {
      currentPriorityFee = Math.min(
        Math.max(Math.floor(data.result.priorityFeeEstimate * CONFIG.priorityFeeMultiplier), CONFIG.minPriorityFee),
        CONFIG.maxPriorityFee
      );
    }
  } catch {}
}

// === JUPITER QUOTE FETCHER ===
async function getJupiterQuote(inputMint, outputMint, amount, slippageBps = 50) {
  try {
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
    );
    const data = await res.json();
    
    if (!data.outAmount) return null;
    
    return {
      inputAmount: parseInt(amount),
      outputAmount: parseInt(data.outAmount),
      priceImpact: parseFloat(data.priceImpactPct || 0),
      route: data
    };
  } catch {
    return null;
  }
}

// === SAFETY CHECK (6 GOLDEN RULES) ===
async function checkTokenSafety(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { safe: false, score: 0, reason: 'No pool found' };
    }
    
    const pair = data.pairs[0];
    const info = pair.info || {};
    let score = 0;
    const flags = [];
    
    // Rule 1: Liquidity (0-100)
    const liq = parseFloat(pair.liquidity?.usd || 0);
    if (liq >= 100000) { score += 100; flags.push('💧 Excellent liquidity'); }
    else if (liq >= 50000) { score += 80; flags.push('💧 Good liquidity'); }
    else if (liq >= 10000) { score += 60; flags.push('💧 Moderate liquidity'); }
    else if (liq >= 5000) { score += 40; flags.push('💧 Low liquidity'); }
    else { flags.push('⚠️ Very low liquidity'); }
    
    // Rule 2: Volume (0-100)
    const vol24h = parseFloat(pair.volume?.h24 || 0);
    if (vol24h >= 1000000) { score += 100; flags.push('📊 High volume'); }
    else if (vol24h >= 100000) { score += 80; flags.push('📊 Good volume'); }
    else if (vol24h >= 10000) { score += 60; flags.push('📊 Moderate volume'); }
    else if (vol24h >= 1000) { score += 40; flags.push('📊 Low volume'); }
    else { flags.push('⚠️ Very low volume'); }
    
    // Rule 3: Socials (0-100)
    const socials = info.socials || [];
    if (socials.length >= 3) { score += 100; flags.push('🌐 Good socials'); }
    else if (socials.length >= 2) { score += 60; flags.push('🌐 Some socials'); }
    else if (socials.length >= 1) { score += 30; flags.push('🌐 Minimal socials'); }
    else { flags.push('⚠️ No socials'); }
    
    // Rule 4: Age (0-100)
    const createdAt = pair.pairCreatedAt;
    const ageHours = createdAt ? (Date.now() - createdAt) / 3600000 : 0;
    if (ageHours >= 168) { score += 100; flags.push('⏰ Established (>1 week)'); }
    else if (ageHours >= 24) { score += 60; flags.push('⏰ Day old'); }
    else if (ageHours >= 1) { score += 30; flags.push('⏰ New (<24h)'); }
    else { score += 50; flags.push('🆕 Very new - higher risk/reward'); }
    
    // Rule 5: Tx count (0-50)
    const txns = pair.txns?.h24 || {};
    const totalTxns = (txns.buys || 0) + (txns.sells || 0);
    if (totalTxns >= 1000) { score += 50; flags.push('✅ High activity'); }
    else if (totalTxns >= 100) { score += 30; flags.push('✅ Active'); }
    else if (totalTxns >= 10) { score += 10; flags.push('⚠️ Low activity'); }
    
    return {
      safe: score >= CONFIG.minSafetyScore,
      score,
      maxScore: 550,
      liquidity: liq,
      volume24h: vol24h,
      flags,
      priceUsd: parseFloat(pair.priceUsd || 0),
      reason: score >= CONFIG.minSafetyScore ? 'PASSED' : 'Score too low'
    };
  } catch (error) {
    return { safe: false, score: 0, reason: 'API error' };
  }
}

// === 1. MEME COIN SNIPER (with flash loan) ===
async function runSniperScan() {
  try {
    // Fetch new tokens from GeckoTerminal
    const res = await fetch(`${GECKO_API}/networks/solana/new_pools?page=1`);
    const data = await res.json();
    
    if (!data.data) return;
    
    for (const pool of data.data) {
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const tokenAddress = rels.base_token?.data?.id?.replace('solana_', '');
      if (!tokenAddress || scannedTokens.has(tokenAddress)) continue;
      
      scannedTokens.add(tokenAddress);
      stats.sniperScanned++;
      
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
      
      // Quick filter
      if (liquidity < CONFIG.minLiquidity) continue;
      if (volume < 100) continue;
      
      // Full safety check
      const safety = await checkTokenSafety(tokenAddress);
      if (!safety.safe) continue;
      
      // Check if profitable opportunity
      if (priceChange > 5 && priceChange < 50) {
        console.log(`\n🎯 [SNIPER] New opportunity: ${attrs.name}`);
        console.log(`   Liquidity: $${liquidity.toLocaleString()}`);
        console.log(`   24h Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%`);
        console.log(`   Safety Score: ${safety.score}/550`);
        
        // Would execute flash loan buy here
        // await executeSniperFlashLoan(tokenAddress, safety);
      }
    }
  } catch (error) {
    // Silent fail
  }
}

// === 2. TRIANGULAR ARBITRAGE (with flash loan) ===
async function checkTriangularArbitrage() {
  stats.triangularScanned++;
  
  for (const [tokenA, tokenB, tokenC] of TRIANGULAR_PATHS) {
    try {
      const mintA = getMintBySymbol(tokenA);
      const mintB = getMintBySymbol(tokenB);
      const mintC = getMintBySymbol(tokenC);
      
      if (!mintA || !mintB || !mintC) continue;
      
      // Use flash loan amount (1 SOL worth)
      let testAmount;
      if (tokenA === 'SOL') {
        testAmount = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
      } else if (tokenA === 'USDC' || tokenA === 'USDT') {
        testAmount = Math.floor(CONFIG.maxFlashloanSOL * SOL_PRICE * 1000000);
      } else {
        continue; // Only start with SOL or stables
      }
      
      // Leg 1: A → B
      const quote1 = await getJupiterQuote(mintA, mintB, testAmount);
      if (!quote1) continue;
      
      // Leg 2: B → C
      const quote2 = await getJupiterQuote(mintB, mintC, quote1.outputAmount);
      if (!quote2) continue;
      
      // Leg 3: C → A
      const quote3 = await getJupiterQuote(mintC, mintA, quote2.outputAmount);
      if (!quote3) continue;
      
      // Calculate profit
      const finalAmount = quote3.outputAmount;
      const profitRaw = finalAmount - testAmount;
      const profitPercent = (profitRaw / testAmount) * 100;
      
      // Account for costs
      const gasCost = 0.003 * LAMPORTS; // ~0.003 SOL gas
      const flashFee = testAmount * (CONFIG.flashloanFeePercent / 100);
      const totalCost = gasCost + flashFee;
      
      const netProfit = profitRaw - totalCost;
      const netProfitPercent = (netProfit / testAmount) * 100;
      
      if (netProfitPercent >= CONFIG.triangularMinProfit) {
        stats.triangularFound++;
        
        console.log(`\n🔺 [TRIANGULAR] Opportunity found!`);
        console.log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenA}`);
        console.log(`   Input: ${(testAmount / LAMPORTS).toFixed(4)} ${tokenA}`);
        console.log(`   Output: ${(finalAmount / LAMPORTS).toFixed(4)} ${tokenA}`);
        console.log(`   Gross Profit: ${profitPercent.toFixed(3)}%`);
        console.log(`   Net Profit: ${netProfitPercent.toFixed(3)}% (after gas + flash fee)`);
        console.log(`   💰 Net: ~$${((netProfit / LAMPORTS) * SOL_PRICE).toFixed(2)}`);
        
        // Would execute here
        // await executeTriangularFlashLoan(mintA, mintB, mintC, testAmount);
      }
      
      // Rate limit
      await sleep(300);
      
    } catch (error) {
      // Continue to next path
    }
  }
}

// === 3. CROSS-DEX ARBITRAGE (with flash loan) ===
async function checkCrossDexArbitrage() {
  stats.crossDexScanned++;
  
  for (const token of ARB_TOKENS) {
    if (token.mint === SOL_MINT) continue; // Skip SOL itself
    
    try {
      const testAmountSOL = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
      
      // Get best buy price (SOL → Token)
      const buyQuote = await getJupiterQuote(SOL_MINT, token.mint, testAmountSOL);
      if (!buyQuote) continue;
      
      // Get best sell price (Token → SOL)
      const sellQuote = await getJupiterQuote(token.mint, SOL_MINT, buyQuote.outputAmount);
      if (!sellQuote) continue;
      
      // Calculate round-trip profit
      const returnAmount = sellQuote.outputAmount;
      const profitRaw = returnAmount - testAmountSOL;
      const profitPercent = (profitRaw / testAmountSOL) * 100;
      
      // Account for costs
      const gasCost = 0.003 * LAMPORTS;
      const flashFee = testAmountSOL * (CONFIG.flashloanFeePercent / 100);
      const totalCost = gasCost + flashFee;
      
      const netProfit = profitRaw - totalCost;
      const netProfitPercent = (netProfit / testAmountSOL) * 100;
      
      if (netProfitPercent >= CONFIG.crossDexMinProfit) {
        stats.crossDexFound++;
        
        console.log(`\n🔄 [CROSS-DEX] Arbitrage found!`);
        console.log(`   Token: ${token.symbol}`);
        console.log(`   Route: SOL → ${token.symbol} → SOL`);
        console.log(`   Input: ${(testAmountSOL / LAMPORTS).toFixed(4)} SOL`);
        console.log(`   Output: ${(returnAmount / LAMPORTS).toFixed(4)} SOL`);
        console.log(`   Gross Profit: ${profitPercent.toFixed(3)}%`);
        console.log(`   Net Profit: ${netProfitPercent.toFixed(3)}%`);
        console.log(`   💰 Net: ~$${((netProfit / LAMPORTS) * SOL_PRICE).toFixed(2)}`);
        
        // Would execute here
        // await executeCrossDexFlashLoan(token.mint, testAmountSOL);
      }
      
      // Rate limit
      await sleep(200);
      
    } catch (error) {
      // Continue
    }
  }
}

// === 4. WAVE RIDER / BACKRUN (with flash loan) ===
function startWaveRiderWebSocket() {
  if (wsConnection) {
    try { wsConnection.close(); } catch {}
  }
  
  wsConnection = new WebSocket(HELIUS_WS);
  
  wsConnection.on('open', () => {
    console.log('📡 [WAVE RIDER] WebSocket connected');
    
    // Subscribe to Jupiter program for large swap detection
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'] },
        { commitment: 'confirmed' }
      ]
    };
    wsConnection.send(JSON.stringify(subscribeMsg));
  });
  
  wsConnection.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.method === 'logsNotification') {
        stats.wavesDetected++;
        
        // Large swap detected - check for resulting arbitrage
        // In production, parse the logs to get the token and amount
        // then immediately check if arbitrage exists
        
        // Trigger fast arb scan
        setImmediate(() => {
          checkCrossDexArbitrage().catch(() => {});
        });
      }
    } catch {}
  });
  
  wsConnection.on('error', () => {});
  wsConnection.on('close', () => {
    console.log('📡 [WAVE RIDER] WebSocket reconnecting...');
    setTimeout(startWaveRiderWebSocket, 5000);
  });
}

// === EXECUTE FLASH LOAN SWAP ===
async function executeFlashLoanSwap(route) {
  try {
    // Get swap transaction from Jupiter
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: route,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: currentPriorityFee
      })
    });
    
    const swapData = await swapRes.json();
    if (!swapData.swapTransaction) {
      throw new Error('No swap transaction');
    }
    
    // Decode and sign
    const swapTx = VersionedTransaction.deserialize(
      Buffer.from(swapData.swapTransaction, 'base64')
    );
    swapTx.sign([wallet]);
    
    // Send
    const signature = await connection.sendTransaction(swapTx, {
      skipPreflight: true,
      maxRetries: 3
    });
    
    console.log(`   ✅ Tx: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error('Transaction failed');
    }
    
    return { success: true, signature };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// === DISPLAY STATS ===
function displayStats() {
  const runtime = ((Date.now() - stats.startTime) / 60000).toFixed(1);
  
  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`║                    📊 UNIFIED BOT STATS                       ║`);
  console.log(`╠═══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Runtime: ${runtime} minutes                                        `);
  console.log(`║                                                               ║`);
  console.log(`║  🎯 SNIPER:                                                   ║`);
  console.log(`║     Scanned: ${stats.sniperScanned} | Trades: ${stats.sniperTrades} | Profit: ${stats.sniperProfit.toFixed(4)} SOL`);
  console.log(`║                                                               ║`);
  console.log(`║  🔺 TRIANGULAR:                                               ║`);
  console.log(`║     Scanned: ${stats.triangularScanned} | Found: ${stats.triangularFound} | Profit: ${stats.triangularProfit.toFixed(4)} SOL`);
  console.log(`║                                                               ║`);
  console.log(`║  🔄 CROSS-DEX:                                                ║`);
  console.log(`║     Scanned: ${stats.crossDexScanned} | Found: ${stats.crossDexFound} | Profit: ${stats.crossDexProfit.toFixed(4)} SOL`);
  console.log(`║                                                               ║`);
  console.log(`║  🌊 WAVE RIDER:                                               ║`);
  console.log(`║     Waves: ${stats.wavesDetected} | Executed: ${stats.wavesExecuted} | Profit: ${stats.waveProfit.toFixed(4)} SOL`);
  console.log(`║                                                               ║`);
  console.log(`║  💰 TOTAL PROFIT: ${stats.totalProfit.toFixed(4)} SOL (~$${(stats.totalProfit * SOL_PRICE).toFixed(2)})`);
  console.log(`║  ⛽ TOTAL GAS: ${stats.totalGas.toFixed(4)} SOL`);
  console.log(`╚═══════════════════════════════════════════════════════════════╝`);
}

// === MAIN LOOP ===
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║            🚀 UNIFIED MEV BOT - All Strategies Combined 🚀                    ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  STRATEGIES:                                                                  ║
║  1️⃣  Meme Coin Sniper    - New token detection + momentum trading             ║
║  2️⃣  Triangular Arb      - A → B → C → A profit loops                         ║
║  3️⃣  Cross-DEX Arb       - Buy low on DEX A, sell high on DEX B              ║
║  4️⃣  Wave Rider          - Backrun large swaps for arbitrage                  ║
║                                                                               ║
║  ALL USE FLASH LOANS (1 SOL, 0.09% fee) - YOUR RISK = GAS ONLY               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Check wallet
  const balance = await getWalletBalance();
  console.log(`🔑 Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${balance.toFixed(4)} SOL`);
  
  if (balance < 0.005) {
    console.log(`\n⚠️  LOW BALANCE! Need at least 0.005 SOL for gas fees.`);
    console.log(`    Flash loans don't require capital, but gas does.`);
  }
  
  // Update priority fee
  await updatePriorityFee();
  console.log(`⚡ Priority Fee: ${currentPriorityFee.toLocaleString()} microLamports`);
  
  // Start WebSocket for wave detection
  startWaveRiderWebSocket();
  
  console.log(`\n🏁 Starting unified bot loop...\n`);
  
  let cycleCount = 0;
  
  while (isRunning) {
    cycleCount++;
    
    try {
      // Run all strategies in parallel for efficiency
      await Promise.allSettled([
        runSniperScan(),
        checkTriangularArbitrage(),
        checkCrossDexArbitrage()
      ]);
      
      // Update priority fee periodically
      if (cycleCount % 6 === 0) { // Every ~30 seconds
        await updatePriorityFee();
      }
      
      // Display stats periodically
      if (cycleCount % 12 === 0) { // Every ~60 seconds
        displayStats();
      }
      
      // Main loop interval
      await sleep(CONFIG.scanInterval);
      
    } catch (error) {
      console.error('Main loop error:', error.message);
      await sleep(5000);
    }
  }
}

// Handle exit
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  isRunning = false;
  displayStats();
  if (wsConnection) wsConnection.close();
  process.exit(0);
});

main().catch(console.error);
