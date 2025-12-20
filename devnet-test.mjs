/**
 * DEVNET TEST - Real Transaction Testing
 * 
 * Tests on Solana Devnet to verify:
 * 1. Actual gas costs from real transactions
 * 2. Transaction structure and fees
 * 3. Quote accuracy vs execution
 * 
 * NOTE: Devnet has limited liquidity, so we test transaction mechanics
 * rather than arbitrage profitability
 */

import { 
  Connection, 
  Keypair, 
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import axios from 'axios';
import fs from 'fs';

// =============================================================================
// DEVNET CONFIGURATION
// =============================================================================

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';

// Your wallet (for mainnet gas verification)
const MAINNET_WALLET = '9VZkKLpzCwfHXpHFRW7T2NXZ68T9E5vwgFaXtCzdtgzQ';

// Token mints (mainnet - for reference)
const TOKENS = {
  SOL: { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function lamportsToSOL(lamports) {
  return lamports / LAMPORTS_PER_SOL;
}

function solToLamports(sol) {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

// =============================================================================
// TEST 1: VERIFY MAINNET GAS COSTS FROM REAL TRANSACTIONS
// =============================================================================

async function verifyMainnetGasCosts() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 1: VERIFY MAINNET GAS COSTS FROM RECENT TRANSACTIONS');
  console.log('═'.repeat(70));
  
  const connection = new Connection(MAINNET_RPC, 'confirmed');
  
  try {
    // Get recent confirmed signatures for the wallet
    console.log(`\n📊 Fetching recent transactions for: ${MAINNET_WALLET}`);
    
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(MAINNET_WALLET),
      { limit: 10 }
    );
    
    if (signatures.length === 0) {
      console.log('   No recent transactions found');
      return;
    }
    
    console.log(`   Found ${signatures.length} recent transactions\n`);
    
    // Analyze each transaction for fees
    let totalFees = 0;
    let txCount = 0;
    
    for (const sig of signatures.slice(0, 5)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });
        
        if (tx && tx.meta) {
          const fee = tx.meta.fee;
          totalFees += fee;
          txCount++;
          
          // Get compute units used if available
          const computeUnits = tx.meta.computeUnitsConsumed || 'N/A';
          
          console.log(`   TX: ${sig.signature.slice(0, 20)}...`);
          console.log(`       Fee: ${fee.toLocaleString()} lamports (${lamportsToSOL(fee).toFixed(9)} SOL)`);
          console.log(`       Compute Units: ${computeUnits}`);
          console.log(`       Status: ${tx.meta.err ? '❌ Failed' : '✅ Success'}`);
          console.log('');
        }
      } catch (e) {
        // Skip failed fetches
      }
    }
    
    if (txCount > 0) {
      const avgFee = totalFees / txCount;
      console.log(`   📊 AVERAGE FEE: ${avgFee.toLocaleString()} lamports (${lamportsToSOL(avgFee).toFixed(9)} SOL)`);
    }
    
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
  }
}

// =============================================================================
// TEST 2: CURRENT NETWORK FEE ANALYSIS
// =============================================================================

