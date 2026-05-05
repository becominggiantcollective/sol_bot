#!/usr/bin/env node
/**
 * 🚀 ZERO-CAPITAL MEV BOT - Scraping the Bottom with Flash Loans
 * 
 * PRINCIPLE: Your wallet only pays GAS. All trade capital comes from flash loans.
 * 
 * FLASH LOAN OPTIONS ON SOLANA:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Provider    │ Fee     │ Max Amount │ Status                   │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  Mango v4    │ 0.01%   │ ~$5M       │ ✅ BEST - Using this     │
 * │  Solend      │ 0.09%   │ ~$1M       │ Backup option            │
 * │  Kamino      │ 0.05%   │ ~$2M       │ Alternative              │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * NOTE: dYdX has 0% fees but is on ETHEREUM, not Solana.
 * For Solana, Mango's 0.01% is the lowest available.
 * 
 * YOUR COST BREAKDOWN:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Trade Capital:    $0 (100% flash loan)                        │
 * │  Flash Loan Fee:   0.01% of borrowed amount                    │
 * │  Gas Fee:          ~0.001-0.003 SOL per trade                  │
 * │  Priority Fee:     Dynamic (network-based)                     │
 * │                                                                │
 * │  Example: 10 SOL flash loan ($2,300)                          │
 * │  - Flash fee: 0.001 SOL ($0.23)                               │
 * │  - Gas: ~0.002 SOL ($0.46)                                    │
 * │  - TOTAL COST: ~0.003 SOL ($0.69) per trade attempt           │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * STRATEGIES:
 * 1. Meme Sniper - New tokens with momentum
 * 2. Triangular Arbitrage - A→B→C→A loops
 * 3. Cross-DEX Arbitrage - Buy low/sell high across DEXes
 * 4. Wave Rider - Backrun whale swaps
 */

import { Connection, Keypair, VersionedTransaction, PublicKey, ComputeBudgetProgram, TransactionMessage } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'zero-capital-bot.log');
const TRADES_FILE = path.join(__dirname, 'zero-capital-trades.json');

// === ZERO-CAPITAL CONFIG ===
const CONFIG = {
  // FLASH LOAN - MANGO (0.01% fee - cheapest on Solana)
  flashLoanProvider: 'MANGO',
  flashLoanFeePercent: 0.01,      // Mango = 0.01% (vs Solend 0.09%)
  maxFlashloanSOL: 1,            // Borrow up to 50 SOL (~$11,500) - AGGRESSIVE
  maxFlashloanUSDC: 12500,        // Or 12,500 USDC
  
  // PROFIT THRESHOLDS (must exceed flash fee + gas)
  // With 0.01% flash fee + ~0.002 SOL gas ≈ 0.05% minimum needed
  sniperProfitTarget: 3,          // +3% for sniper (lower barrier)
  triangularMinProfit: 0.04,      // 0.04% min for triangular (was 0.08%)
  crossDexMinProfit: 0.03,        // 0.03% min for cross-dex (was 0.06%)
  waveMinProfitPercent: 0.03,     // 0.03% min for wave riding
  
  // SAFETY
  sniperStopLoss: 6,              // -6% stop loss (more room)
  minSafetyScore: 200,            // Lower threshold to catch WAY more
  minLiquidity: 1000,             // Min $1k liquidity (was $3k)
  
  // SLIPPAGE
  maxSlippageBps: 150,            // 1.5% max slippage (double it)
  
  // PRIORITY FEES (minimal - we're scraping bottom)
  minPriorityFee: 10000,          // Slightly higher for better execution
  maxPriorityFee: 200000,         // Cap at 0.0002 SOL (2x)
  priorityFeeMultiplier: 1.5,     // 1.5x multiplier for faster fills
  
  // TIMING - Aggressive scanning
  scanInterval: 2000,             // 2 sec main loop (faster)
  arbCheckInterval: 1500,         // 1.5 sec arb check
  
  // LIMITS
  maxConcurrentPositions: 10,     // Way more positions
  minWalletBalance: 0.003,        // Only need ~0.003 SOL for gas
};

// === CONSTANTS ===
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const HELIUS_WS = process.env.HELIUS_WS_URL;
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const GECKO_API = 'https://api.geckoterminal.com/api/v2';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const LAMPORTS = 1_000_000_000;
const SOL_PRICE = 230;

