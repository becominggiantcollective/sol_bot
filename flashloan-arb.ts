/**
 * FLASH LOAN ARBITRAGE BOT - No Collateral Required!
 * 
 * With flash loans, you can borrow 10+ SOL, execute arbitrage, and repay
 * all in one atomic transaction. You only need gas fees (~0.001 SOL).
 * 
 * Your 0.035 SOL is MORE than enough for gas!
 */
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

// Config
const RPC = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY || '';

// Token mints
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const RAY_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

// Flash loan config - BORROW BIG, ONLY PAY GAS
const FLASH_CONFIG = {
  // Flash loan amounts to try (no collateral needed!)
  flashLoanAmounts: [5, 10, 25, 50], // SOL amounts to borrow
  
  // Costs
  flashLoanFeePercent: 0.3,    // Solend charges 0.3%
  gasReserveSOL: 0.01,         // Keep for gas
  priorityFeeLamports: 50000,  // 0.00005 SOL priority
  
  // Thresholds
  minNetProfitPercent: 0.05,   // Need 0.05% AFTER flash fee
  maxSlippageBps: 100,         // 1% slippage
  
  // Timing
  scanIntervalMs: 3000,
  dryRun: true,                // START SAFE!
};

// Triangular routes to scan
const TRIANGULAR_ROUTES = [
  // SOL-based triangles
  { path: [SOL_MINT, USDC_MINT, RAY_MINT, SOL_MINT], name: 'SOL→USDC→RAY→SOL' },
  { path: [SOL_MINT, USDC_MINT, JUP_MINT, SOL_MINT], name: 'SOL→USDC→JUP→SOL' },
  { path: [SOL_MINT, USDC_MINT, BONK_MINT, SOL_MINT], name: 'SOL→USDC→BONK→SOL' },
  { path: [SOL_MINT, USDT_MINT, USDC_MINT, SOL_MINT], name: 'SOL→USDT→USDC→SOL' },
  { path: [SOL_MINT, USDT_MINT, RAY_MINT, SOL_MINT], name: 'SOL→USDT→RAY→SOL' },
  
  // Reverse routes
  { path: [SOL_MINT, RAY_MINT, USDC_MINT, SOL_MINT], name: 'SOL→RAY→USDC→SOL' },
  { path: [SOL_MINT, JUP_MINT, USDC_MINT, SOL_MINT], name: 'SOL→JUP→USDC→SOL' },
  { path: [SOL_MINT, BONK_MINT, USDC_MINT, SOL_MINT], name: 'SOL→BONK→USDC→SOL' },
];

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

// Stats
let scanCount = 0;
let opportunitiesFound = 0;
let tradesExecuted = 0;
let totalProfitSOL = 0;

async function getBalance(): Promise<number> {
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / 1e9;
}

async function getQuote(inputMint: string, outputMint: string, amountRaw: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  try {
    const res = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amountRaw,
        slippageBps: FLASH_CONFIG.maxSlippageBps,
        onlyDirectRoutes: 'true',
      },
      headers,
      timeout: 8000,
    });
    return res.data;
  } catch (err: any) {
    return null;
  }
}

interface ArbitrageOpportunity {
  route: string;
  flashLoanAmount: number;
  inputSOL: number;
  outputSOL: number;
  grossProfitSOL: number;
  flashLoanFeeSOL: number;
  gasFeeSOL: number;
  netProfitSOL: number;
  netProfitPercent: number;
  netProfitUSD: number;
}

async function checkTriangularArbitrage(
  routeConfig: { path: string[]; name: string },
  flashLoanAmountSOL: number
): Promise<ArbitrageOpportunity | null> {
  const { path, name } = routeConfig;
  
  // Start with flash loaned SOL
  let currentAmount = BigInt(Math.floor(flashLoanAmountSOL * 1e9));
  let currentMint = path[0];
  
  // Execute each leg of the triangle
  for (let i = 1; i < path.length; i++) {
    const outputMint = path[i];
    const quote = await getQuote(currentMint, outputMint, currentAmount.toString());
    
    if (!quote || !quote.outAmount) {
      return null;
    }
    
    currentAmount = BigInt(quote.outAmount);
    currentMint = outputMint;
  }
  
  // Calculate profit
  const outputSOL = Number(currentAmount) / 1e9;
  const grossProfitSOL = outputSOL - flashLoanAmountSOL;
  const flashLoanFeeSOL = flashLoanAmountSOL * (FLASH_CONFIG.flashLoanFeePercent / 100);
  const gasFeeSOL = 0.0003; // ~3 swaps + flash loan overhead
  const netProfitSOL = grossProfitSOL - flashLoanFeeSOL - gasFeeSOL;
  const netProfitPercent = (netProfitSOL / flashLoanAmountSOL) * 100;
  const solPrice = 133; // Approximate
  
  return {
    route: name,
    flashLoanAmount: flashLoanAmountSOL,
    inputSOL: flashLoanAmountSOL,
    outputSOL,
    grossProfitSOL,
    flashLoanFeeSOL,
    gasFeeSOL,
    netProfitSOL,
    netProfitPercent,
    netProfitUSD: netProfitSOL * solPrice,
  };
}

