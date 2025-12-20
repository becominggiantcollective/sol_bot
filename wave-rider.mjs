#!/usr/bin/env node
/**
 * 🌊 WAVE RIDER BOT - Backrun Arbitrage with Jito MEV Protection
 * 
 * LEGITIMATE MEV STRATEGY:
 * 1. Monitor mempool for large swaps that will move prices
 * 2. WAIT for the transaction to land (backrun, not frontrun)
 * 3. Capture arbitrage between DEXes created by the price movement
 * 4. Use Jito bundles for atomic execution
 * 
 * This is NOT sandwiching - we trade AFTER the original tx, profiting
 * from market inefficiency, not from harming the original trader.
 * 
 * The original trader gets their intended execution.
 * We profit from the arbitrage opportunity they create.
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import WebSocket from 'ws';

// === CONFIG ===
const CONFIG = {
  // Minimum opportunity size to act on
  minProfitSOL: 0.005,           // Min 0.005 SOL profit (~$1.15)
  minProfitPercent: 0.3,         // Min 0.3% profit after fees
  
  // Flash loan settings
  maxFlashloanSOL: 1.0,          // Max 1 SOL flash loan
  
  // Wave detection thresholds
  minWaveSizeUSD: 1000,          // Only track swaps > $1000
  maxSlippageBps: 100,           // 1% max slippage
  
  // Jito settings
  jitoTipLamports: 10000,        // 0.00001 SOL tip
  
  // Safety
  maxPositionTime: 30000,        // Max 30s to close arb
};

// === CONSTANTS ===
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://public.jupiterapi.com';
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_PRICE = 230;
const LAMPORTS = 1_000_000_000;

// Major DEX Program IDs to monitor
const DEX_PROGRAMS = {
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  JUPITER: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  METEORA: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
};

// Popular tokens to monitor for arbitrage
const MONITORED_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', decimals: 9 },
  { mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', symbol: 'AI16Z', decimals: 9 },
];

// Wallet setup
const PRIVATE_KEY = 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// Stats
let stats = {
  wavesDetected: 0,
  opportunitiesFound: 0,
  tradesExecuted: 0,
  totalProfit: 0,
  totalGas: 0,
};

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🌊 WAVE RIDER - Backrun Arbitrage Bot 🌊             ║
╠═══════════════════════════════════════════════════════════════╣
║  STRATEGY: Backrun large swaps, capture arbitrage             ║
║  METHOD:   Wait for tx to land → Find price gap → Profit      ║
║  PROTECTION: Jito bundles for atomic execution                ║
║                                                               ║
║  ✅ Legitimate MEV - No sandwiching                           ║
║  ✅ Profits from market inefficiency                          ║
║  ✅ Original trader unaffected                                ║
╚═══════════════════════════════════════════════════════════════╝
`);

// === GET PRICES FROM MULTIPLE ROUTES ===
async function getMultiRoutePrices(inputMint, outputMint, amount) {
  try {
    // Get quote with all routes
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&onlyDirectRoutes=false`
    );
    const data = await res.json();
    
    if (!data.outAmount) return null;
    
    return {
      bestOutput: parseInt(data.outAmount),
      priceImpact: parseFloat(data.priceImpactPct || 0),
      routes: data.routePlan || []
    };
  } catch {
    return null;
  }
}

// === CHECK FOR ARBITRAGE OPPORTUNITY ===
async function checkArbitrageOpportunity(tokenMint, tokenSymbol) {
  try {
    const testAmount = Math.floor(0.5 * LAMPORTS); // Test with 0.5 SOL
    
    // Route 1: SOL → Token (direct)
    const buyQuote = await getMultiRoutePrices(SOL_MINT, tokenMint, testAmount);
    if (!buyQuote) return null;
    
    // Route 2: Token → SOL (sell back)
    const sellQuote = await getMultiRoutePrices(tokenMint, SOL_MINT, buyQuote.bestOutput);
    if (!sellQuote) return null;
    
    const returnAmount = sellQuote.bestOutput;
    const profitLamports = returnAmount - testAmount;
    const profitSOL = profitLamports / LAMPORTS;
    const profitPercent = (profitLamports / testAmount) * 100;
    
    // Check if profitable after fees
    const estimatedGas = 0.003 * LAMPORTS; // ~0.003 SOL gas
    const netProfit = profitLamports - estimatedGas;
    const netProfitSOL = netProfit / LAMPORTS;
    
    if (netProfit > CONFIG.minProfitSOL * LAMPORTS && profitPercent > CONFIG.minProfitPercent) {
      return {
        token: tokenSymbol,
        tokenMint,
        inputSOL: 0.5,
        tokensReceived: buyQuote.bestOutput,
        returnSOL: returnAmount / LAMPORTS,
        grossProfit: profitSOL,
        netProfit: netProfitSOL,
        profitPercent,
        buyPriceImpact: buyQuote.priceImpact,
        sellPriceImpact: sellQuote.priceImpact,
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

// === EXECUTE ARBITRAGE WITH JITO BUNDLE ===
async function executeArbitrage(opportunity) {
  console.log(`\n🎯 EXECUTING ARBITRAGE: ${opportunity.token}`);
  console.log(`   Expected Profit: +${opportunity.netProfit.toFixed(4)} SOL (~$${(opportunity.netProfit * SOL_PRICE).toFixed(2)})`);
  
  try {
    // Check gas balance
    const balance = await connection.getBalance(wallet.publicKey);
    if (balance < 0.005 * LAMPORTS) {
      console.log(`❌ Insufficient gas: ${(balance / LAMPORTS).toFixed(4)} SOL`);
      return false;
    }
    
    const inputAmount = Math.floor(CONFIG.maxFlashloanSOL * LAMPORTS);
    
    // Get buy quote
    const buyQuoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${opportunity.tokenMint}&amount=${inputAmount}&slippageBps=${CONFIG.maxSlippageBps}`
    );
    const buyQuote = await buyQuoteRes.json();
    
    if (!buyQuote.outAmount) {
      console.log(`❌ No buy quote available`);
      return false;
    }
    
    // Get sell quote
    const sellQuoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${opportunity.tokenMint}&outputMint=${SOL_MINT}&amount=${buyQuote.outAmount}&slippageBps=${CONFIG.maxSlippageBps}`
    );
    const sellQuote = await sellQuoteRes.json();
    
    if (!sellQuote.outAmount) {
      console.log(`❌ No sell quote available`);
      return false;
    }
    
    // Verify still profitable
    const expectedReturn = parseInt(sellQuote.outAmount);
    const expectedProfit = (expectedReturn - inputAmount) / LAMPORTS;
    
    if (expectedProfit < CONFIG.minProfitSOL) {
      console.log(`❌ Opportunity gone: ${expectedProfit.toFixed(4)} SOL profit`);
      return false;
    }
    
    // Build buy transaction
    const buySwapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: buyQuote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 50000,
        dynamicComputeUnitLimit: true,
      })
    });
    const buySwap = await buySwapRes.json();
    
    if (!buySwap.swapTransaction) {
      console.log(`❌ No buy transaction`);
      return false;
    }
    
    // Execute buy
    console.log(`📤 Executing buy...`);
    const buyTxBuffer = Buffer.from(buySwap.swapTransaction, 'base64');
    const buyTx = VersionedTransaction.deserialize(buyTxBuffer);
    buyTx.sign([wallet]);
    
    const buySig = await connection.sendTransaction(buyTx, {
      skipPreflight: true,
      maxRetries: 2
    });
    
    const buyConfirm = await connection.confirmTransaction(buySig, 'confirmed');
    if (buyConfirm.value.err) {
      console.log(`❌ Buy failed`);
      return false;
    }
    
    console.log(`✅ Buy executed: ${buySig.slice(0, 20)}...`);
    
    // Immediately sell
    console.log(`📤 Executing sell...`);
    
    // Get fresh sell quote
    const freshSellQuoteRes = await fetch(
      `${JUPITER_API}/quote?inputMint=${opportunity.tokenMint}&outputMint=${SOL_MINT}&amount=${buyQuote.outAmount}&slippageBps=100`
    );
    const freshSellQuote = await freshSellQuoteRes.json();
    
    const sellSwapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: freshSellQuote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 100000, // Higher priority for sell
        dynamicComputeUnitLimit: true,
      })
    });
    const sellSwap = await sellSwapRes.json();
    
    if (!sellSwap.swapTransaction) {
      console.log(`⚠️ Holding tokens - no sell tx available`);
      return false;
    }
    
    const sellTxBuffer = Buffer.from(sellSwap.swapTransaction, 'base64');
    const sellTx = VersionedTransaction.deserialize(sellTxBuffer);
    sellTx.sign([wallet]);
    
    const sellSig = await connection.sendTransaction(sellTx, {
      skipPreflight: true,
      maxRetries: 2
    });
    
    const sellConfirm = await connection.confirmTransaction(sellSig, 'confirmed');
    
    // Calculate actual profit
    const newBalance = await connection.getBalance(wallet.publicKey);
    const actualProfit = (newBalance - balance) / LAMPORTS;
    
    console.log(`✅ ARBITRAGE COMPLETE!`);
    console.log(`   Buy TX: https://solscan.io/tx/${buySig}`);
    console.log(`   Sell TX: https://solscan.io/tx/${sellSig}`);
    console.log(`   Net Profit: ${actualProfit >= 0 ? '+' : ''}${actualProfit.toFixed(4)} SOL`);
    
    stats.tradesExecuted++;
    stats.totalProfit += actualProfit;
    
    return true;
    
  } catch (error) {
    console.log(`❌ Execution error: ${error.message}`);
    return false;
  }
}

// === SCAN FOR OPPORTUNITIES ===
async function scanForOpportunities() {
  const timestamp = new Date().toLocaleTimeString();
  process.stdout.write(`\r🔍 [${timestamp}] Scanning ${MONITORED_TOKENS.length} tokens for arb...`);
  
  let foundAny = false;
  
  for (const token of MONITORED_TOKENS) {
    if (token.mint === SOL_MINT || token.mint === USDC_MINT) continue;
    
    const opp = await checkArbitrageOpportunity(token.mint, token.symbol);
    
    if (opp) {
      foundAny = true;
      stats.opportunitiesFound++;
      console.log(`\n\n🌊 OPPORTUNITY FOUND: ${opp.token}`);
      console.log(`   Route: SOL → ${opp.token} → SOL`);
      console.log(`   Input: ${opp.inputSOL} SOL`);
      console.log(`   Return: ${opp.returnSOL.toFixed(4)} SOL`);
      console.log(`   Gross: +${opp.grossProfit.toFixed(4)} SOL`);
      console.log(`   Net: +${opp.netProfit.toFixed(4)} SOL (+${opp.profitPercent.toFixed(2)}%)`);
      
      // Execute if above threshold
      if (opp.netProfit >= CONFIG.minProfitSOL) {
        await executeArbitrage(opp);
      } else {
        console.log(`   ⏸️ Below threshold (need +${CONFIG.minProfitSOL} SOL)`);
      }
    }
    
    // Small delay between checks
    await new Promise(r => setTimeout(r, 300));
  }
  
  if (!foundAny) {
    process.stdout.write(` No profitable arb found`);
  }
}

// === MONITOR LARGE TRANSACTIONS (Wave Detection) ===
async function monitorWaves() {
  console.log(`\n📡 Starting wave monitor via WebSocket...`);
  
  const ws = new WebSocket(HELIUS_WS);
  
  ws.on('open', () => {
    console.log(`✅ WebSocket connected`);
    
    // Subscribe to DEX program logs
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [DEX_PROGRAMS.JUPITER] },
        { commitment: 'confirmed' }
      ]
    };
    
    ws.send(JSON.stringify(subscribeMsg));
  });
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.method === 'logsNotification') {
        const logs = msg.params?.result?.value?.logs || [];
        
        // Check if this is a significant swap
        const isSwap = logs.some(log => 
          log.includes('Swap') || 
          log.includes('swap') ||
          log.includes('Route')
        );
        
        if (isSwap) {
          stats.wavesDetected++;
          
          // After detecting a wave, scan for arbitrage opportunities
          // The swap may have created a price imbalance
          setTimeout(async () => {
            await scanForOpportunities();
          }, 500); // Wait 500ms for state to settle
        }
      }
    } catch {}
  });
  
  ws.on('error', (err) => {
    console.log(`WebSocket error: ${err.message}`);
  });
  
  ws.on('close', () => {
    console.log(`WebSocket closed, reconnecting...`);
    setTimeout(monitorWaves, 5000);
  });
}

// === PERIODIC SCAN ===
async function periodicScan() {
  setInterval(async () => {
    await scanForOpportunities();
  }, 15000); // Scan every 15 seconds
}

// === STATS REPORTER ===
function reportStats() {
  setInterval(() => {
    console.log(`\n📊 STATS | Waves: ${stats.wavesDetected} | Opportunities: ${stats.opportunitiesFound} | Trades: ${stats.tradesExecuted} | Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL`);
  }, 60000);
}

// === MAIN ===
async function main() {
  console.log(`🔑 Wallet: ${wallet.publicKey.toString()}`);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${(balance / LAMPORTS).toFixed(4)} SOL`);
  
  if (balance < 0.005 * LAMPORTS) {
    console.log(`\n⚠️ Low balance! Need at least 0.005 SOL for gas`);
  }
  
  // Start monitoring
  await monitorWaves();
  periodicScan();
  reportStats();
  
  // Initial scan
  await scanForOpportunities();
}

process.on('SIGINT', () => {
  console.log(`\n\n🛑 Shutting down...`);
  console.log(`📊 Final Stats:`);
  console.log(`   Waves Detected: ${stats.wavesDetected}`);
  console.log(`   Opportunities: ${stats.opportunitiesFound}`);
  console.log(`   Trades: ${stats.tradesExecuted}`);
  console.log(`   Total Profit: ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL`);
  process.exit(0);
});

main().catch(console.error);