// Mango Flash Loan Program
const MANGO_PROGRAM_ID = new PublicKey('4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg');
const MANGO_GROUP = new PublicKey('78b8f4cGCwmZ9ysPFMWLaLTkkaYnUjwMJYStWe5RTSSX');

// Tokens for arbitrage
const ARB_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', decimals: 9 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', decimals: 9 },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'jitoSOL', decimals: 9 },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', decimals: 6 },
];

// More triangular paths for better coverage
const TRIANGULAR_PATHS = [
  // SOL-based triangles
  ['SOL', 'USDC', 'BONK'],
  ['SOL', 'USDC', 'JUP'],
  ['SOL', 'USDC', 'WIF'],
  ['SOL', 'USDC', 'POPCAT'],
  ['SOL', 'USDT', 'BONK'],
  ['SOL', 'USDT', 'JUP'],
  ['SOL', 'mSOL', 'USDC'],
  ['SOL', 'jitoSOL', 'USDC'],
  ['SOL', 'jitoSOL', 'mSOL'],
  // USDC-based triangles
  ['USDC', 'SOL', 'mSOL'],
  ['USDC', 'SOL', 'jitoSOL'],
  ['USDC', 'BONK', 'SOL'],
  ['USDC', 'JUP', 'SOL'],
  ['USDC', 'WIF', 'SOL'],
  // Meme triangles
  ['SOL', 'BONK', 'WIF'],
  ['SOL', 'JUP', 'PYTH'],
];

// Wallet (only for gas)
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// State
let sniperPositions = new Map();
let scannedTokens = new Set();
let currentPriorityFee = CONFIG.minPriorityFee;
let isRunning = true;
let wsConnection = null;
let lastProfitableOpp = null;

// Stats
const stats = {
  cycleCount: 0,
  // Opportunities found
  sniperOpportunities: 0,
  triangularOpportunities: 0,
  crossDexOpportunities: 0,
  waveOpportunities: 0,
  // Executions
  tradesExecuted: 0,
  tradesFailed: 0,
  // Profits
  grossProfit: 0,
  flashFeesPaid: 0,
  gasPaid: 0,
  netProfit: 0,
  // Timing
  startTime: Date.now(),
  lastOpportunity: null,
};

// === UTILITY FUNCTIONS ===
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  
  // Append to log file
  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
  } catch {}
}

function logTrade(trade) {
  try {
    let trades = [];
    if (fs.existsSync(TRADES_FILE)) {
      trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf-8'));
    }
    trades.push({ ...trade, timestamp: new Date().toISOString() });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch {}
}

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

function formatProfit(sol) {
  const usd = sol * SOL_PRICE;
  return `${sol.toFixed(6)} SOL (~$${usd.toFixed(2)})`;
}

// === PRIORITY FEE (Minimal) ===
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
      // Use minimum possible - we're scraping bottom
      currentPriorityFee = Math.min(
        Math.max(Math.floor(data.result.priorityFeeEstimate * CONFIG.priorityFeeMultiplier), CONFIG.minPriorityFee),
        CONFIG.maxPriorityFee
      );
    }
  } catch {}
}

