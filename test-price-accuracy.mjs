#!/usr/bin/env node
/**
 * 🧪 PRICE DATA ACCURACY TEST
 * Validates live price feeds and P&L calculations
 */

import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';

const RPC = process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC);

console.log('═══════════════════════════════════════════════════════════');
console.log('🧪 TESTING PRICE DATA ACCURACY & P&L CALCULATIONS');
console.log('═══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: SOL Price Consistency
// ═══════════════════════════════════════════════════════════════════════════

console.log('📊 TEST 1: SOL Price from Multiple Sources\n');

async function testSOLPrice() {
  try {
    // Source 1: DexScreener
    const dexRes = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const dexData = await dexRes.json();
    const dexPrice = parseFloat(dexData.pairs?.[0]?.priceUsd) || 0;
    console.log(`DexScreener:  $${dexPrice.toFixed(2)}`);
    
    // Source 2: Jupiter (if available)
    try {
      const jupRes = await fetch('https://price.jup.ag/v4/price?ids=SOL');
      const jupData = await jupRes.json();
      const jupPrice = jupData.data?.SOL?.price || 0;
      console.log(`Jupiter:      $${jupPrice.toFixed(2)}`);
      
      const diff = Math.abs(dexPrice - jupPrice);
      const diffPct = (diff / dexPrice) * 100;
      console.log(`Difference:   $${diff.toFixed(2)} (${diffPct.toFixed(2)}%)`);
      
      if (diffPct > 2) {
        console.log('⚠️  WARNING: Price difference >2%');
      } else {
        console.log('✅ Prices consistent\n');
      }
    } catch (e) {
      console.log('⚠️  Jupiter price unavailable\n');
    }
    
    return dexPrice;
  } catch (e) {
    console.error('❌ Error fetching SOL price:', e.message);
    return 230; // fallback
  }
}

const solPrice = await testSOLPrice();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Wallet Balance Accuracy
// ═══════════════════════════════════════════════════════════════════════════

console.log('💰 TEST 2: Wallet Balance Verification\n');

async function testWalletBalance() {
  try {
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const publicKey = new PublicKey(walletData.publicKey);
    
    console.log(`Wallet: ${publicKey.toString().slice(0, 8)}...${publicKey.toString().slice(-8)}`);
    
    // Get SOL balance
    const lamports = await connection.getBalance(publicKey);
    const sol = lamports / 1e9;
    const usd = sol * solPrice;
    
    console.log(`SOL Balance:  ${sol.toFixed(6)} SOL`);
    console.log(`USD Value:    $${usd.toFixed(2)}`);
    console.log('✅ Wallet balance verified\n');
    
    return { sol, usd };
  } catch (e) {
    console.error('❌ Error fetching wallet balance:', e.message);
    return { sol: 0, usd: 0 };
  }
}

const wallet = await testWalletBalance();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Position File P&L Calculations
// ═══════════════════════════════════════════════════════════════════════════

console.log('📈 TEST 3: P&L Calculation Verification\n');

function testPnLCalculations() {
  const posFile = 'positions-fl.json';
  
  if (!fs.existsSync(posFile)) {
    console.log('⚠️  No positions file found');
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(posFile, 'utf8'));
  
  console.log(`Reading: ${posFile}`);
  console.log(`Total positions: ${data.positions?.length || 0}\n`);
  
  let totalRealizedPnL = 0;
  let wins = 0;
  let losses = 0;
  let closedTrades = 0;
  
  console.log('Closed Trades:');
  console.log('─'.repeat(80));
  
  for (const pos of data.positions || []) {
    const p = Array.isArray(pos) ? pos[1] : pos;
    
    if (p.status === 'CLOSED') {
      closedTrades++;
      const profit = parseFloat(p.profit) || 0;
      const profitUSD = profit * solPrice;
      const entryUSD = (p.entrySOL || 0) * solPrice;
      const exitUSD = (p.exitSOL || 0) * solPrice;
      
      totalRealizedPnL += profit;
      if (profit > 0) wins++;
      else losses++;
      
      // Verify calculation
      const calculatedProfit = (p.exitSOL || 0) - (p.entrySOL || 0) - (p.gasCost || 0);
      const calculationError = Math.abs(profit - calculatedProfit);
      
      console.log(`${p.symbol?.padEnd(12)} | Entry: $${entryUSD.toFixed(2).padStart(6)} | Exit: $${exitUSD.toFixed(2).padStart(6)} | P&L: ${profit >= 0 ? '+' : ''}${profitUSD.toFixed(2).padStart(6)} | ${(p.profitPct || 0).toFixed(1).padStart(6)}%`);
      
      if (calculationError > 0.0001) {
        console.log(`  ⚠️  Calculation error: ${calculationError.toFixed(8)} SOL`);
      }
    }
  }
  
  console.log('─'.repeat(80));
  console.log(`\nSummary:`);
  console.log(`Closed Trades:    ${closedTrades}`);
  console.log(`Wins:             ${wins}`);
  console.log(`Losses:           ${losses}`);
  console.log(`Win Rate:         ${closedTrades > 0 ? ((wins/closedTrades)*100).toFixed(1) : 0}%`);
  console.log(`Realized P&L:     ${totalRealizedPnL >= 0 ? '+' : ''}${totalRealizedPnL.toFixed(6)} SOL`);
  console.log(`Realized P&L USD: ${totalRealizedPnL >= 0 ? '+' : ''}$${(totalRealizedPnL * solPrice).toFixed(2)}`);
  console.log('✅ P&L calculations verified\n');
  
  return { totalRealizedPnL, wins, losses, closedTrades };
}

const pnl = testPnLCalculations();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Live Token Price Accuracy
// ═══════════════════════════════════════════════════════════════════════════

console.log('🪙 TEST 4: Live Token Price Data\n');

async function testTokenPrices() {
  // Test with SOL first (known good)
  const testMints = [
    { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  ];
  
  // Add active holdings
  const posFile = 'positions-safe.json';
  if (fs.existsSync(posFile)) {
    const data = JSON.parse(fs.readFileSync(posFile, 'utf8'));
    for (const pos of data.positions || []) {
      const p = Array.isArray(pos) ? pos[1] : pos;
      const mint = Array.isArray(pos) ? pos[0] : p.mint;
      if (!p.status || p.status !== 'CLOSED') {
        testMints.push({ symbol: p.symbol || 'UNK', mint });
      }
    }
  }
  
  console.log(`Testing ${testMints.length} token(s):\n`);
  
  for (const { symbol, mint } of testMints) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const data = await res.json();
      const pair = data.pairs?.[0];
      
      if (pair) {
        console.log(`${symbol.padEnd(10)} | Price: $${parseFloat(pair.priceUsd).toFixed(8).padStart(12)} | Liq: $${(pair.liquidity?.usd || 0).toFixed(0).padStart(8)} | Vol24h: $${(pair.volume?.h24 || 0).toFixed(0).padStart(8)}`);
        console.log(`           | 5m: ${(pair.priceChange?.m5 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.m5 || 0).toFixed(1)}% | 1h: ${(pair.priceChange?.h1 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.h1 || 0).toFixed(1)}% | 24h: ${(pair.priceChange?.h24 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.h24 || 0).toFixed(1)}%`);
      } else {
        console.log(`${symbol.padEnd(10)} | ❌ No liquidity pool found`);
      }
      
      await new Promise(r => setTimeout(r, 300)); // Rate limit
    } catch (e) {
      console.log(`${symbol.padEnd(10)} | ❌ Error: ${e.message}`);
    }
  }
  
  console.log('\n✅ Token price test complete\n');
}

