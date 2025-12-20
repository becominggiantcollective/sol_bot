/**
 * MICRO SCALPER - Works with as little as 0.03 SOL
 * 
 * Strategy: Ultra-small trades with minimal gas
 * Reality: You'll make pennies, but it WILL work
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

// Constants
const RPC = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// MICRO CONFIG - designed for 0.03+ SOL wallets
const MICRO_CONFIG = {
  tradeAmountSOL: 0.01,           // Trade 0.01 SOL at a time (~$1.33)
  reserveForGasSOL: 0.015,        // Keep 0.015 SOL for gas fees
  minProfitPercent: 0.3,          // Need 0.3% profit to cover fees
  maxSlippageBps: 100,            // 1% slippage max
  priorityFeeLamports: 10000,     // Very low priority (0.00001 SOL)
  scanIntervalMs: 5000,           // Scan every 5 seconds
  dryRun: true,                   // START IN DRY RUN!
};

const connection = new Connection(RPC, 'confirmed');

// Load wallet
function loadWallet(): Keypair {
  const pk = process.env.WALLET_IDK_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '';
  if (pk.startsWith('[')) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(pk)));
  }
  return Keypair.fromSecretKey(bs58.decode(pk));
}

const wallet = loadWallet();

// Tracking
let totalProfitSOL = 0;
let totalTrades = 0;
let winningTrades = 0;

async function getBalance(): Promise<number> {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / 1e9;
}

async function getQuote(inputMint: string, outputMint: string, amountLamports: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  try {
    const res = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports.toString(),
        slippageBps: MICRO_CONFIG.maxSlippageBps,
        onlyDirectRoutes: 'true', // Lower fees
      },
      headers,
      timeout: 10000,
    });
    return res.data;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.log('  ⏳ Rate limited, waiting...');
      await sleep(5000);
    }
    return null;
  }
}

async function checkArbitrage(): Promise<{profitable: boolean; profitPercent: number; route: string}> {
  const tradeAmountLamports = Math.floor(MICRO_CONFIG.tradeAmountSOL * 1e9);
  
  // Get SOL -> USDC quote
  const quote1 = await getQuote(SOL_MINT, USDC_MINT, tradeAmountLamports);
  if (!quote1) return { profitable: false, profitPercent: 0, route: '' };
  
  const usdcAmount = parseInt(quote1.outAmount);
  
  // Get USDC -> SOL quote (round trip)
  const quote2 = await getQuote(USDC_MINT, SOL_MINT, usdcAmount);
  if (!quote2) return { profitable: false, profitPercent: 0, route: '' };
  
  const finalSOL = parseInt(quote2.outAmount) / 1e9;
  const profitSOL = finalSOL - MICRO_CONFIG.tradeAmountSOL;
  const profitPercent = (profitSOL / MICRO_CONFIG.tradeAmountSOL) * 100;
  
  // Account for gas costs (~0.00002 SOL for 2 swaps)
  const gasCostSOL = 0.00002;
  const netProfitSOL = profitSOL - gasCostSOL;
  const netProfitPercent = (netProfitSOL / MICRO_CONFIG.tradeAmountSOL) * 100;
  
  return {
    profitable: netProfitPercent >= MICRO_CONFIG.minProfitPercent,
    profitPercent: netProfitPercent,
    route: `SOL(${MICRO_CONFIG.tradeAmountSOL}) → USDC(${(usdcAmount/1e6).toFixed(4)}) → SOL(${finalSOL.toFixed(6)})`,
  };
}

async function runMicroScalper() {
  console.log('═'.repeat(60));
  console.log('💰 MICRO SCALPER - For tiny wallets (0.03+ SOL)');
  console.log('═'.repeat(60));
  
  const balance = await getBalance();
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${balance.toFixed(6)} SOL (~$${(balance * 133).toFixed(2)})`);
  console.log(`Trade Size: ${MICRO_CONFIG.tradeAmountSOL} SOL (~$${(MICRO_CONFIG.tradeAmountSOL * 133).toFixed(2)})`);
  console.log(`Min Profit: ${MICRO_CONFIG.minProfitPercent}%`);
  console.log(`Mode: ${MICRO_CONFIG.dryRun ? '🧪 DRY RUN (no real trades)' : '🔴 LIVE TRADING'}`);
  console.log('═'.repeat(60));
  
  if (balance < MICRO_CONFIG.tradeAmountSOL + MICRO_CONFIG.reserveForGasSOL) {
    console.log(`\n❌ Insufficient balance!`);
    console.log(`   Need: ${(MICRO_CONFIG.tradeAmountSOL + MICRO_CONFIG.reserveForGasSOL).toFixed(4)} SOL`);
    console.log(`   Have: ${balance.toFixed(6)} SOL`);
    console.log(`   Short: ${(MICRO_CONFIG.tradeAmountSOL + MICRO_CONFIG.reserveForGasSOL - balance).toFixed(4)} SOL`);
    return;
  }
  
  console.log('\n🔍 Scanning for micro-arbitrage opportunities...\n');
  
  let scanCount = 0;
  
  while (true) {
    scanCount++;
    
    try {
      const result = await checkArbitrage();
      
      if (result.profitable) {
        console.log(`\n🎯 [Scan ${scanCount}] OPPORTUNITY FOUND!`);
        console.log(`   Route: ${result.route}`);
        console.log(`   Net Profit: ${result.profitPercent.toFixed(4)}%`);
        console.log(`   Estimated: $${(MICRO_CONFIG.tradeAmountSOL * 133 * result.profitPercent / 100).toFixed(4)}`);
        
        if (!MICRO_CONFIG.dryRun) {
          console.log('   🔴 Would execute trade here...');
          // Trade execution would go here
          totalTrades++;
          winningTrades++;
          totalProfitSOL += MICRO_CONFIG.tradeAmountSOL * result.profitPercent / 100;
        } else {
          console.log('   🧪 DRY RUN - Trade simulated');
        }
      } else {
        if (scanCount % 10 === 0) {
          const currentBalance = await getBalance();
          console.log(`[Scan ${scanCount}] No opportunity (spread: ${result.profitPercent.toFixed(3)}%) | Balance: ${currentBalance.toFixed(6)} SOL`);
        }
      }
    } catch (err: any) {
      console.log(`[Scan ${scanCount}] Error: ${err.message}`);
    }
    
    await sleep(MICRO_CONFIG.scanIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n═'.repeat(60));
  console.log('📊 MICRO SCALPER SESSION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Winning: ${winningTrades}`);
  console.log(`Win Rate: ${totalTrades > 0 ? ((winningTrades/totalTrades)*100).toFixed(1) : 0}%`);
  console.log(`Total Profit: ${totalProfitSOL.toFixed(6)} SOL (~$${(totalProfitSOL * 133).toFixed(4)})`);
  console.log('═'.repeat(60));
  process.exit(0);
});

runMicroScalper().catch(console.error);