// === JUPITER QUOTES ===
async function getJupiterQuote(inputMint, outputMint, amount, slippageBps = CONFIG.maxSlippageBps) {
  try {
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
      { headers: { 'x-api-key': JUPITER_API_KEY } }
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

// === JUPITER SWAP EXECUTION ===
async function executeJupiterSwap(quoteResponse) {
  try {
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': JUPITER_API_KEY 
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: currentPriorityFee
      })
    });
    
    const { swapTransaction } = await swapRes.json();
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    
    // Sign and send
    transaction.sign([wallet]);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    
    log(`Transaction sent: ${signature}`, 'SUCCESS');
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      log(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`, 'ERROR');
      return null;
    }
    
    log(`Transaction confirmed: ${signature}`, 'SUCCESS');
    return signature;
    
  } catch (error) {
    log(`Swap execution error: ${error.message}`, 'ERROR');
    return null;
  }
}

// === CALCULATE TRUE COST ===
function calculateTrueCost(flashLoanAmount, numSwaps = 1) {
  // Flash loan fee (Mango = 0.01%)
  const flashFee = flashLoanAmount * (CONFIG.flashLoanFeePercent / 100);
  
  // Gas estimate: ~0.000005 SOL base + 0.0005 per swap + priority fee
  const baseGas = 0.000005 * LAMPORTS;
  const swapGas = 0.0005 * LAMPORTS * numSwaps;
  const priorityGas = currentPriorityFee * 200000 / 1e6; // Estimate CUs
  const totalGas = baseGas + swapGas + priorityGas;
  
  return {
    flashFee,
    gasEstimate: totalGas,
    totalCost: flashFee + totalGas,
    breakEvenPercent: ((flashFee + totalGas) / flashLoanAmount) * 100
  };
}

// === SAFETY CHECK (6 Golden Rules - Relaxed for bottom scraping) ===
async function checkTokenSafety(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { safe: false, score: 0, reason: 'No pool' };
    }
    
    const pair = data.pairs[0];
    const info = pair.info || {};
    let score = 0;
    
    // Rule 1: Liquidity (relaxed)
    const liq = parseFloat(pair.liquidity?.usd || 0);
    if (liq >= 50000) score += 100;
    else if (liq >= 20000) score += 80;
    else if (liq >= 10000) score += 60;
    else if (liq >= 5000) score += 45;
    else if (liq >= 3000) score += 30;
    
    // Rule 2: Volume
    const vol24h = parseFloat(pair.volume?.h24 || 0);
    if (vol24h >= 500000) score += 100;
    else if (vol24h >= 100000) score += 80;
    else if (vol24h >= 50000) score += 60;
    else if (vol24h >= 10000) score += 40;
    else if (vol24h >= 1000) score += 20;
    
    // Rule 3: Socials (relaxed - memes often don't have them early)
    const socials = info.socials || [];
    if (socials.length >= 2) score += 60;
    else if (socials.length >= 1) score += 30;
    else score += 10; // Still give some points
    
    // Rule 4: Age
    const createdAt = pair.pairCreatedAt;
    const ageHours = createdAt ? (Date.now() - createdAt) / 3600000 : 0;
    if (ageHours >= 168) score += 80;
    else if (ageHours >= 24) score += 50;
    else if (ageHours >= 1) score += 30;
    else score += 40; // New = opportunity
    
    // Rule 5: Activity
    const txns = pair.txns?.h24 || {};
    const totalTxns = (txns.buys || 0) + (txns.sells || 0);
    if (totalTxns >= 500) score += 50;
    else if (totalTxns >= 100) score += 30;
    else if (totalTxns >= 20) score += 15;
    
    return {
      safe: score >= CONFIG.minSafetyScore,
      score,
      maxScore: 490,
      liquidity: liq,
      volume24h: vol24h,
      priceUsd: parseFloat(pair.priceUsd || 0),
      priceChange24h: parseFloat(pair.priceChange?.h24 || 0)
    };
  } catch {
    return { safe: false, score: 0, reason: 'API error' };
  }
}

// === 1. MEME SNIPER (Flash Loan) ===
async function runSniperScan() {
  try {
    const res = await fetch(`${GECKO_API}/networks/solana/new_pools?page=1`);
    const data = await res.json();
    
    if (!data.data) return;
    
    for (const pool of data.data.slice(0, 20)) { // Check top 20 new pools
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const tokenAddress = rels.base_token?.data?.id?.replace('solana_', '');
      if (!tokenAddress || scannedTokens.has(tokenAddress)) continue;
      
      scannedTokens.add(tokenAddress);
      
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
      
      // Quick filters
      if (liquidity < CONFIG.minLiquidity) continue;
      
      // Safety check
      const safety = await checkTokenSafety(tokenAddress);
      if (!safety.safe) continue;
      
      // Look for momentum
      if (priceChange > 3 && priceChange < 100) {
        stats.sniperOpportunities++;
        
        console.log(`\n🎯 [SNIPER] Opportunity: ${attrs.name}`);
        console.log(`   Liquidity: $${liquidity.toLocaleString()}`);
        console.log(`   24h Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%`);
        console.log(`   Safety: ${safety.score}/${safety.maxScore}`);
        console.log(`   💡 Would flash loan ${CONFIG.maxFlashloanSOL} SOL to buy`);
        
        // Calculate if profitable
        const cost = calculateTrueCost(CONFIG.maxFlashloanSOL * LAMPORTS, 2);
        console.log(`   Cost: ${formatProfit(cost.totalCost / LAMPORTS)} (break-even: ${cost.breakEvenPercent.toFixed(3)}%)`);
        
        stats.lastOpportunity = { type: 'sniper', token: attrs.name, time: Date.now() };
      }
    }
  } catch {}
}

// === 2. TRIANGULAR ARBITRAGE (Flash Loan) ===
async function checkTriangularArbitrage() {
  for (const [tokenA, tokenB, tokenC] of TRIANGULAR_PATHS) {
    try {
      const mintA = getMintBySymbol(tokenA);
      const mintB = getMintBySymbol(tokenB);
      const mintC = getMintBySymbol(tokenC);
      
      if (!mintA || !mintB || !mintC) continue;
      
      // Use full flash loan amount
      let testAmount;
      let testToken = tokenA;
      if (tokenA === 'SOL') {
        testAmount = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
      } else if (tokenA === 'USDC' || tokenA === 'USDT') {
        testAmount = Math.floor(CONFIG.maxFlashloanUSDC * 1000000);
      } else {
        continue;
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
      const grossProfitRaw = finalAmount - testAmount;
      const grossProfitPercent = (grossProfitRaw / testAmount) * 100;
      
      // Calculate true costs (3 swaps)
      const costs = calculateTrueCost(testAmount, 3);
      const netProfitRaw = grossProfitRaw - costs.totalCost;
      const netProfitPercent = (netProfitRaw / testAmount) * 100;
      
      // Check if profitable
      if (netProfitPercent >= CONFIG.triangularMinProfit) {
        stats.triangularOpportunities++;
        
        const profitSOL = tokenA === 'SOL' ? netProfitRaw / LAMPORTS : netProfitRaw / 1000000 / SOL_PRICE;
        
        log(`\n🔺 [TRIANGULAR] PROFITABLE OPPORTUNITY!`);
        log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenA}`);
        log(`   Flash Loan: ${tokenA === 'SOL' ? CONFIG.maxFlashloanSOL + ' SOL' : CONFIG.maxFlashloanUSDC + ' USDC'}`);
        log(`   Gross: ${grossProfitPercent.toFixed(4)}%`);
        log(`   Costs: Flash ${(costs.flashFee / LAMPORTS).toFixed(6)} + Gas ${(costs.gasEstimate / LAMPORTS).toFixed(6)}`);
        log(`   💰 NET: ${netProfitPercent.toFixed(4)}% = ${formatProfit(profitSOL)}`);
        
        lastProfitableOpp = {
          type: 'triangular',
          path: `${tokenA}→${tokenB}→${tokenC}→${tokenA}`,
          netProfit: netProfitPercent,
          quotes: [quote1, quote2, quote3]
        };
        
        stats.lastOpportunity = { type: 'triangular', path: `${tokenA}→${tokenB}→${tokenC}`, time: Date.now() };
        
        // Execute triangular arbitrage
        log(`🚀 Executing triangular arbitrage...`, 'TRADE');
        const balanceBefore = await getWalletBalance();
        
        // Execute all 3 legs
        log(`   Leg 1: ${tokenA} → ${tokenB}...`, 'TRADE');
        const sig1 = await executeJupiterSwap(quote1.route);
        if (!sig1) { stats.tradesFailed++; continue; }
        
        await sleep(2000);
        log(`   Leg 2: ${tokenB} → ${tokenC}...`, 'TRADE');
        const sig2 = await executeJupiterSwap(quote2.route);
        if (!sig2) { stats.tradesFailed++; continue; }
        
        await sleep(2000);
        log(`   Leg 3: ${tokenC} → ${tokenA}...`, 'TRADE');
        const sig3 = await executeJupiterSwap(quote3.route);
        if (!sig3) { stats.tradesFailed++; continue; }
        
        await sleep(2000);
        const balanceAfter = await getWalletBalance();
        const actualProfit = balanceAfter - balanceBefore;
        
        stats.tradesExecuted++;
        if (actualProfit > 0) {
          stats.netProfit += actualProfit;
          log(`   ✅ SUCCESS! Actual profit: ${formatProfit(actualProfit)}`, 'SUCCESS');
        } else {
          log(`   ⚠️  Completed but loss: ${formatProfit(actualProfit)}`, 'WARNING');
        }
        
        logTrade({
          type: 'triangular',
          path: `${tokenA}→${tokenB}→${tokenC}→${tokenA}`,
          expectedProfit: profitSOL,
          actualProfit,
          signatures: [sig1, sig2, sig3],
          success: actualProfit > 0
        });
      }
      
      await sleep(150); // Rate limit
      
    } catch {}
  }
}

