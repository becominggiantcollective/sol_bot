import dotenv from 'dotenv';
import { Keypair } from '@solana/web3.js';
import { SolanaConnection } from './src/core/connection';
import { ArbitrageDetector } from './src/core/arbitrage';
import { FlashloanManager } from './src/core/flashloan';
import { FlashloanArbitrageStrategy } from './src/strategies/mev';
import { COMMON_TOKENS, Logger } from './src/utils';

// Load environment variables
dotenv.config();

/**
 * Flashloan Arbitrage Demo
 * 
 * This demo demonstrates a complete flashloan arbitrage trade flow:
 * 1. Scan for arbitrage opportunities across multiple DEXes
 * 2. Evaluate opportunity profitability
 * 3. Select optimal flashloan provider
 * 4. Build and execute arbitrage transaction with flashloan
 * 5. Repay flashloan and pocket the profit
 */

async function main() {
  const logger = Logger.getInstance();
  logger.setLogLevel('info');

  console.log('🚀 Solana Flashloan Arbitrage Bot - Demo Mode\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check environment setup
  if (!process.env.WALLET_PRIVATE_KEY) {
    console.error('❌ ERROR: WALLET_PRIVATE_KEY not set in .env file');
    console.log('\n💡 Quick Setup:');
    console.log('   1. Copy .env.example to .env');
    console.log('   2. Add your wallet private key');
    console.log('   3. For testing, use .env.devnet\n');
    return;
  }

  try {
    // Initialize components
    console.log('📋 Initializing bot components...\n');
    
    const solanaConnection = new SolanaConnection();
    const arbitrageDetector = new ArbitrageDetector(solanaConnection);
    const flashloanManager = new FlashloanManager(solanaConnection);
    const strategy = new FlashloanArbitrageStrategy(solanaConnection, flashloanManager);

    // Get wallet info
    const walletAddress = solanaConnection.getWalletPublicKey().toString();
    const balance = await solanaConnection.getBalance();
    
    console.log('✅ Bot initialized successfully');
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);
    console.log(`   Balance: ${balance.toFixed(4)} SOL`);
    console.log(`   Network: ${process.env.SOLANA_RPC_URL?.includes('devnet') ? 'Devnet' : 'Mainnet'}`);
    console.log('');

    if (balance < 0.1) {
      console.log('⚠️  WARNING: Low SOL balance for transaction fees');
      console.log('   Consider adding more SOL to your wallet\n');
    }

    // Step 1: Scan for opportunities
    console.log('═══════════════════════════════════════════════════════════');
    console.log('STEP 1: Scanning for Arbitrage Opportunities');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Monitoring tokens:');
    const tokens = [
      COMMON_TOKENS.SOL,
      COMMON_TOKENS.USDC,
      COMMON_TOKENS.USDT,
      COMMON_TOKENS.BONK,
      COMMON_TOKENS.WIF,
    ];

    tokens.forEach((token, i) => {
      const names = ['SOL', 'USDC', 'USDT', 'BONK', 'WIF'];
      console.log(`   ${i + 1}. ${names[i]}: ${token.toString().slice(0, 8)}...`);
    });

    console.log('\n🔍 Scanning DEXes (Jupiter, Orca, Raydium)...\n');
    const startTime = Date.now();
    const opportunities = await arbitrageDetector.detectOpportunities(tokens);
    const scanDuration = Date.now() - startTime;

    console.log(`✅ Scan completed in ${scanDuration}ms`);
    console.log(`   Found ${opportunities.length} potential opportunities\n`);

    if (opportunities.length === 0) {
      console.log('ℹ️  No profitable opportunities found at this time');
      console.log('   This is normal - arbitrage opportunities are rare and fleeting');
      console.log('\n💡 In production mode, the bot runs continuously to catch opportunities');
      
      // Create a simulated opportunity for demonstration
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('DEMONSTRATION MODE: Simulating an Opportunity');
      console.log('═══════════════════════════════════════════════════════════\n');
      
      demonstrateArbitrageTrade();
      return;
    }

    // Step 2: Evaluate best opportunity
    console.log('═══════════════════════════════════════════════════════════');
    console.log('STEP 2: Evaluating Best Opportunity');
    console.log('═══════════════════════════════════════════════════════════\n');

    const bestOpportunity = opportunities[0];
    console.log('📊 Opportunity Details:');
    console.log(`   Input Token: ${bestOpportunity.inputMint.toString().slice(0, 8)}...`);
    console.log(`   Output Token: ${bestOpportunity.outputMint.toString().slice(0, 8)}...`);
    console.log(`   Input Amount: ${bestOpportunity.inputAmount.toLocaleString()} tokens`);
    console.log(`   Expected Output: ${bestOpportunity.expectedOutput.toLocaleString()} tokens`);
    console.log(`   Gross Profit: ${bestOpportunity.profit.toFixed(2)} tokens`);
    console.log(`   Profit Percentage: ${(bestOpportunity.profitPercent * 100).toFixed(2)}%`);
    console.log(`   Gas Estimate: ${bestOpportunity.gasEstimate} SOL`);
    console.log(`   Route: ${bestOpportunity.route.length} swaps\n`);

    bestOpportunity.route.forEach((route, i) => {
      console.log(`   ${i + 1}. ${route.dex.toUpperCase()}`);
      console.log(`      ${route.inputAmount.toLocaleString()} → ${route.outputAmount.toLocaleString()}`);
      console.log(`      Price Impact: ${(route.priceImpact * 100).toFixed(2)}%`);
    });

    // Step 3: Check viability
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('STEP 3: Checking Strategy Viability');
    console.log('═══════════════════════════════════════════════════════════\n');

    const viable = strategy.isViable(bestOpportunity);
    console.log(`Strategy: ${strategy.name}`);
    console.log(`Viable: ${viable ? '✅ Yes' : '❌ No'}`);

    if (!viable) {
      console.log('\n⚠️  Opportunity not viable after fees');
      console.log('   Net profit would be negative or too small');
      return;
    }

    // Step 4: Select flashloan provider
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('STEP 4: Selecting Flashloan Provider');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Checking available providers...');
    const provider = await flashloanManager.getBestProvider(bestOpportunity.inputAmount);

    if (provider) {
      console.log(`\n✅ Provider selected: ${provider.name}`);
      console.log(`   Max capacity: $${provider.maxAmount.toLocaleString()}`);
      console.log(`   Fee: ${(provider.fee * 100).toFixed(3)}%`);
      console.log(`   Estimated fee: ${provider.calculateFee(bestOpportunity.inputAmount).toFixed(2)} tokens`);
    } else {
      console.log('\n⚠️  No flashloan provider available');
      console.log('   This is expected in test/devnet environments');
    }

    // Step 5: Execute (simulation)
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('STEP 5: Execute Trade (SIMULATION MODE)');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('ℹ️  In production, this would execute the following transaction:');
    console.log('\n📝 Transaction Structure:');
    console.log('   1. Borrow tokens via flashloan');
    console.log('   2. Execute arbitrage swaps:');
    bestOpportunity.route.forEach((route, i) => {
      console.log(`      ${i + 1}. Swap on ${route.dex.toUpperCase()}`);
    });
    console.log('   3. Repay flashloan + fee');
    console.log('   4. Transfer profit to wallet');

    const flashloanFee = bestOpportunity.inputAmount * (provider?.fee || 0.0003);
    const netProfit = bestOpportunity.profit - flashloanFee - bestOpportunity.gasEstimate;

    console.log('\n💰 Profit Calculation:');
    console.log(`   Gross Profit: ${bestOpportunity.profit.toFixed(2)} tokens`);
    console.log(`   - Flashloan Fee: ${flashloanFee.toFixed(2)} tokens`);
    console.log(`   - Gas Fee: ${bestOpportunity.gasEstimate.toFixed(4)} SOL`);
    console.log(`   = Net Profit: ${netProfit.toFixed(2)} tokens`);

    if (netProfit > 0) {
      console.log('\n✅ Trade would be PROFITABLE');
    } else {
      console.log('\n❌ Trade would NOT be profitable after fees');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Demo Completed Successfully');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('💡 Next Steps:');
    console.log('   • Run `npm start` to start the bot in production mode');
    console.log('   • The bot will continuously scan for opportunities');
    console.log('   • Profitable trades will be executed automatically');
    console.log('   • Monitor metrics with `npm run monitor`\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('   • Check your .env configuration');
    console.log('   • Ensure RPC endpoint is accessible');
    console.log('   • Verify wallet has sufficient SOL for fees\n');
  }
}

function demonstrateArbitrageTrade() {
  console.log('Creating simulated arbitrage opportunity...\n');
  
  console.log('📊 Simulated Opportunity:');
  console.log('   Type: SOL/USDC Arbitrage');
  console.log('   Input: 10,000 SOL');
  console.log('   Expected Output: 10,300 SOL');
  console.log('   Gross Profit: 300 SOL (3.0%)');
  console.log('');
  
  console.log('🔄 Trade Route:');
  console.log('   1. JUPITER: Swap 10,000 SOL → 10,150 USDC');
  console.log('      Price Impact: 0.5%');
  console.log('   2. RAYDIUM: Swap 10,150 USDC → 10,300 SOL');
  console.log('      Price Impact: 0.4%');
  console.log('');
  
  console.log('💰 Profit Breakdown:');
  console.log('   Gross Profit: 300 SOL');
  console.log('   - Flashloan Fee (0.03%): 3 SOL');
  console.log('   - Gas Fees: ~0.01 SOL');
  console.log('   = Net Profit: ~297 SOL');
  console.log('');
  
  console.log('✅ This trade would be executed in production!');
  console.log('');
  console.log('🎯 Trade Execution Flow:');
  console.log('   1. Borrow 10,000 SOL via flashloan from Solend');
  console.log('   2. Swap SOL → USDC on Jupiter (buy at lower price)');
  console.log('   3. Swap USDC → SOL on Raydium (sell at higher price)');
  console.log('   4. Repay 10,003 SOL to Solend (principal + 0.03% fee)');
  console.log('   5. Keep ~297 SOL profit in wallet');
  console.log('');
  console.log('⚡ All of this happens in a SINGLE atomic transaction!');
  console.log('   If any step fails, the entire transaction reverts.');
  console.log('   You never risk your own capital!\n');
}

// Run the demo
main().catch(console.error);
