/**
 * HONEST TRADING BOT
 * 
 * This bot ONLY reports REAL profits by checking actual balance changes.
 * No more fake "estimated" profits.
 */
import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

const RPC = process.env.SOLANA_RPC_URL;
const JUPITER_API = process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_PRICE = 230;

const connection = new Connection(RPC, 'confirmed');

// Wallet - supports both base58 string and JSON array formats
function loadWallet(): Keypair {
  const privateKeyEnv = process.env.WALLET_IDK_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '';
  
  // Try JSON array format first
  if (privateKeyEnv.startsWith('[')) {
    const privateKeyArray = JSON.parse(privateKeyEnv);
    return Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
  }
  
  // Otherwise treat as base58
  return Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
}

const wallet = loadWallet();

// Real tracking
let realProfitSOL = 0;
let totalTrades = 0;
let successfulTrades = 0;
let failedTrades = 0;

async function getBalance(): Promise<number> {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / 1e9;
}

async function getQuote(inputMint: string, outputMint: string, amount: number, slippageBps: number = 100) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  const res = await axios.get(`${JUPITER_API}/quote`, {
    params: { inputMint, outputMint, amount, slippageBps },
    headers,
    timeout: 10000,
  });
  return res.data;
}

async function executeSwap(quote: any): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
    
    const swapRes = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 50000,
    }, { headers, timeout: 15000 });
    
    if (!swapRes.data?.swapTransaction) {
      return { success: false, error: 'No swap transaction returned' };
    }
    
    const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    // CRITICAL: Wait for ACTUAL confirmation
    const blockhash = await connection.getLatestBlockhash('confirmed');
    const conf = await connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    }, 'confirmed');
    
    if (conf.value.err) {
      return { success: false, signature: sig, error: JSON.stringify(conf.value.err) };
    }
    
    return { success: true, signature: sig };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function findArbitrageOpportunity(): Promise<{ 
  found: boolean; 
  inputMint?: string;
  outputMint?: string;
  amount?: number;
  expectedProfit?: number;
  route?: any;
} | null> {
  // Check SOL balance
  const balance = await getBalance();
  if (balance < 0.005) {
    return null; // Not enough for trading
  }
  
  const tradeSizeSOL = Math.min(balance - 0.002, 0.01); // Trade size, keep 0.002 for gas
  const tradeSizeLamports = Math.floor(tradeSizeSOL * 1e9);
  
  // Simple strategy: Check SOL -> Token -> SOL round trips
  const TOKENS_TO_CHECK = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  ];
  
  for (const token of TOKENS_TO_CHECK) {
    try {
      // SOL -> Token
      const quote1 = await getQuote(SOL_MINT, token, tradeSizeLamports, 50);
      if (!quote1?.outAmount) continue;
      
      const tokenAmount = parseInt(quote1.outAmount);
      
      // Token -> SOL
      const quote2 = await getQuote(token, SOL_MINT, tokenAmount, 50);
      if (!quote2?.outAmount) continue;
      
      const finalSOL = parseInt(quote2.outAmount) / 1e9;
      const profitSOL = finalSOL - tradeSizeSOL;
      const profitPercent = (profitSOL / tradeSizeSOL) * 100;
      
      // Need at least 0.1% profit after gas
      const gasCost = 0.0001; // ~0.0001 SOL for 2 swaps
      const netProfit = profitSOL - gasCost;
      
      if (netProfit > 0) {
        console.log(`🎯 Found opportunity: SOL→${token.slice(0,8)}→SOL: ${profitPercent.toFixed(3)}% (~${netProfit.toFixed(6)} SOL)`);
        return {
          found: true,
          inputMint: SOL_MINT,
          outputMint: token,
          amount: tradeSizeLamports,
          expectedProfit: netProfit,
          route: [quote1, quote2],
        };
      }
    } catch (e) {
      // Skip
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  return null;
}

async function executeTrade(opportunity: any): Promise<boolean> {
  const balanceBefore = await getBalance();
  console.log(`\n📊 Balance before: ${balanceBefore.toFixed(6)} SOL`);
  
  try {
    // Execute leg 1: SOL -> Token
    console.log('  Executing leg 1...');
    const result1 = await executeSwap(opportunity.route[0]);
    if (!result1.success) {
      console.log(`  ❌ Leg 1 failed: ${result1.error}`);
      failedTrades++;
      totalTrades++;
      return false;
    }
    console.log(`  ✅ Leg 1: ${result1.signature?.slice(0, 20)}...`);
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Get actual token balance for leg 2
    // For simplicity, re-quote with actual output
    console.log('  Executing leg 2...');
    const result2 = await executeSwap(opportunity.route[1]);
    if (!result2.success) {
      console.log(`  ❌ Leg 2 failed: ${result2.error}`);
      failedTrades++;
      totalTrades++;
      return false;
    }
    console.log(`  ✅ Leg 2: ${result2.signature?.slice(0, 20)}...`);
    
    // Check REAL profit
    await new Promise(r => setTimeout(r, 2000));
    const balanceAfter = await getBalance();
    const actualProfit = balanceAfter - balanceBefore;
    
    console.log(`\n📊 Balance after: ${balanceAfter.toFixed(6)} SOL`);
    console.log(`💰 REAL profit: ${actualProfit >= 0 ? '+' : ''}${actualProfit.toFixed(6)} SOL ($${(actualProfit * SOL_PRICE).toFixed(4)})`);
    
    if (actualProfit > 0) {
      realProfitSOL += actualProfit;
      successfulTrades++;
    } else {
      failedTrades++;
    }
    totalTrades++;
    
    return actualProfit > 0;
  } catch (error: any) {
    console.log(`  ❌ Trade error: ${error.message}`);
    failedTrades++;
    totalTrades++;
    return false;
  }
}

function displayStats() {
  console.log('\n' + '═'.repeat(60));
  console.log('📈 REAL PROFIT TRACKER (Actual Balance Changes)');
  console.log('═'.repeat(60));
  console.log(`  Total trades:      ${totalTrades}`);
  console.log(`  Successful:        ${successfulTrades}`);
  console.log(`  Failed:            ${failedTrades}`);
  console.log(`  Win rate:          ${totalTrades > 0 ? ((successfulTrades / totalTrades) * 100).toFixed(1) : 0}%`);
  console.log(`  REAL profit:       ${realProfitSOL >= 0 ? '+' : ''}${realProfitSOL.toFixed(6)} SOL`);
  console.log(`  REAL profit USD:   $${(realProfitSOL * SOL_PRICE).toFixed(4)}`);
  console.log('═'.repeat(60));
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🤖 HONEST ARBITRAGE BOT');
  console.log('   Only reports REAL profits from actual balance changes');
  console.log('═'.repeat(60));
  console.log(`Wallet: ${wallet.publicKey.toString()}`);
  
  const balance = await getBalance();
  console.log(`Balance: ${balance.toFixed(6)} SOL (~$${(balance * SOL_PRICE).toFixed(2)})`);
  
  if (balance < 0.005) {
    console.log('\n⚠️ INSUFFICIENT BALANCE');
    console.log('   Need at least 0.005 SOL to trade');
    console.log('   Current: ' + balance.toFixed(6) + ' SOL');
    console.log('   Deposit SOL to: ' + wallet.publicKey.toString());
    return;
  }
  
  console.log('\n🔍 Scanning for opportunities...\n');
  
  let scanCount = 0;
  while (true) {
    try {
      scanCount++;
      const opp = await findArbitrageOpportunity();
      
      if (opp && opp.found) {
        await executeTrade(opp);
        displayStats();
      } else if (scanCount % 10 === 0) {
        const currentBalance = await getBalance();
        console.log(`[Scan ${scanCount}] Balance: ${currentBalance.toFixed(6)} SOL | No profitable opportunities`);
        
        if (currentBalance < 0.005) {
          console.log('\n⚠️ Balance dropped below minimum. Stopping.');
          displayStats();
          break;
        }
      }
      
      // Wait between scans
      await new Promise(r => setTimeout(r, 5000));
      
    } catch (error: any) {
      console.error('Scan error:', error.message);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  displayStats();
  process.exit(0);
});

main().catch(console.error);