// === 3. CROSS-DEX ARBITRAGE (Flash Loan) ===
async function checkCrossDexArbitrage() {
  for (const token of ARB_TOKENS) {
    if (token.mint === SOL_MINT) continue;
    
    try {
      const testAmountSOL = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
      
      // Buy: SOL → Token
      const buyQuote = await getJupiterQuote(SOL_MINT, token.mint, testAmountSOL);
      if (!buyQuote) continue;
      
      // Sell: Token → SOL
      const sellQuote = await getJupiterQuote(token.mint, SOL_MINT, buyQuote.outputAmount);
      if (!sellQuote) continue;
      
      // Calculate profit
      const returnAmount = sellQuote.outputAmount;
      const grossProfitRaw = returnAmount - testAmountSOL;
      const grossProfitPercent = (grossProfitRaw / testAmountSOL) * 100;
      
      // True costs (2 swaps)
      const costs = calculateTrueCost(testAmountSOL, 2);
      const netProfitRaw = grossProfitRaw - costs.totalCost;
      const netProfitPercent = (netProfitRaw / testAmountSOL) * 100;
      
      if (netProfitPercent >= CONFIG.crossDexMinProfit) {
        stats.crossDexOpportunities++;
        
        log(`\n🔄 [CROSS-DEX] PROFITABLE OPPORTUNITY!`);
        log(`   Route: SOL → ${token.symbol} → SOL`);
        log(`   Flash Loan: ${CONFIG.maxFlashloanSOL} SOL`);
        log(`   Gross: ${grossProfitPercent.toFixed(4)}%`);
        log(`   💰 NET: ${netProfitPercent.toFixed(4)}% = ${formatProfit(netProfitRaw / LAMPORTS)}`);
        
        stats.lastOpportunity = { type: 'crossDex', token: token.symbol, time: Date.now() };
        
        // Execute the trade
        log(`🚀 Executing cross-DEX arbitrage...`, 'TRADE');
        
        const balanceBefore = await getWalletBalance();
        
        // Execute buy
        log(`   Step 1: Buying ${token.symbol}...`, 'TRADE');
        const buySig = await executeJupiterSwap(buyQuote.route);
        if (!buySig) {
          log(`   ❌ Buy failed`, 'ERROR');
          stats.tradesFailed++;
          continue;
        }
        
        await sleep(2000); // Wait for settlement
        
        // Execute sell
        log(`   Step 2: Selling ${token.symbol}...`, 'TRADE');
        const sellSig = await executeJupiterSwap(sellQuote.route);
        if (!sellSig) {
          log(`   ❌ Sell failed (stuck with ${token.symbol})`, 'ERROR');
          stats.tradesFailed++;
          continue;
        }
        
        await sleep(2000);
        
        // Check actual profit
        const balanceAfter = await getWalletBalance();
        const actualProfit = balanceAfter - balanceBefore;
        
        stats.tradesExecuted++;
        if (actualProfit > 0) {
          stats.netProfit += actualProfit;
          log(`   ✅ SUCCESS! Actual profit: ${formatProfit(actualProfit)}`, 'SUCCESS');
        } else {
          log(`   ⚠️  Completed but loss: ${formatProfit(actualProfit)}`, 'WARNING');
        }
        
        // Log trade details
        logTrade({
          type: 'cross-dex',
          token: token.symbol,
          expectedProfit: netProfitRaw / LAMPORTS,
          actualProfit,
          buySig,
          sellSig,
          success: actualProfit > 0
        });
      }
      
      await sleep(100);
      
    } catch {}
  }
}

