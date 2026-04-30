#!/usr/bin/env node
/**
 * ⚡ FLASH LOAN ARBITRAGE BOT
 * 
 * Scans for triangular arbitrage opportunities using borrowed capital.
 * You only pay gas (~0.001 SOL), the borrowed amount is returned atomically.
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';
import bs58 from 'bs58';

// === CONFIG ===
const RPC = process.env.HELIUS_RPC_URL;
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY;

// Token mints
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const RAY_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WIF_MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const POPCAT_MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

// Flash loan config
const CONFIG = {
  flashLoanAmounts: [5, 10, 25, 50, 100], // SOL to borrow
  flashLoanFeePercent: 0.3,  // Solend 0.3%
  minNetProfitPercent: 0.05, // Min profit after fees
  maxSlippageBps: 100,       // 1%
  scanIntervalMs: 5000,
  solPrice: 230,
};

// Triangular routes
const TRIANGULAR_ROUTES = [
  { path: [SOL_MINT, USDC_MINT, RAY_MINT, SOL_MINT], name: 'SOL→USDC→RAY→SOL' },
  { path: [SOL_MINT, USDC_MINT, JUP_MINT, SOL_MINT], name: 'SOL→USDC→JUP→SOL' },
  { path: [SOL_MINT, USDC_MINT, BONK_MINT, SOL_MINT], name: 'SOL→USDC→BONK→SOL' },
  { path: [SOL_MINT, USDC_MINT, WIF_MINT, SOL_MINT], name: 'SOL→USDC→WIF→SOL' },
  { path: [SOL_MINT, USDC_MINT, POPCAT_MINT, SOL_MINT], name: 'SOL→USDC→POPCAT→SOL' },
  { path: [SOL_MINT, USDT_MINT, USDC_MINT, SOL_MINT], name: 'SOL→USDT→USDC→SOL' },
  { path: [SOL_MINT, USDT_MINT, RAY_MINT, SOL_MINT], name: 'SOL→USDT→RAY→SOL' },
  // Reverse routes
  { path: [SOL_MINT, RAY_MINT, USDC_MINT, SOL_MINT], name: 'SOL→RAY→USDC→SOL' },
  { path: [SOL_MINT, JUP_MINT, USDC_MINT, SOL_MINT], name: 'SOL→JUP→USDC→SOL' },
  { path: [SOL_MINT, BONK_MINT, USDC_MINT, SOL_MINT], name: 'SOL→BONK→USDC→SOL' },
  { path: [SOL_MINT, WIF_MINT, USDC_MINT, SOL_MINT], name: 'SOL→WIF→USDC→SOL' },
];

const connection = new Connection(RPC, 'confirmed');

// Wallet
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

// Stats
let scanCount = 0;
let opportunitiesFound = 0;

async function getQuote(inputMint, outputMint, amount) {
  try {
    const res = await fetch(
      `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${CONFIG.maxSlippageBps}`,
      { headers: { 'x-api-key': JUPITER_KEY } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function checkTriangular(route, flashLoanSOL) {
  const { path, name } = route;
  
  let currentAmount = BigInt(Math.floor(flashLoanSOL * 1e9));
  let currentMint = path[0];
  
  for (let i = 1; i < path.length; i++) {
    const outputMint = path[i];
    const quote = await getQuote(currentMint, outputMint, currentAmount.toString());
    if (!quote?.outAmount) return null;
    
    currentAmount = BigInt(quote.outAmount);
    currentMint = outputMint;
    await new Promise(r => setTimeout(r, 100));
  }
  
  const outputSOL = Number(currentAmount) / 1e9;
  const grossProfit = outputSOL - flashLoanSOL;
  const flashFee = flashLoanSOL * (CONFIG.flashLoanFeePercent / 100);
  const gasFee = 0.0005;
  const netProfit = grossProfit - flashFee - gasFee;
  const netProfitPct = (netProfit / flashLoanSOL) * 100;
  
  return {
    route: name,
    flashLoanSOL,
    outputSOL,
    grossProfit,
    flashFee,
    gasFee,
    netProfit,
    netProfitPct,
    netProfitUSD: netProfit * CONFIG.solPrice,
  };
}

async function scan() {
  scanCount++;
  let bestOpp = null;
  
  for (const route of TRIANGULAR_ROUTES) {
    for (const amount of CONFIG.flashLoanAmounts) {
      const opp = await checkTriangular(route, amount);
      
      if (opp) {
        const profitable = opp.netProfitPct >= CONFIG.minNetProfitPercent;
        const icon = profitable ? '✅' : '❌';
        
        // Only log interesting opportunities
        if (opp.netProfitPct > -0.5) {
          console.log(`   ${route.name} @${amount}SOL: ${opp.netProfitPct >= 0 ? '+' : ''}${opp.netProfitPct.toFixed(3)}% ${icon}`);
        }
        
        if (profitable && (!bestOpp || opp.netProfit > bestOpp.netProfit)) {
          bestOpp = opp;
        }
      }
    }
  }
  
  return bestOpp;
}

async function main() {
  console.log('═'.repeat(65));
  console.log('⚡ FLASH LOAN TRIANGULAR ARBITRAGE SCANNER');
  console.log('═'.repeat(65));
  
  const balance = await connection.getBalance(wallet.publicKey);
  const solBalance = balance / 1e9;
  
  console.log(`\n💰 Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${solBalance.toFixed(6)} SOL (~$${(solBalance * CONFIG.solPrice).toFixed(2)})`);
  console.log(`\n📊 Config:`);
  console.log(`   Flash loan amounts: ${CONFIG.flashLoanAmounts.join(', ')} SOL`);
  console.log(`   Flash loan fee: ${CONFIG.flashLoanFeePercent}%`);
  console.log(`   Min profit: ${CONFIG.minNetProfitPercent}%`);
  console.log(`   Routes: ${TRIANGULAR_ROUTES.length}`);
  console.log(`\n⚠️  This is SCAN ONLY mode - no trades executed`);
  console.log('═'.repeat(65));
  console.log('\nScanning for opportunities...\n');
  
  while (true) {
    console.log(`\n[Scan #${scanCount + 1}] ${new Date().toLocaleTimeString()}`);
    
    const opportunity = await scan();
    
    if (opportunity) {
      opportunitiesFound++;
      console.log(`\n🎯 PROFITABLE OPPORTUNITY FOUND!`);
      console.log(`   Route: ${opportunity.route}`);
      console.log(`   Borrow: ${opportunity.flashLoanSOL} SOL`);
      console.log(`   Output: ${opportunity.outputSOL.toFixed(6)} SOL`);
      console.log(`   Gross: ${opportunity.grossProfit >= 0 ? '+' : ''}${opportunity.grossProfit.toFixed(6)} SOL`);
      console.log(`   Flash fee: -${opportunity.flashFee.toFixed(6)} SOL`);
      console.log(`   Gas: -${opportunity.gasFee.toFixed(6)} SOL`);
      console.log(`   NET: ${opportunity.netProfit >= 0 ? '+' : ''}${opportunity.netProfit.toFixed(6)} SOL (~$${opportunity.netProfitUSD.toFixed(2)})`);
      console.log(`   ROI: ${opportunity.netProfitPct.toFixed(3)}%`);
    }
    
    console.log(`\n📈 Stats: ${scanCount} scans | ${opportunitiesFound} opportunities found`);
    
    await new Promise(r => setTimeout(r, CONFIG.scanIntervalMs));
  }
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopped');
  console.log(`📊 Final: ${scanCount} scans | ${opportunitiesFound} opportunities`);
  process.exit(0);
});

main().catch(console.error);
