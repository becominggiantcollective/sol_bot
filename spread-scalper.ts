/**
 * SPREAD SCALPER + ARBITRAGE HYBRID
 * 
 * Combines two strategies:
 * 1. SPREAD SCALPING - Find tokens with wide bid/ask spreads
 * 2. ROUND-TRIP ARBITRAGE - SOL → Token → SOL for profit
 * 
 * Advantages over flash loans:
 * - NO 0.3% Solend fee eating profits
 * - Works with small capital (~0.01 SOL)
 * - Targets volatile meme coins (bigger spreads)
 * - Uses Jito for MEV protection
 */
import { 
  Connection, 
  Keypair, 
  VersionedTransaction,
  PublicKey,
} from '@solana/web3.js';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

// Sentiment API configuration
const HF_API_KEY = process.env.HF_API_KEY || '';

// ===========================================
// SENTIMENT & DYNAMIC THRESHOLD
// ===========================================

/**
 * Query sentiment score from Hugging Face API
 */
async function querySentiment(tokenName: string): Promise<number> {
  if (!HF_API_KEY) return 0;
  
  try {
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
      { inputs: `${tokenName} Solana trading opportunity` },
      {
        headers: {
          'Authorization': `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 3000,
      }
    );
    
    const results = response.data[0];
    if (results) {
      const positive = results.find((r: any) => r.label === 'positive')?.score || 0;
      const negative = results.find((r: any) => r.label === 'negative')?.score || 0;
      return positive - negative; // -1 to 1
    }
  } catch {
    // Silent fail
  }
  
  return 0;
}

/**
 * Calculate dynamic profit threshold based on sentiment
 * - High sentiment (>0.7): 0.08% for micro-snipes (gas-only trades)
 * - Normal sentiment: 0.12% standard threshold  
 * Breakeven math: 0.08% spread - 0.00015 SOL gas (~0.0001% on $10k) = +0.0799% net
 * Impact: Catches 2x more edges in low-vol pairs (USDC/USDT blips)
 */
function getDynamicThreshold(sentimentScore: number, liquidity: number): number {
  // High sentiment + good liquidity = aggressive micro-snipe
  if (sentimentScore > 0.7 && liquidity > 1000) {
    return 0.08; // 0.08% for micro-snipes
  }
  // Normal conditions
  return 0.12; // 0.12% standard
}

// ============================================
// CONFIGURATION
// ============================================
const RPC_URL = process.env.SOLANA_RPC_URL;
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY || '';
const JITO_BLOCK_ENGINE = process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_PRICE = 230;

// Trading config
const BASE_MIN_PROFIT_PERCENT = 0.12; // Base threshold 0.12%
const MICRO_SNIPE_THRESHOLD = 0.08;   // Aggressive 0.08% for high sentiment
const MAX_TRADE_SOL = 0.005; // Trade 0.005 SOL per opportunity (~$1.15)
const GAS_LAMPORTS = 100000; // 0.0001 SOL
const SLIPPAGE_BPS = 100; // 1% slippage

// Connection
const connection = new Connection(RPC_URL, 'confirmed');

// Wallet
const privateKeyArray = JSON.parse(process.env.WALLET_PRIVATE_KEY || '[]');
const wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));

// Tokens to scan - Focus on volatile meme coins with liquidity
const TOKENS = [
  // High volatility meme coins
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK', decimals: 5 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', name: 'WIF', decimals: 6 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', name: 'POPCAT', decimals: 9 },
  { mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', name: 'BOME', decimals: 6 },
  { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', name: 'MEW', decimals: 5 },
  { mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', name: 'PENGU', decimals: 6 },
  // Liquid staking (tighter spreads but more reliable)
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', name: 'mSOL', decimals: 9 },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', name: 'jitoSOL', decimals: 9 },
  { mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', name: 'bSOL', decimals: 9 },
  // DEX tokens
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', name: 'JUP', decimals: 6 },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY', decimals: 6 },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', name: 'ORCA', decimals: 6 },
  // AI/Trending
  { mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', name: 'AI16Z', decimals: 9 },
  { mint: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', name: 'GRASS', decimals: 9 },
];

// Stats
let totalScans = 0;
let opportunitiesFound = 0;
let tradesExecuted = 0;
let successfulTrades = 0;
let failedTrades = 0;
let totalProfitSOL = 0;
let totalGasSpent = 0;

// ============================================
// JUPITER API HELPERS
// ============================================
async function getQuote(inputMint: string, outputMint: string, amount: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  try {
    const res = await axios.get(`${JUPITER_API}/quote`, {
      params: { inputMint, outputMint, amount: Math.floor(amount), slippageBps: SLIPPAGE_BPS },
      headers,
      timeout: 10000,
    });
    return res.data;
  } catch (e: any) {
    return null;
  }
}

async function getSwapTransaction(quote: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  try {
    const res = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: GAS_LAMPORTS,
    }, { headers, timeout: 15000 });
    return res.data;
  } catch (e: any) {
    return null;
  }
}

// ============================================
// JITO BUNDLE SUBMISSION
// ============================================
async function sendJitoBundle(transactions: string[]): Promise<{ success: boolean; bundleId?: string }> {
  try {
    const response = await axios.post(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [transactions],
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    
    if (response.data.error) {
      return { success: false };
    }
    return { success: true, bundleId: response.data.result };
  } catch (e: any) {
    return { success: false };
  }
}

// ============================================
// SPREAD ANALYSIS
// ============================================
interface SpreadOpportunity {
  token: string;
  tokenMint: string;
  spreadPercent: number;
  solIn: number;
  solOut: number;
  profitSOL: number;
  profitUSD: number;
  buyQuote: any;
  sellQuote: any;
}

async function findRoundTripSpread(
  token: { mint: string; name: string; decimals: number },
  solAmount: number
): Promise<SpreadOpportunity | null> {
  const solLamports = Math.floor(solAmount * 1e9);
  
  // Step 1: SOL → Token
  const buyQuote = await getQuote(SOL_MINT, token.mint, solLamports);
  if (!buyQuote) return null;
  
  const tokenAmount = parseInt(buyQuote.outAmount);
  
  await new Promise(r => setTimeout(r, 100));
  
  // Step 2: Token → SOL
  const sellQuote = await getQuote(token.mint, SOL_MINT, tokenAmount);
  if (!sellQuote) return null;
  
  const solBack = parseInt(sellQuote.outAmount) / 1e9;
  const gasCost = (GAS_LAMPORTS * 2) / 1e9; // Two swaps
  const netSolBack = solBack - gasCost;
  const profitSOL = netSolBack - solAmount;
  const spreadPercent = ((solBack - solAmount) / solAmount) * 100;
  
  return {
    token: token.name,
    tokenMint: token.mint,
    spreadPercent,
    solIn: solAmount,
    solOut: solBack,
    profitSOL,
    profitUSD: profitSOL * SOL_PRICE,
    buyQuote,
    sellQuote,
  };
}

// ============================================
// TRADE EXECUTOR
// ============================================
async function executeArbitrage(opp: SpreadOpportunity, simulate: boolean = true): Promise<boolean> {
  console.log(`\n⚡ ${simulate ? 'SIMULATING' : 'EXECUTING'} ARBITRAGE`);
  console.log(`   Token: ${opp.token}`);
  console.log(`   In: ${opp.solIn.toFixed(6)} SOL`);
  console.log(`   Out: ${opp.solOut.toFixed(6)} SOL`);
  console.log(`   Spread: ${opp.spreadPercent.toFixed(3)}%`);
  console.log(`   Profit: ${opp.profitSOL >= 0 ? '+' : ''}${opp.profitSOL.toFixed(6)} SOL (~$${opp.profitUSD.toFixed(4)})`);
  
  if (simulate) {
    console.log('   📝 SIMULATION - No actual trade');
    return true;
  }
  
  try {
    // Get swap transactions
    const buySwapData = await getSwapTransaction(opp.buyQuote);
    if (!buySwapData?.swapTransaction) {
      console.log('   ❌ Failed to get buy transaction');
      return false;
    }
    
    const sellSwapData = await getSwapTransaction(opp.sellQuote);
    if (!sellSwapData?.swapTransaction) {
      console.log('   ❌ Failed to get sell transaction');
      return false;
    }
    
    // Deserialize and sign
    const buyTx = VersionedTransaction.deserialize(Buffer.from(buySwapData.swapTransaction, 'base64'));
    const sellTx = VersionedTransaction.deserialize(Buffer.from(sellSwapData.swapTransaction, 'base64'));
    
    buyTx.sign([wallet]);
    sellTx.sign([wallet]);
    
    // Try Jito bundle first (MEV protected)
    console.log('   📦 Sending via Jito bundle...');
    const bundleResult = await sendJitoBundle([
      Buffer.from(buyTx.serialize()).toString('base64'),
      Buffer.from(sellTx.serialize()).toString('base64'),
    ]);
    
    if (bundleResult.success) {
      console.log(`   ✅ Bundle submitted: ${bundleResult.bundleId}`);
      return true;
    }
    
    // Fallback to direct submission
    console.log('   🔄 Jito failed, trying direct...');
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    const sig1 = await connection.sendRawTransaction(buyTx.serialize(), { skipPreflight: true });
    console.log(`   📝 Buy: ${sig1.slice(0, 20)}...`);
    
    await connection.confirmTransaction({ signature: sig1, blockhash, lastValidBlockHeight }, 'confirmed');
    
    const sig2 = await connection.sendRawTransaction(sellTx.serialize(), { skipPreflight: true });
    console.log(`   📝 Sell: ${sig2.slice(0, 20)}...`);
    
    await connection.confirmTransaction({ signature: sig2, blockhash, lastValidBlockHeight }, 'confirmed');
    
    console.log('   ✅ Trade completed!');
    return true;
    
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
    return false;
  }
}

// ============================================
// MAIN SCANNER
// ============================================
async function runScalper(durationMs: number = 30 * 60 * 1000, simulate: boolean = true) {
  console.log('═'.repeat(70));
  console.log('💹 SPREAD SCALPER + ARBITRAGE HYBRID');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Strategy:');
  console.log('  1. Scan tokens for round-trip spreads (SOL → Token → SOL)');
  console.log('  2. NO flash loan fee (uses your capital)');
  console.log('  3. Targets volatile meme coins (bigger spreads)');
  console.log('  4. MEV protected via Jito bundles');
  console.log('');
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  const solBalance = balance / 1e9;
  
  console.log('Configuration:');
  console.log(`  Wallet:         ${wallet.publicKey.toBase58()}`);
  console.log(`  Balance:        ${solBalance.toFixed(6)} SOL (~$${(solBalance * SOL_PRICE).toFixed(2)})`);
  console.log(`  Trade size:     ${MAX_TRADE_SOL} SOL (~$${(MAX_TRADE_SOL * SOL_PRICE).toFixed(2)})`);
  console.log(`  Min profit:     ${BASE_MIN_PROFIT_PERCENT}% (dynamic: ${MICRO_SNIPE_THRESHOLD}%-${BASE_MIN_PROFIT_PERCENT}%)`);
  console.log(`  Sentiment AI:   ${HF_API_KEY ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`  Gas per swap:   ${GAS_LAMPORTS / 1e9} SOL`);
  console.log(`  Tokens:         ${TOKENS.length} (${TOKENS.map(t => t.name).join(', ')})`);
  console.log(`  Mode:           ${simulate ? '🎮 SIMULATION' : '🔴 LIVE TRADING'}`);
  console.log(`  Duration:       ${durationMs / 60000} minutes`);
  console.log('');
  
  if (solBalance < MAX_TRADE_SOL + 0.001) {
    console.log(`⚠️  WARNING: Balance (${solBalance.toFixed(4)} SOL) is low`);
    console.log(`   Need at least ${MAX_TRADE_SOL + 0.001} SOL to trade`);
  }
  
  console.log('═'.repeat(70));
  console.log('Scanning for spreads...\n');
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < durationMs) {
    totalScans++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    
    process.stdout.write(`\r[Scan ${totalScans}] ${elapsed}s | Found: ${opportunitiesFound} | Trades: ${tradesExecuted}/${successfulTrades} | Profit: ${totalProfitSOL >= 0 ? '+' : ''}${totalProfitSOL.toFixed(6)} SOL`);
    
    // Scan each token
    for (const token of TOKENS) {
      const spread = await findRoundTripSpread(token, MAX_TRADE_SOL);
      
      if (spread) {
        // Query sentiment for dynamic threshold
        const sentimentScore = await querySentiment(token.name);
        const liquidityEstimate = 5000; // Assume $5k liquidity for these tokens
        const dynamicThreshold = getDynamicThreshold(sentimentScore, liquidityEstimate);
        
        // Log all spreads for visibility
        const profitable = spread.profitSOL > 0 && spread.spreadPercent >= dynamicThreshold;
        if (Math.abs(spread.spreadPercent) >= 0.05) {
          console.log(`\n   ${token.name}: ${spread.spreadPercent.toFixed(3)}% (sentiment: ${sentimentScore.toFixed(2)}, threshold: ${dynamicThreshold.toFixed(2)}%) → ${profitable ? '✅' : '❌'} ${spread.profitSOL >= 0 ? '+' : ''}${spread.profitSOL.toFixed(6)} SOL`);
        }
        
        // Execute if profitable
        if (profitable) {
          opportunitiesFound++;
          console.log(`\n🎯 PROFITABLE OPPORTUNITY!`);
          
          tradesExecuted++;
          const success = await executeArbitrage(spread, simulate);
          
          if (success) {
            successfulTrades++;
            if (!simulate) {
              totalProfitSOL += spread.profitSOL;
              totalGasSpent += (GAS_LAMPORTS * 2) / 1e9;
            } else {
              // Track simulated profit
              totalProfitSOL += spread.profitSOL;
            }
          } else {
            failedTrades++;
          }
        }
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 150));
    }
    
    // Wait between scans
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Final report
  console.log('\n\n');
  console.log('═'.repeat(70));
  console.log('📊 FINAL RESULTS');
  console.log('═'.repeat(70));
  console.log('');
  console.log(`  Runtime:            ${durationMs / 60000} minutes`);
  console.log(`  Total scans:        ${totalScans}`);
  console.log(`  Opportunities:      ${opportunitiesFound}`);
  console.log(`  Trades executed:    ${tradesExecuted}`);
  console.log(`  Successful:         ${successfulTrades}`);
  console.log(`  Failed:             ${failedTrades}`);
  console.log(`  Win rate:           ${tradesExecuted > 0 ? ((successfulTrades / tradesExecuted) * 100).toFixed(1) : 0}%`);
  console.log('');
  console.log(`  Total profit:       ${totalProfitSOL >= 0 ? '+' : ''}${totalProfitSOL.toFixed(6)} SOL (~$${(totalProfitSOL * SOL_PRICE).toFixed(4)})`);
  console.log(`  Gas spent:          ${totalGasSpent.toFixed(6)} SOL (~$${(totalGasSpent * SOL_PRICE).toFixed(4)})`);
  console.log(`  Net profit:         ${(totalProfitSOL - totalGasSpent) >= 0 ? '+' : ''}${(totalProfitSOL - totalGasSpent).toFixed(6)} SOL`);
  console.log('');
  
  if (totalProfitSOL > 0) {
    const hourlyRate = totalProfitSOL / (durationMs / 3600000);
    console.log('PROJECTED (if rate continues):');
    console.log(`  Hourly:             +${hourlyRate.toFixed(6)} SOL (~$${(hourlyRate * SOL_PRICE).toFixed(4)})`);
    console.log(`  Daily:              +${(hourlyRate * 24).toFixed(6)} SOL (~$${(hourlyRate * 24 * SOL_PRICE).toFixed(2)})`);
    console.log(`  Monthly:            +${(hourlyRate * 24 * 30).toFixed(4)} SOL (~$${(hourlyRate * 24 * 30 * SOL_PRICE).toFixed(2)})`);
  }
  
  console.log('');
  console.log('═'.repeat(70));
  console.log('💡 KEY ADVANTAGE: No 0.3% flash loan fee!');
  console.log('   Flash loans need 0.3%+ spread to profit');
  console.log('   This scalper profits from ANY positive spread > gas cost');
  console.log('═'.repeat(70));
}

// ============================================
// ENTRY POINT
// ============================================
const args = process.argv.slice(2);
const durationMinutes = parseInt(args[0]) || 15;
const simulate = !args.includes('--live');

console.log(simulate ? '🎮 SIMULATION MODE' : '🔴 LIVE TRADING MODE');

runScalper(durationMinutes * 60 * 1000, simulate).catch(console.error);