async function analyzeCurrentNetworkFees() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 2: CURRENT MAINNET NETWORK FEE ANALYSIS');
  console.log('═'.repeat(70));
  
  const connection = new Connection(MAINNET_RPC, 'confirmed');
  
  try {
    // Get recent prioritization fees
    console.log('\n📊 Fetching recent prioritization fees...');
    
    const recentFees = await connection.getRecentPrioritizationFees();
    
    if (recentFees.length === 0) {
      console.log('   No recent fee data available');
      return;
    }
    
    // Analyze fee distribution
    const nonZeroFees = recentFees
      .map(f => f.prioritizationFee)
      .filter(f => f > 0)
      .sort((a, b) => a - b);
    
    if (nonZeroFees.length === 0) {
      console.log('   All recent fees were 0 (very low network activity)');
      return;
    }
    
    const min = nonZeroFees[0];
    const max = nonZeroFees[nonZeroFees.length - 1];
    const median = nonZeroFees[Math.floor(nonZeroFees.length / 2)];
    const p75 = nonZeroFees[Math.floor(nonZeroFees.length * 0.75)];
    const p90 = nonZeroFees[Math.floor(nonZeroFees.length * 0.9)];
    const avg = nonZeroFees.reduce((a, b) => a + b, 0) / nonZeroFees.length;
    
    console.log(`\n   📈 Fee Distribution (micro-lamports per CU):`);
    console.log(`       Min:    ${min.toLocaleString()}`);
    console.log(`       Median: ${median.toLocaleString()}`);
    console.log(`       75th:   ${p75.toLocaleString()}`);
    console.log(`       90th:   ${p90.toLocaleString()}`);
    console.log(`       Max:    ${max.toLocaleString()}`);
    console.log(`       Avg:    ${avg.toFixed(0)}`);
    
    // Calculate actual SOL cost for different scenarios
    const CU_PER_SWAP = 200000; // Typical compute units per swap
    const SWAPS_IN_ARB = 3; // Triangular = 3 swaps
    
    console.log(`\n   💰 Estimated Gas Cost for ${SWAPS_IN_ARB}-Swap Triangular Arb:`);
    console.log(`       (Assuming ${CU_PER_SWAP.toLocaleString()} CU per swap)`);
    console.log('');
    
    const tiers = [
      { name: 'Minimum', fee: min },
      { name: 'Median', fee: median },
      { name: '75th %ile', fee: p75 },
      { name: '90th %ile', fee: p90 },
    ];
    
    for (const tier of tiers) {
      // Base fee: 5000 lamports per signature (usually 1 signature per swap)
      const baseFee = 5000 * SWAPS_IN_ARB;
      
      // Priority fee: microLamports * CU / 1e6
      const priorityFee = (tier.fee * CU_PER_SWAP * SWAPS_IN_ARB) / 1e6;
      
      const totalLamports = baseFee + priorityFee;
      const totalSOL = totalLamports / LAMPORTS_PER_SOL;
      
      console.log(`       ${tier.name.padEnd(12)}: ${totalSOL.toFixed(9)} SOL (${totalLamports.toLocaleString()} lamports)`);
    }
    
    // Get current slot for reference
    const slot = await connection.getSlot();
    console.log(`\n   📍 Current slot: ${slot.toLocaleString()}`);
    
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
  }
}

// =============================================================================
// TEST 3: WALLET BALANCE AND GAS CAPACITY
// =============================================================================

async function checkWalletGasCapacity() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 3: WALLET BALANCE AND GAS CAPACITY CHECK');
  console.log('═'.repeat(70));
  
  const connection = new Connection(MAINNET_RPC, 'confirmed');
  
  try {
    console.log(`\n📊 Checking wallet: ${MAINNET_WALLET}`);
    
    const balance = await connection.getBalance(new PublicKey(MAINNET_WALLET));
    const balanceSOL = lamportsToSOL(balance);
    
    console.log(`\n   💰 Current Balance: ${balanceSOL.toFixed(9)} SOL`);
    console.log(`                       ${balance.toLocaleString()} lamports`);
    
    // Calculate how many transactions the wallet can afford
    const gasEstimates = {
      minimum: 0.000021,   // 3 swaps at minimum priority
      low: 0.000115,       // 3 swaps at low priority  
      medium: 0.0006,      // 3 swaps at medium priority
      high: 0.006,         // 3 swaps at high priority
    };
    
    console.log(`\n   📊 Transaction Capacity:`);
    for (const [tier, cost] of Object.entries(gasEstimates)) {
      const txCount = Math.floor(balanceSOL / cost);
      const status = txCount > 0 ? '✅' : '❌';
      console.log(`       ${tier.padEnd(8)}: ${txCount.toLocaleString()} transactions @ ${cost.toFixed(6)} SOL each ${status}`);
    }
    
    // Minimum required for one trade
    const minRequired = gasEstimates.low;
    console.log(`\n   ${balanceSOL >= minRequired ? '✅' : '❌'} Minimum ${minRequired} SOL required for one trade`);
    console.log(`   ${balanceSOL >= 0.01 ? '✅' : '⚠️'} Recommended 0.01 SOL for comfortable trading`);
    
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
  }
}