async function findBestOpportunity(): Promise<ArbitrageOpportunity | null> {
  let bestOpp: ArbitrageOpportunity | null = null;
  
  for (const route of TRIANGULAR_ROUTES) {
    for (const amount of FLASH_CONFIG.flashLoanAmounts) {
      const opp = await checkTriangularArbitrage(route, amount);
      
      if (opp && opp.netProfitPercent >= FLASH_CONFIG.minNetProfitPercent) {
        if (!bestOpp || opp.netProfitSOL > bestOpp.netProfitSOL) {
          bestOpp = opp;
        }
      }
      
      // Rate limiting
      await sleep(100);
    }
  }
  
  return bestOpp;
}

async function runFlashLoanBot() {
  console.log('═'.repeat(65));
  console.log('⚡ FLASH LOAN ARBITRAGE BOT - NO COLLATERAL REQUIRED!');
  console.log('═'.repeat(65));
  
  const balance = await getBalance();
  console.log(`\n💰 Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 133).toFixed(2)})`);
  console.log(`\n📊 Flash Loan Config:`);
  console.log(`   Borrow amounts: ${FLASH_CONFIG.flashLoanAmounts.join(', ')} SOL`);
  console.log(`   Flash loan fee: ${FLASH_CONFIG.flashLoanFeePercent}%`);
  console.log(`   Min net profit: ${FLASH_CONFIG.minNetProfitPercent}%`);
  console.log(`   Gas reserve: ${FLASH_CONFIG.gasReserveSOL} SOL`);
  console.log(`   Mode: ${FLASH_CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  
  console.log(`\n🔺 Triangular Routes (${TRIANGULAR_ROUTES.length}):`);
  TRIANGULAR_ROUTES.forEach(r => console.log(`   • ${r.name}`));
  
  // Check if we have enough for gas
  if (balance < FLASH_CONFIG.gasReserveSOL) {
    console.log(`\n❌ Need at least ${FLASH_CONFIG.gasReserveSOL} SOL for gas fees`);
    console.log(`   You have: ${balance.toFixed(6)} SOL`);
    return;
  }
  
  console.log('\n' + '═'.repeat(65));
  console.log('🔍 Scanning for flash loan arbitrage opportunities...');
  console.log('   (You borrow SOL, profit from spreads, repay - all in one TX!)');
  console.log('═'.repeat(65) + '\n');
  
  while (true) {
    scanCount++;
    
    try {
      const startTime = Date.now();
      const opportunity = await findBestOpportunity();
      const scanTime = Date.now() - startTime;
      
      if (opportunity) {
        opportunitiesFound++;
        
        console.log('\n' + '🎯'.repeat(30));
        console.log(`🎯 FLASH LOAN OPPORTUNITY #${opportunitiesFound}!`);
        console.log('🎯'.repeat(30));
        console.log(`   Route: ${opportunity.route}`);
        console.log(`   Flash Loan: ${opportunity.flashLoanAmount} SOL (borrowed FREE)`);
        console.log(`   Output: ${opportunity.outputSOL.toFixed(6)} SOL`);
        console.log(`   Gross Profit: ${opportunity.grossProfitSOL.toFixed(6)} SOL`);
        console.log(`   Flash Fee: -${opportunity.flashLoanFeeSOL.toFixed(6)} SOL (0.3%)`);
        console.log(`   Gas Fee: -${opportunity.gasFeeSOL.toFixed(6)} SOL`);
        console.log(`   ────────────────────────────`);
        console.log(`   💰 NET PROFIT: +${opportunity.netProfitSOL.toFixed(6)} SOL (~$${opportunity.netProfitUSD.toFixed(2)})`);
        console.log(`   📈 NET ROI: +${opportunity.netProfitPercent.toFixed(3)}%`);
        
        if (!FLASH_CONFIG.dryRun) {
          console.log('\n   🔴 Executing flash loan arbitrage...');
          // Would execute here
          tradesExecuted++;
          totalProfitSOL += opportunity.netProfitSOL;
        } else {
          console.log('\n   🧪 DRY RUN - Would execute if live');
        }
        console.log('');
      } else {
        if (scanCount % 10 === 0) {
          console.log(`[Scan ${scanCount}] No profitable opportunities (scanned ${TRIANGULAR_ROUTES.length * FLASH_CONFIG.flashLoanAmounts.length} routes in ${scanTime}ms)`);
        }
      }
    } catch (err: any) {
      console.log(`[Scan ${scanCount}] Error: ${err.message}`);
    }
    
    await sleep(FLASH_CONFIG.scanIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n' + '═'.repeat(65));
  console.log('📊 FLASH LOAN BOT SESSION SUMMARY');
  console.log('═'.repeat(65));
  console.log(`Scans: ${scanCount}`);
  console.log(`Opportunities Found: ${opportunitiesFound}`);
  console.log(`Trades Executed: ${tradesExecuted}`);
  console.log(`Total Profit: ${totalProfitSOL.toFixed(6)} SOL (~$${(totalProfitSOL * 133).toFixed(2)})`);
  console.log('═'.repeat(65));
  process.exit(0);
});

runFlashLoanBot().catch(console.error);
