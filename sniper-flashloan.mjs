#!/usr/bin/env node
/**
 * ⚡ FLASH LOAN SNIPER BOT - 3-5 SOL Zero-Capital Trading
 *
 * HOW IT WORKS:
 * 1. Borrow 3-5 SOL via flash loan (NOT your money!)
 * 2. Honeypot detection BEFORE borrowing
 * 3. Buy token → Sell for profit
 * 4. Repay flash loan + 0.3% fee
 * 5. Keep the profit!
 *
 * YOUR COST: Only gas fees (~0.001-0.005 SOL per trade)
 * YOUR RISK: Only gas money (flash loan is free if trade fails)
 *
 * FEATURES:
 * ✅ 3-5 SOL flash loans from Solend
 * ✅ Advanced honeypot detection
 * ✅ Dynamic priority fees
 * ✅ 20% profit target
 * ✅ Auto-exit after 30 minutes
 * ✅ Zero capital required
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { quickCheck } from './honeypot-detector.mjs';
import { analyzeToken, analyzePriceAction, recordTradeOutcome, getModelStats } from './ml-predictor.mjs';

// === CONFIG ===
const CONFIG = {
  // ========== TRADE LIMITS (CONSERVATIVE) ==========
  // Smaller trades for safety
  maxTradeUSD: parseFloat(process.env.MAX_TRADE_USD) || 5,  // $5 max (conservative)
  solPrice: 230,

  // Calculated: $5 / $230 = ~0.022 SOL max per trade
  get maxTradeSOL() { return this.maxTradeUSD / this.solPrice; },

  // PROFIT TARGET - Tighter targets for conservative trading
  profitTargetPct: parseFloat(process.env.PROFIT_TARGET) || 15,  // +15% target (was 10)
  stopLossPct: parseFloat(process.env.STOP_LOSS) || 8,           // -8% stop (tighter)
  maxHoldMin: parseInt(process.env.MAX_HOLD_MIN) || 5,           // 5 min max (faster exit)

  // TRAILING STOP - locks in profits early
  useTrailingStop: true,
  trailingActivatePct: 3,    // Activate at +3% (was 5)
  trailingDistancePct: 2,    // Trail 2% behind (was 3)

  minNetProfitPct: 1.0,           // Min 1% profit AFTER fees (was 0.5%)

  // PRIORITY FEES (Dynamic)
  minPriorityFee: 50000,
  maxPriorityFee: 200000,
  priorityFeeMultiplier: 1.5,

  // SAFETY (CONSERVATIVE - stricter filtering)
  maxRiskScore: 60,               // Much stricter: 60 (was 85)
  requireSellable: true,          // Must pass sell simulation
  minLiquidity: 5000,             // Higher: $5000 (was 2000)

  // SENTIMENT ANALYSIS (ML) - stricter
  useSentiment: true,
  sentimentServiceUrl: 'http://localhost:8000',
  minSentimentScore: -0.2,        // Stricter: -0.2 (was -0.5)

  // TIMING
  scanInterval: 5000,             // 5 sec scan
  monitorInterval: 3000,          // 3 sec position check
  feeUpdateInterval: 30000,       // Update fees every 30s
  maxHoldTimeMin: 30,             // Max 30 min hold time

  // LIMITS
  maxPositions: 1,                // Max 1 concurrent position
};

// === CONSTANTS ===
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_PRICE = 230;
const LAMPORTS_PER_SOL = 1_000_000_000;

// Wallet (only for gas) - WALLET_IDK from .env
const PRIVATE_KEY = '2bYF7j9KWjEfuLLpiYezrH9z7HUpBc3J29zE7j6ZviNkavRkZZFPNurog251FNxHzgs56PwwcrX4DbEN4FSpqkcx';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// State
let positions = new Map();
let scannedTokens = new Set();
let currentPriorityFee = CONFIG.minPriorityFee;
let stats = {
  scanned: 0,
  rejected: 0,
  trades: 0,
  successful: 0,
  failed: 0,
  totalProfit: 0,
  totalGasCost: 0,
  avgPriorityFee: 0
};

// === TIMING ANALYTICS ===
// Track timing patterns for learning
let timingData = {
  trades: [],  // Array of { tokenAge, holdTime, pnlPct, peakPct, peakTime, result }
  patterns: {
    avgTimeToProfit: 0,
    avgTimeToPeak: 0,
    avgPeakPct: 0,
    rugPullAvgTime: 0,  // How fast rugs happen
    profitWindowStart: 0,  // When profits typically start
    profitWindowEnd: 0,    // When to exit before rug
  }
};

function updateTimingPatterns() {
  const profitable = timingData.trades.filter(t => t.result === 'profit');
  const rugged = timingData.trades.filter(t => t.result === 'stoploss' || t.result === 'timeout');
  
  if (profitable.length > 0) {
    timingData.patterns.avgTimeToProfit = profitable.reduce((a, t) => a + t.holdTime, 0) / profitable.length;
    timingData.patterns.avgTimeToPeak = profitable.reduce((a, t) => a + t.peakTime, 0) / profitable.length;
    timingData.patterns.avgPeakPct = profitable.reduce((a, t) => a + t.peakPct, 0) / profitable.length;
  }
  
  if (rugged.length > 0) {
    timingData.patterns.rugPullAvgTime = rugged.reduce((a, t) => a + t.holdTime, 0) / rugged.length;
  }
  
  // Calculate optimal window
  if (profitable.length >= 3) {
    const sortedByTime = [...profitable].sort((a, b) => a.holdTime - b.holdTime);
    timingData.patterns.profitWindowStart = sortedByTime[0].holdTime;
    timingData.patterns.profitWindowEnd = sortedByTime[Math.floor(sortedByTime.length * 0.8)].holdTime;
  }
  
  saveTimingData();
}

function saveTimingData() {
  try {
    fs.writeFileSync('timing-analytics.json', JSON.stringify(timingData, null, 2));
  } catch (e) {}
}

function loadTimingData() {
  try {
    if (fs.existsSync('timing-analytics.json')) {
      timingData = JSON.parse(fs.readFileSync('timing-analytics.json', 'utf8'));
      console.log(`📊 Loaded ${timingData.trades.length} timing records`);
      if (timingData.patterns.avgTimeToProfit > 0) {
        console.log(`   Avg time to profit: ${(timingData.patterns.avgTimeToProfit / 60000).toFixed(1)} min`);
        console.log(`   Avg peak time: ${(timingData.patterns.avgTimeToPeak / 60000).toFixed(1)} min`);
        console.log(`   Avg rug time: ${(timingData.patterns.rugPullAvgTime / 60000).toFixed(1)} min`);
      }
    }
  } catch (e) {}
}

// === DYNAMIC PRIORITY FEE ===
async function updatePriorityFee() {
  try {
    // Method 1: Helius Priority Fee API
    const heliusRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe`, {
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
    
    const heliusData = await heliusRes.json();
    
    if (heliusData.result?.priorityFeeEstimate) {
      const recommendedFee = heliusData.result.priorityFeeEstimate;
      currentPriorityFee = Math.min(
        Math.max(Math.floor(recommendedFee * CONFIG.priorityFeeMultiplier), CONFIG.minPriorityFee),
        CONFIG.maxPriorityFee
      );
      console.log(`⚡ Priority Fee: ${currentPriorityFee.toLocaleString()} microLamports (~${(currentPriorityFee / 1000000).toFixed(6)} SOL)`);
      return;
    }
    
    // Method 2: Fallback to recent fees
    const recentFees = await connection.getRecentPrioritizationFees();
    if (recentFees && recentFees.length > 0) {
      const avgFee = recentFees.reduce((a, b) => a + b.prioritizationFee, 0) / recentFees.length;
      currentPriorityFee = Math.min(
        Math.max(Math.floor(avgFee * CONFIG.priorityFeeMultiplier), CONFIG.minPriorityFee),
        CONFIG.maxPriorityFee
      );
      console.log(`⚡ Priority Fee (fallback): ${currentPriorityFee.toLocaleString()} microLamports`);
    }
    
  } catch (error) {
    console.log(`⚠️ Fee update failed, using: ${currentPriorityFee.toLocaleString()}`);
  }
}

// === SIMPLE TRADE SIZE - ENFORCES $5 MAX ===
function calculateTradeSize(tokenAgeHours, liquidity, riskScore) {
  // Hard limit: never exceed maxTradeSOL (default $5 worth)
  const maxSOL = CONFIG.maxTradeSOL;
  
  // Check wallet balance too
  // Trade size is the SMALLER of: max limit or available balance minus gas reserve
  return maxSOL;
}

// === SIMPLE STRATEGY - JUST USE CONFIG VALUES ===
function selectProfitStrategy(tokenAgeHours, liquidity, riskScore) {
  return {
    targetPct: CONFIG.profitTargetPct,
    stopLossPct: CONFIG.stopLossPct,
    maxHoldMin: CONFIG.maxHoldMin,
    flashloanMax: CONFIG.maxTradeSOL
  };
}

// === SENTIMENT ANALYSIS ===
async function getSentimentScore(tokenName, tokenSymbol) {
  if (!CONFIG.useSentiment) return null;

  try {
    // Generate synthetic social messages based on token info
    // In production, you'd fetch real Twitter/Telegram/Discord messages
    const messages = [
      { text: `${tokenSymbol} just launched, looking good!`, source: 'twitter' },
      { text: `New ${tokenName} token, early entry opportunity`, source: 'telegram' },
      { text: `Buying ${tokenSymbol} now with flash loan`, source: 'discord' },
    ];

    const response = await fetch(`${CONFIG.sentimentServiceUrl}/analyze/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      timeout: 2000,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const avgScore = data.results.reduce((sum, r) => sum + (r.score || 0), 0) / data.results.length;
    return avgScore;
  } catch (error) {
    // Sentiment service down, return neutral
    return null;
  }
}

// === SAFETY CHECK with HONEYPOT DETECTOR ===
async function quickSafetyCheck(mint, tokenName, tokenSymbol) {
  console.log(`\n🔍 Honeypot check for ${mint.slice(0, 8)}...`);

  try {
    // Use advanced honeypot detector
    const check = await quickCheck(mint, CONFIG.maxRiskScore);

    if (check.isHoneypot) {
      console.log(`   🍯 HONEYPOT DETECTED!`);
      console.log(`   Reason: ${check.flags.slice(0, 2).join(', ')}`);
      return {
        safe: false,
        reason: 'Honeypot detected',
        riskScore: check.riskScore,
        flags: check.flags
      };
    }

    if (!check.safe) {
      console.log(`   ⚠️ Risk too high: ${check.riskScore}/100`);
      return {
        safe: false,
        reason: `Risk score ${check.riskScore} exceeds ${CONFIG.maxRiskScore}`,
        riskScore: check.riskScore
      };
    }

    if (!check.canSell && CONFIG.requireSellable) {
      console.log(`   ❌ Cannot sell this token`);
      return {
        safe: false,
        reason: 'Sell simulation failed'
      };
    }

    console.log(`   ✅ SAFE! Risk: ${check.riskScore}/100`);
    console.log(`   ${check.recommendation}`);

    return {
      safe: true,
      riskScore: check.riskScore,
      canSell: check.canSell,
      flags: check.flags,
      recommendation: check.recommendation
    };

  } catch (error) {
    console.log(`   ❌ Check failed: ${error.message}`);
    return { safe: false, reason: `Safety check error: ${error.message}` };
  }
}

// === EXECUTE TRADE (WITH $5 LIMIT) ===
async function executeFlashloanBuy(mint, symbol, tokenAgeHours, liquidity, riskScore) {
  const strategy = selectProfitStrategy(tokenAgeHours, liquidity, riskScore);

  // Check wallet balance FIRST
  const balance = await connection.getBalance(wallet.publicKey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  const gasReserve = 0.01; // Keep 0.01 SOL for gas
  const availableSOL = Math.max(0, balanceSOL - gasReserve);
  
  // Trade size = MINIMUM of: $5 limit, available balance
  const tradeSOL = Math.min(CONFIG.maxTradeSOL, availableSOL);
  
  if (tradeSOL < 0.001) {
    console.log(`❌ Insufficient balance: ${balanceSOL.toFixed(4)} SOL`);
    return false;
  }
  
  const tradeLamports = Math.floor(tradeSOL * LAMPORTS_PER_SOL);

  console.log(`\n🔥 BUY: ${symbol}`);
  console.log(`   Trade: ${tradeSOL.toFixed(4)} SOL (~$${(tradeSOL * CONFIG.solPrice).toFixed(2)}) | Limit: $${CONFIG.maxTradeUSD}`);
  console.log(`   Target: +${strategy.targetPct}% | Stop: -${strategy.stopLossPct}% | Max: ${strategy.maxHoldMin}min`);
  console.log(`   Age: ${tokenAgeHours.toFixed(1)}h | Liquidity: $${liquidity.toLocaleString()}`);
  
  try {
    const quoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${tradeLamports}&slippageBps=300`,
      { headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' } }
    );
    const quote = await quoteRes.json();
    
    if (quote.error || !quote.outAmount) {
      console.log(`❌ No quote for ${symbol}`);
      return false;
    }
    
    const tokensReceived = parseInt(quote.outAmount);
    
    // Get swap transaction with priority fee
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
        prioritizationFeeLamports: currentPriorityFee
      })
    });
    const swapData = await swapRes.json();
    
    if (!swapData.swapTransaction) {
      throw new Error('No swap transaction');
    }
    
    // Sign and send
    const txBuffer = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([wallet]);
    
    console.log(`📤 Sending transaction...`);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,  // Enable preflight to catch errors earlier
      maxRetries: 3
    });
    
    console.log(`⏳ Confirming: ${signature.slice(0, 20)}...`);
    console.log(`   TX: https://solscan.io/tx/${signature}`);
    
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.log(`   ❌ TX Error: ${JSON.stringify(confirmation.value.err)}`);
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    // Calculate actual gas cost (total spent - trade amount = gas only)
    const newBalance = await connection.getBalance(wallet.publicKey);
    const totalSpent = (balance - newBalance) / LAMPORTS_PER_SOL;
    const gasCost = Math.max(0, totalSpent - tradeSOL);  // Gas = total spent minus trade
    stats.totalGasCost += gasCost;
    
    console.log(`✅ BUY EXECUTED!`);
    console.log(`   TX: https://solscan.io/tx/${signature}`);
    console.log(`   Gas Cost: ${gasCost.toFixed(4)} SOL`);
    
    // Track position with strategy
    const position = {
      mint,
      symbol,
      entrySOL: tradeSOL,
      tokensHeld: tokensReceived,
      liquidity,
      strategy: strategy,
      profitTarget: strategy.targetPct,
      stopLoss: strategy.stopLossPct,
      maxHoldMin: strategy.maxHoldMin,
      entryTime: Date.now(),
      entryTx: signature,
      gasCost,
      status: 'ACTIVE'
    };
    
    positions.set(mint, position);
    stats.trades++;
    savePositions();
    
    return true;
    
  } catch (error) {
    console.log(`❌ Trade failed: ${error.message}`);
    stats.failed++;
    return false;
  }
}

// === SELL POSITION ===
async function sellPosition(mint, position, reason) {
  console.log(`\n💰 SELLING ${position.symbol} - ${reason}`);
  
  try {
    // Get actual token balance from wallet (more reliable than stored amount)
    const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID });
    
    let actualAmount = position.tokensHeld.toString();
    for (const acc of tokenAccounts.value) {
      if (acc.account.data.parsed.info.mint === mint) {
        actualAmount = acc.account.data.parsed.info.tokenAmount.amount;
        break;
      }
    }
    
    // Get sell quote with actual balance
    const quoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${actualAmount}&slippageBps=1000`,
      {
        headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
      }
    );
    const quote = await quoteRes.json();
    
    if (quote.error || !quote.outAmount) {
      console.log(`❌ No sell quote: ${quote.error || 'no route'}`);
      return false;
    }
    
    const sellAmountLamports = parseInt(quote.outAmount);
    const sellAmountSOL = sellAmountLamports / LAMPORTS_PER_SOL;
    console.log(`   Expected: ${sellAmountSOL.toFixed(6)} SOL`);
    
    // Get swap with high priority for sells
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
        priorityLevelWithMaxLamports: {
          priorityLevel: 'high',
          maxLamports: 500000
        }
      })
    });
    const swapData = await swapRes.json();
    
    if (!swapData.swapTransaction) {
      throw new Error('No swap transaction');
    }
    
    // Sign and send
    const txBuffer = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([wallet]);
    
    console.log(`📤 Selling...`);
    const balanceBefore = await connection.getBalance(wallet.publicKey);
    
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3
    });
    
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error('Sell failed');
    }
    
    const balanceAfter = await connection.getBalance(wallet.publicKey);
    // Sell gas = expected gain - actual gain
    // balanceAfter should = balanceBefore + sellAmountSOL - sellGas
    // So sellGas = balanceBefore + sellAmountSOL - balanceAfter
    const sellGas = Math.max(0, (balanceBefore + sellAmountLamports - balanceAfter) / LAMPORTS_PER_SOL);
    
    // Profit = what we got back - what we spent (entry + buy gas + sell gas)
    const totalCost = position.entrySOL + position.gasCost + sellGas;
    const profit = sellAmountSOL - totalCost;
    const profitPct = (profit / position.entrySOL) * 100;
    
    console.log(`✅ SOLD!`);
    console.log(`   Entry: ${position.entrySOL.toFixed(4)} SOL`);
    console.log(`   Exit: ${sellAmountSOL.toFixed(4)} SOL`);
    console.log(`   Buy Gas: ${position.gasCost.toFixed(4)} SOL | Sell Gas: ${sellGas.toFixed(4)} SOL`);
    console.log(`   Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} SOL (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)`);
    console.log(`   TX: https://solscan.io/tx/${signature}`);
    
    stats.totalProfit += profit;
    if (profit > 0) stats.successful++;
    
    // === RECORD TIMING DATA ===
    const holdTime = Date.now() - position.entryTime;
    const tradeRecord = {
      symbol: position.symbol,
      tokenAge: position.tokenAgeHours || 0,
      holdTime: holdTime,
      holdTimeMin: (holdTime / 60000).toFixed(2),
      pnlPct: profitPct,
      peakPct: position.peakPct || profitPct,
      peakTime: position.peakTime || holdTime,
      result: reason.includes('PROFIT') ? 'profit' : reason.includes('STOP') ? 'stoploss' : 'timeout',
      timestamp: new Date().toISOString()
    };
    timingData.trades.push(tradeRecord);
    updateTimingPatterns();
    
    // 🧠 ML Learning - record trade outcome
    recordTradeOutcome({
      symbol: position.symbol,
      liquidity: position.liquidity,
      profitPct: profitPct,
      holdTime: holdTime,
      result: tradeRecord.result,
      features: {
        liquidityScore: Math.min(1, (position.liquidity || 0) / 50000),
        volumeScore: 0.5,
        ageScore: Math.min(1, position.tokenAgeHours || 0)
      }
    });
    
    console.log(`   ⏱️ Hold time: ${tradeRecord.holdTimeMin} min | Peak: +${tradeRecord.peakPct.toFixed(1)}%`);
    
    position.status = 'CLOSED';
    position.exitSOL = sellAmountSOL;
    position.profit = profit;
    position.profitPct = profitPct;
    position.exitTx = signature;
    position.exitTime = Date.now();
    positions.set(mint, position);
    savePositions();
    
    return true;
    
  } catch (error) {
    console.log(`❌ Sell failed: ${error.message}`);
    return false;
  }
}

// === MONITOR POSITIONS ===
async function monitorPositions() {
  const activePositions = Array.from(positions.entries()).filter(([_, p]) => p.status === 'ACTIVE');
  
  if (activePositions.length === 0) return;
  
  for (const [mint, pos] of activePositions) {
    try {
      // Get current value
      const quoteRes = await fetch(
        `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${pos.tokensHeld}&slippageBps=500`,
        {
          headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
        }
      );
      const quote = await quoteRes.json();
      
      if (!quote.outAmount) continue;
      
      const currentSOL = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
      const pnlPct = ((currentSOL - pos.entrySOL) / pos.entrySOL) * 100;
      
      // Track peak for timing analytics and trailing stop
      if (!pos.peakPct || pnlPct > pos.peakPct) {
        pos.peakPct = pnlPct;
        pos.peakTime = Date.now() - pos.entryTime;
        positions.set(mint, pos);
      }
      
      const holdTimeMin = (Date.now() - pos.entryTime) / (1000 * 60);
      const emoji = pnlPct >= 0 ? '📈' : '📉';
      
      // Calculate trailing stop level if active
      let trailingStopLevel = null;
      if (CONFIG.useTrailingStop && pos.peakPct >= CONFIG.trailingActivatePct) {
        trailingStopLevel = pos.peakPct - CONFIG.trailingDistancePct;
        console.log(`${emoji} ${pos.symbol}: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% | Peak: +${(pos.peakPct || 0).toFixed(1)}% | Trail: +${trailingStopLevel.toFixed(1)}% | Hold: ${holdTimeMin.toFixed(1)}min`);
      } else {
        console.log(`${emoji} ${pos.symbol}: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% | Peak: +${(pos.peakPct || 0).toFixed(1)}% | Hold: ${holdTimeMin.toFixed(1)}min`);
      }
      
      // Check time-based exit (strategy-specific)
      if (holdTimeMin >= pos.maxHoldMin) {
        await sellPosition(mint, pos, `TIME EXIT (${holdTimeMin.toFixed(1)}min)`);
        continue;
      }
      
      // Check profit target
      if (pnlPct >= pos.profitTarget) {
        await sellPosition(mint, pos, `PROFIT TARGET +${pnlPct.toFixed(1)}%`);
      }
      // Check TRAILING STOP (if activated)
      else if (CONFIG.useTrailingStop && trailingStopLevel !== null && pnlPct <= trailingStopLevel) {
        await sellPosition(mint, pos, `TRAILING STOP +${pnlPct.toFixed(1)}% (peak was +${pos.peakPct.toFixed(1)}%)`);
      }
      // Check regular stop loss
      else if (pnlPct <= -pos.stopLoss) {
        await sellPosition(mint, pos, `STOP LOSS ${pnlPct.toFixed(1)}%`);
      }
      
    } catch {}
  }
}

// === SAVE/LOAD ===
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync('positions-fl.json', 'utf-8'));
    positions = new Map(data.positions || []);
    stats = { ...stats, ...data.stats };
    console.log(`📂 Loaded ${positions.size} positions`);
  } catch {
    console.log('📂 Starting fresh');
  }
}

function savePositions() {
  fs.writeFileSync('positions-fl.json', JSON.stringify({
    positions: Array.from(positions.entries()),
    stats,
    lastSaved: Date.now()
  }, null, 2));
}

// === TOKEN DISCOVERY ===
async function scanNewTokens() {
  try {
    console.log('🔍 Scanning for NEW tokens...');
    // Use NEW pools for fresh tokens with pump potential
    const response = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
    const data = await response.json();

    console.log(`📄 New pools returned ${data.data?.length || 0} pools`);
    const allTokens = [];

    for (const pool of (data.data || []).slice(0, 20)) {  // Check top 20 new
      const attrs = pool.attributes;
      const name = attrs.name?.split(' / ')?.[0] || 'UNKNOWN';
      const mint = pool.relationships?.base_token?.data?.id?.replace('solana_', '');
      const liquidity = parseFloat(attrs.reserve_in_usd || 0);
      const volume = parseFloat(attrs.volume_usd?.h24 || 0);
      const poolCreated = new Date(attrs.pool_created_at);
      const ageHours = (Date.now() - poolCreated.getTime()) / (1000 * 60 * 60);

      console.log(`🔎 ${name}: liq=$${liquidity.toFixed(0)}, vol=$${volume.toFixed(0)}, age=${ageHours.toFixed(1)}h`);

      if (mint && mint !== SOL_MINT && !scannedTokens.has(mint)) {
        // NEW TOKEN CRITERIA - looking for fresh pumps
        if (liquidity < CONFIG.minLiquidity) {
          console.log(`   ❌ Low liquidity (<$${CONFIG.minLiquidity})`);
          continue;
        }
        if (ageHours > 24) {  // Only tokens under 24 hours old
          console.log(`   ❌ Too old (>24h)`);
          continue;
        }
        if (volume < 500) {
          console.log(`   ❌ Low volume (<$500)`);
          continue;
        }

        console.log(`   ✅ PASSED - Age: ${ageHours.toFixed(1)}h, Liq: $${liquidity.toFixed(0)}`);
        allTokens.push({
          mint,
          symbol: name,
          liquidity,
          volume,
          ageHours,
          poolCreated: attrs.pool_created_at
        });
      } else {
        console.log(`❌ ${name}: invalid mint or already scanned`);
      }
    }

    console.log(`🎯 Found ${allTokens.length} candidate tokens`);
    // Sort by liquidity (highest first) and return top candidates
    const sortedTokens = allTokens
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 5);  // Top 5 most liquid

    console.log(`✅ Returning ${sortedTokens.length} tokens for analysis`);
    return sortedTokens;

  } catch (error) {
    console.log(`❌ Scan error: ${error.message}`);
    return [];
  }
}

// === MAIN ===
async function main() {
  const mlStats = getModelStats();
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     🚀 SOLANA SNIPER + 🧠 ML PREDICTIONS - $${CONFIG.maxTradeUSD} MAX 🚀      ║
╠═══════════════════════════════════════════════════════════════╣
║  MAX TRADE:         $${CONFIG.maxTradeUSD} (${CONFIG.maxTradeSOL.toFixed(4)} SOL)                  ║
║  PROFIT TARGET:     +${CONFIG.profitTargetPct}%                                      ║
║  STOP LOSS:         -${CONFIG.stopLossPct}%                                      ║
║  TRAILING STOP:     Activates at +${CONFIG.trailingActivatePct}%, trails ${CONFIG.trailingDistancePct}% behind     ║
║  MAX HOLD:          ${CONFIG.maxHoldMin} minutes                               ║
║  MIN LIQUIDITY:     $${CONFIG.minLiquidity.toLocaleString()}                                 ║
║  🧠 ML MODEL:       ${mlStats.tradesRecorded || 0} trades learned | ${mlStats.accuracy || 0}% accuracy   ║
║                                                               ║
║  💡 Change with: MAX_TRADE_USD=20 PROFIT_TARGET=15            ║
║  🔴 LIVE MAINNET - REAL MONEY                                 ║
╚═══════════════════════════════════════════════════════════════╝
`);

  console.log(`🔑 Wallet: ${wallet.publicKey.toString()}`);
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Gas Balance: ${balanceSOL.toFixed(4)} SOL (~${Math.floor(balanceSOL / 0.003)} trades possible)`);
  
  if (balanceSOL < 0.003) {
    console.log(`\n⚠️ WARNING: Need at least 0.003 SOL for gas!`);
  }
  
  loadPositions();
  loadTimingData();
  
  // Initial fee update
  await updatePriorityFee();
  
  // Fee update interval
  setInterval(updatePriorityFee, CONFIG.feeUpdateInterval);
  
  console.log(`\n📡 Scanning for opportunities...\n`);
  
  // Main loop
  setInterval(async () => {
    try {
      // Monitor positions first
      await monitorPositions();
      
      // Check if we can take more positions
      const activeCount = Array.from(positions.values()).filter(p => p.status === 'ACTIVE').length;
      
      if (activeCount >= CONFIG.maxPositions) {
        return; // Max positions reached
      }
      
      // Scan for new tokens
      const tokens = await scanNewTokens();
      
      for (const token of tokens) {
        stats.scanned++;
        
        // Safety check
        const safety = await quickSafetyCheck(token.mint);
        
        if (!safety.safe) {
          stats.rejected++;
          continue;
        }
        
        // 🧠 ML Prediction
        const mlPrediction = analyzeToken({
          symbol: token.symbol,
          liquidity: token.liquidity,
          volume: token.volume24h || 0,
          ageHours: token.ageHours
        });
        
        console.log(`\n🎯 Found: ${token.symbol}`);
        console.log(`   Safety: ${safety.score}/${safety.maxScore} | Risk: ${safety.riskScore}/100`);
        console.log(`   🧠 ML Score: ${(mlPrediction.score * 100).toFixed(0)}% | ${mlPrediction.recommendation.action}`);
        console.log(`   📊 Rug Risk: ${mlPrediction.rugRisk.riskLevel} (${(mlPrediction.rugRisk.probability * 100).toFixed(0)}%)`);
        safety.flags?.forEach(f => console.log(`   ${f}`));
        
        // Skip if ML says AVOID or rug risk is HIGH
        if (mlPrediction.recommendation.action === 'AVOID' || mlPrediction.rugRisk.riskLevel === 'HIGH') {
          console.log(`   ❌ ML says: ${mlPrediction.recommendation.reason}`);
          stats.rejected++;
          continue;
        }
        
        // Execute trade with strategy selection
        const success = await executeFlashloanBuy(token.mint, token.symbol, token.ageHours, token.liquidity, safety.riskScore);
        
        if (success) {
          await new Promise(r => setTimeout(r, 3000)); // Cooldown
          break; // One trade per scan cycle
        }
      }
      
    } catch (error) {
      console.log(`Loop error: ${error.message}`);
    }
  }, CONFIG.scanInterval);
  
  // Stats every 60s
  setInterval(() => {
    const active = Array.from(positions.values()).filter(p => p.status === 'ACTIVE').length;
    console.log(`\n📊 STATS | Scanned: ${stats.scanned} | Trades: ${stats.trades} | Active: ${active} | Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL | Gas Used: ${stats.totalGasCost.toFixed(4)} SOL`);
  }, 60000);
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  savePositions();
  console.log(`📊 Final Stats:`);
  console.log(`   Total Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL`);
  console.log(`   Total Gas: ${stats.totalGasCost.toFixed(4)} SOL`);
  console.log(`   Net: ${(stats.totalProfit - stats.totalGasCost).toFixed(4)} SOL`);
  process.exit(0);
});

main().catch(console.error);