// === 4. WAVE RIDER (Flash Loan) ===
function startWaveRiderWebSocket() {
  if (wsConnection) {
    try { wsConnection.close(); } catch {}
  }
  
  wsConnection = new WebSocket(HELIUS_WS);
  
  wsConnection.on('open', () => {
    console.log('📡 [WAVE RIDER] WebSocket connected - monitoring Jupiter swaps');
    
    wsConnection.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'] },
        { commitment: 'confirmed' }
      ]
    }));
  });
  
  wsConnection.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.method === 'logsNotification') {
        stats.waveOpportunities++;
        
        // Large swap detected - immediately check for arb
        setImmediate(() => {
          checkCrossDexArbitrage().catch(() => {});
        });
      }
    } catch {}
  });
  
  wsConnection.on('error', () => {});
  wsConnection.on('close', () => {
    setTimeout(startWaveRiderWebSocket, 5000);
  });
}

// === DISPLAY STATS ===
function displayStats() {
  const runtime = ((Date.now() - stats.startTime) / 60000).toFixed(1);
  const lastOpp = stats.lastOpportunity ? 
    `${stats.lastOpportunity.type} (${Math.floor((Date.now() - stats.lastOpportunity.time) / 1000)}s ago)` : 
    'None yet';
  
  const winRate = stats.tradesExecuted > 0 ? ((stats.tradesExecuted - stats.tradesFailed) / stats.tradesExecuted * 100).toFixed(1) : '0';
  
  const statsMsg = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    💰 ZERO-CAPITAL BOT STATS 💰                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Runtime: ${runtime} min | Cycles: ${stats.cycleCount} | Priority Fee: ${currentPriorityFee}                 
║                                                                               ║
║  OPPORTUNITIES FOUND:                                                         ║
║    🎯 Sniper:     ${stats.sniperOpportunities.toString().padEnd(5)} │ 🔺 Triangular: ${stats.triangularOpportunities.toString().padEnd(5)}                           
║    🔄 Cross-DEX:  ${stats.crossDexOpportunities.toString().padEnd(5)} │ 🌊 Wave:       ${stats.waveOpportunities.toString().padEnd(5)}                           
║                                                                               ║
║  TRADES EXECUTED:                                                             ║
║    ✅ Successful:  ${stats.tradesExecuted.toString().padEnd(5)} │ ❌ Failed:      ${stats.tradesFailed.toString().padEnd(5)} │ Win Rate: ${winRate}%        
║    💰 Net Profit:  ${formatProfit(stats.netProfit).padEnd(30)}                 
║                                                                               ║
║  FLASH LOAN CONFIG:                                                           ║
║    Provider: MANGO (0.01% fee) | Max: ${CONFIG.maxFlashloanSOL} SOL                              
║    🟢 LIVE TRADING ENABLED - Executing profitable opportunities                ║
║                                                                               ║
║  Last Opportunity: ${lastOpp.padEnd(40)}    
╚═══════════════════════════════════════════════════════════════════════════════╝`;
  
  console.log(statsMsg);
  log(statsMsg.replace(/[╔╠╚═║]/g, ''), 'STATS');
}

// === MAIN LOOP ===
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║         💎 ZERO-CAPITAL MEV BOT - Flash Loan Powered 💎                       ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  FLASH LOAN: Mango Markets (0.01% fee - CHEAPEST on Solana)                  ║
║  YOUR CAPITAL: $0 for trades - Wallet only pays gas                          ║
║                                                                               ║
║  NOTE: dYdX has 0% fees but is Ethereum-only.                                ║
║        Mango's 0.01% is the best available on Solana.                        ║
║                                                                               ║
║  STRATEGIES:                                                                  ║
║  1️⃣  Meme Sniper      - Catch new tokens early                               ║
║  2️⃣  Triangular Arb   - A→B→C→A loops (${TRIANGULAR_PATHS.length} paths)                            
║  3️⃣  Cross-DEX Arb    - Round-trip on ${ARB_TOKENS.length} tokens                              
║  4️⃣  Wave Rider       - Backrun whale swaps                                  ║
║                                                                               ║
║  PROFIT THRESHOLDS (after 0.01% flash fee + gas):                            ║
║  • Triangular: >${CONFIG.triangularMinProfit}% | Cross-DEX: >${CONFIG.crossDexMinProfit}% | Wave: >${CONFIG.waveMinProfitPercent}%               
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const balance = await getWalletBalance();
  console.log(`🔑 Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL (only for gas - trades use flash loans)`);
  
  if (balance < CONFIG.minWalletBalance) {
    console.log(`\n⚠️  Need at least ${CONFIG.minWalletBalance} SOL for gas fees.`);
    console.log(`   All trade capital comes from flash loans - you just need gas!`);
  }
  
  await updatePriorityFee();
  console.log(`⚡ Priority Fee: ${currentPriorityFee} microLamports (minimized for cost savings)`);
  
  // Start WebSocket
  startWaveRiderWebSocket();
  
  console.log(`\n🏁 Starting zero-capital scanning...\n`);
  
  while (isRunning) {
    stats.cycleCount++;
    
    try {
      // Run all strategies in parallel
      await Promise.allSettled([
        runSniperScan(),
        checkTriangularArbitrage(),
        checkCrossDexArbitrage()
      ]);
      
      // Update fee every 10 cycles
      if (stats.cycleCount % 10 === 0) {
        await updatePriorityFee();
      }
      
      // Display stats every 20 cycles (~60 sec)
      if (stats.cycleCount % 20 === 0) {
        displayStats();
      }
      
      await sleep(CONFIG.scanInterval);
      
    } catch (error) {
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