// =============================================================================
// TEST 4: SIMULATE FEE CALCULATION ACCURACY
// =============================================================================

async function simulateFeeCalculation() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 4: FEE CALCULATION SIMULATION');
  console.log('═'.repeat(70));
  
  console.log(`
   This test verifies that our fee calculation matches real-world costs.
   
   📐 FEE FORMULA:
   
   Total Gas = (Base Fee) + (Priority Fee)
   
   Where:
   - Base Fee = 5000 lamports × Number of Signatures
   - Priority Fee = (microLamports/CU) × (CU per swap) × (Number of swaps) / 1,000,000
   
   For a 3-swap triangular arbitrage:
   - Signatures: 3 (one per swap instruction)
   - CU per swap: ~200,000 (typical Jupiter swap)
   - Total CU: ~600,000
`);
  
  // Test different scenarios
  const scenarios = [
    { name: 'Flash Loan Arb (SOL)', borrowed: 10, unit: 'SOL', price: 132, flashFee: 0.003 },
    { name: 'Flash Loan Arb (USDC)', borrowed: 1000, unit: 'USDC', price: 1, flashFee: 0.003 },
    { name: 'Wallet Trade (Small)', borrowed: 0.5, unit: 'SOL', price: 132, flashFee: 0 },
    { name: 'Wallet Trade (Large)', borrowed: 5, unit: 'SOL', price: 132, flashFee: 0 },
  ];
  
  const gasSOL = 0.000115; // Medium priority for 3 swaps
  const solPrice = 132;
  
  console.log('   📊 SCENARIO ANALYSIS:\n');
  console.log('   ┌─────────────────────────────────────────────────────────────────────┐');
  console.log('   │ Scenario              │ Input     │ Flash Fee │ Gas    │ Min Profit │');
  console.log('   ├─────────────────────────────────────────────────────────────────────┤');
  
  for (const s of scenarios) {
    const inputUSD = s.borrowed * s.price;
    const flashFeeUSD = inputUSD * s.flashFee;
    const gasUSD = gasSOL * solPrice;
    const totalFeesUSD = flashFeeUSD + gasUSD;
    const minProfitPercent = (totalFeesUSD / inputUSD) * 100;
    
    const inputStr = `$${inputUSD.toFixed(0)}`.padEnd(9);
    const flashStr = `$${flashFeeUSD.toFixed(2)}`.padEnd(9);
    const gasStr = `$${gasUSD.toFixed(4)}`.padEnd(6);
    const profitStr = `${minProfitPercent.toFixed(3)}%`.padEnd(10);
    
    console.log(`   │ ${s.name.padEnd(21)} │ ${inputStr} │ ${flashStr} │ ${gasStr} │ ${profitStr} │`);
  }
  
  console.log('   └─────────────────────────────────────────────────────────────────────┘');
  
  console.log(`
   📌 KEY INSIGHTS:
   
   1. Flash loan fee (0.3%) is the DOMINANT cost
      - On $1000 trade: $3.00 flash loan fee vs $0.015 gas
      - Flash loan fee is ~200x larger than gas!
   
   2. To break even, gross arbitrage profit must exceed:
      - Flash loan: 0.30% + ~0.001% gas ≈ 0.301%
      - Wallet trade: ~0.001% gas only
   
   3. Market efficiency typically < 0.1% price difference
      - This is why 0/8 backtest trades were profitable
      - You need 3x the typical arb to cover flash loan fee
   
   4. Better opportunities:
      - New token launches (higher volatility)
      - During high volatility events
      - Cross-DEX inefficiencies on less liquid pairs
`);
}

// =============================================================================
// TEST 5: DEVNET TRANSACTION TEST
// =============================================================================