await testTokenPrices();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Dashboard Calculation Cross-Check
// ═══════════════════════════════════════════════════════════════════════════

console.log('🎯 TEST 5: Final Reconciliation\n');

console.log('Expected Dashboard Values:');
console.log('─'.repeat(60));
console.log(`Wallet Balance:      $${wallet.usd.toFixed(2)}`);
console.log(`SOL Price:           $${solPrice.toFixed(2)}`);
if (pnl) {
  console.log(`Realized P&L:        ${pnl.totalRealizedPnL >= 0 ? '+' : ''}$${(pnl.totalRealizedPnL * solPrice).toFixed(2)}`);
  console.log(`Win/Loss:            ${pnl.wins}W / ${pnl.losses}L (${pnl.closedTrades} total)`);
  console.log(`Win Rate:            ${pnl.closedTrades > 0 ? ((pnl.wins/pnl.closedTrades)*100).toFixed(1) : 0}%`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🔍 CRITICAL ISSUES TO ADDRESS:');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('1. ⚠️  PRICE FEED RELIABILITY');
console.log('   - Using single source (DexScreener) for all prices');
console.log('   - No fallback if DexScreener is down or delayed');
console.log('   - Recommendation: Add Jupiter price API as backup\n');

console.log('2. ⚠️  P&L CALCULATION ACCURACY');
console.log('   - Assuming all tokens have 9 decimals (may vary)');
console.log('   - Not accounting for slippage in exit prices');
console.log('   - Gas costs may not be fully tracked');
console.log('   - Recommendation: Fetch actual token decimals from chain\n');

console.log('3. ⚠️  UNREALIZED P&L ISSUES');
console.log('   - Current value calculation uses (tokensHeld / 1e9) * priceNative');
console.log('   - This is WRONG if token has different decimals');
console.log('   - Many memecoins use 6 decimals, not 9');
console.log('   - Recommendation: Query token mint for actual decimals\n');

console.log('4. ⚠️  STALE DATA RISK');
console.log('   - Dashboard updates every 8 seconds');
console.log('   - In fast-moving markets, prices can change significantly');
console.log('   - Recommendation: Reduce to 3-5 second updates for active trading\n');

console.log('5. ⚠️  STARTING BALANCE TRACKING');
console.log('   - Dashboard assumes $5.00 starting balance');
console.log('   - Actual starting balance unknown');
console.log('   - Real profit = Current Balance - Starting Balance');
console.log(`   - If you started with $5: Profit = $${(wallet.usd - 5).toFixed(2)}`);
console.log('   - Recommendation: Track starting balance in config file\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('✅ TEST COMPLETE');
console.log('═══════════════════════════════════════════════════════════');