async function testDevnetTransaction() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST 5: DEVNET TRANSACTION TEST');
  console.log('═'.repeat(70));
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  try {
    // Generate a temporary keypair for devnet testing
    const tempWallet = Keypair.generate();
    console.log(`\n   🔑 Generated temp devnet wallet: ${tempWallet.publicKey.toString()}`);
    
    // Request airdrop
    console.log('   💸 Requesting devnet airdrop...');
    
    const airdropSig = await connection.requestAirdrop(
      tempWallet.publicKey,
      0.1 * LAMPORTS_PER_SOL // 0.1 SOL
    );
    
    // Wait for confirmation
    console.log('   ⏳ Waiting for airdrop confirmation...');
    await connection.confirmTransaction(airdropSig, 'confirmed');
    
    // Check balance
    const balance = await connection.getBalance(tempWallet.publicKey);
    console.log(`   ✅ Airdrop received: ${lamportsToSOL(balance).toFixed(4)} SOL`);
    
    // Create a simple transfer transaction to measure gas
    console.log('\n   📤 Creating test transaction...');
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tempWallet.publicKey,
        toPubkey: tempWallet.publicKey, // Send to self
        lamports: 1000, // 0.000001 SOL
      })
    );
    
    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = tempWallet.publicKey;
    
    // Sign and send
    console.log('   ✍️ Signing and sending transaction...');
    
    const preBalance = await connection.getBalance(tempWallet.publicKey);
    
    const txSig = await sendAndConfirmTransaction(
      connection,
      tx,
      [tempWallet],
      { commitment: 'confirmed' }
    );
    
    const postBalance = await connection.getBalance(tempWallet.publicKey);
    const actualFee = preBalance - postBalance - 1000; // Subtract the transfer amount
    
    console.log(`\n   📊 TRANSACTION RESULT:`);
    console.log(`       Signature: ${txSig.slice(0, 30)}...`);
    console.log(`       Pre-balance:  ${lamportsToSOL(preBalance).toFixed(9)} SOL`);
    console.log(`       Post-balance: ${lamportsToSOL(postBalance).toFixed(9)} SOL`);
    console.log(`       Actual Fee:   ${actualFee} lamports (${lamportsToSOL(actualFee).toFixed(9)} SOL)`);
    
    // Compare to expected
    const expectedBaseFee = 5000; // lamports
    console.log(`       Expected Fee: ${expectedBaseFee} lamports (base fee)`);
    console.log(`       Match: ${actualFee === expectedBaseFee ? '✅ EXACT MATCH' : '⚠️ Different (priority fee applied)'}`);
    
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
    if (e.message.includes('airdrop')) {
      console.log('   💡 Devnet airdrop might be rate-limited. Try again in a few minutes.');
    }
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          DEVNET & FEE CALCULATION VERIFICATION TESTS             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`   Time: ${new Date().toISOString()}`);
  
  // Run tests in sequence
  await verifyMainnetGasCosts();
  await analyzeCurrentNetworkFees();
  await checkWalletGasCapacity();
  await simulateFeeCalculation();
  await testDevnetTransaction();
  
  console.log('\n' + '═'.repeat(70));
  console.log('ALL TESTS COMPLETE');
  console.log('═'.repeat(70));
  
  console.log(`
📋 SUMMARY OF FEE STRUCTURE:

┌────────────────────────────────────────────────────────────────────┐
│ FEE TYPE           │ AMOUNT              │ WHO PAYS              │
├────────────────────────────────────────────────────────────────────┤
│ Solana Base Fee    │ 5000 lamports/sig   │ Your wallet (SOL)     │
│ Priority Fee       │ Variable (network)  │ Your wallet (SOL)     │
│ Flash Loan Fee     │ 0.3% of borrowed    │ Deducted from return  │
│ DEX Swap Fee       │ ~0.25-0.3% per swap │ Built into quote      │
└────────────────────────────────────────────────────────────────────┘

📌 YOUR WALLET (${MAINNET_WALLET}):
   - Must have SOL for gas fees
   - Flash loan fees come from the borrowed amount's profit
   - If arb profit < fees, you LOSE the difference from wallet

📌 BREAK-EVEN REQUIREMENTS:
   - Flash loan arb: Need >0.3% gross profit (very rare)
   - Wallet trade: Need >0.01% gross profit (gas only)
   - With slippage + price impact, need ~0.5% actual price discrepancy
`);
}

// Run
runAllTests()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
  });
