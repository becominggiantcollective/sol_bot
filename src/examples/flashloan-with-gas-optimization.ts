/**
 * EXAMPLE: Flash Loan Arbitrage with Gas Optimization
 * 
 * Demonstrates the three key improvements:
 * 1. Borrowing slightly more than needed to account for gas
 * 2. Profit calculations that include all costs (gas + flash loan fee)
 * 3. Using Jito bundles to avoid burning gas on failed transactions
 */

import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { SolanaConnection } from '../core/connection.js';
import { FlashloanManager } from '../core/flashloan.js';
import { GasOptimizer } from '../utils/gas-optimizer.js';
import bs58 from 'bs58';

// Configuration
const CONFIG = {
  rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
  privateKey: 'YOUR_PRIVATE_KEY',
  
  // Flash loan parameters
  flashLoan: {
    amount: 1000,  // Amount in SOL
    mint: 'So11111111111111111111111111111111111111112',  // SOL mint
    solendFee: 0.003,  // 0.3%
  },
  
  // Trading parameters
  slippage: 0.01,  // 1%
  minProfitSOL: 0.01,  // Minimum profit to execute (0.01 SOL)
};

class FlashLoanArbitrageBot {
  private connection: SolanaConnection;
  private flashloanManager: FlashloanManager;
  private gasOptimizer: GasOptimizer;
  private wallet: Keypair;

  constructor(rpcUrl: string, privateKey: string) {
    // SolanaConnection reads its RPC URL from config; we obtain the underlying
    // Connection from it so the GasOptimizer can share the same connection.
    this.connection = new SolanaConnection();
    const conn = this.connection.getConnection();
    this.flashloanManager = new FlashloanManager(this.connection);
    this.gasOptimizer = new GasOptimizer(conn);
    this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  }

  async executeArbitrage(): Promise<void> {
    console.log('🔍 Looking for arbitrage opportunities...\n');

    // Step 1: Find arbitrage opportunity (simplified example)
    const opportunity = await this.findArbitrageOpportunity();
    
    if (!opportunity) {
      console.log('❌ No profitable opportunities found');
      return;
    }

    console.log(`✅ Found opportunity: ${opportunity.tokenSymbol}`);
    console.log(`   Expected profit: $${opportunity.expectedProfit.toFixed(2)}\n`);

    // Step 2: Build arbitrage instructions (buy low, sell high)
    const arbitrageInstructions = await this.buildArbitrageInstructions(opportunity);

    // Step 3: Get flash loan provider
    const provider = this.flashloanManager.getSolendProvider();
    const mint = new PublicKey(CONFIG.flashLoan.mint);

    // Step 4: Create flash loan with gas optimization
    console.log('📊 Creating flash loan with gas optimization...');
    
    const result = await provider.createFlashloanInstructions(
      CONFIG.flashLoan.amount,
      mint,
      arbitrageInstructions,
      this.wallet.publicKey
    );

    console.log('   Flash loan amount:', (result.flashLoanAmount / 1e9).toFixed(4), 'SOL');
    console.log('   Target amount:', CONFIG.flashLoan.amount, 'SOL');
    console.log('   Extra borrowed for gas:', ((result.flashLoanAmount / 1e9) - CONFIG.flashLoan.amount).toFixed(4), 'SOL');
    console.log('   Estimated gas cost:', result.gasEstimate.inSOL.toFixed(6), 'SOL');
    console.log('   Flash loan fee:', (result.flashLoanAmount * CONFIG.flashLoan.solendFee / 1e9).toFixed(4), 'SOL');
    console.log('   Total cost:', (result.totalCost / 1e9).toFixed(6), 'SOL\n');

    // Step 5: Calculate if profitable BEFORE executing
    const expectedGrossProfit = opportunity.expectedProfit * 230; // Assume $230/SOL
    const profitability = this.flashloanManager.calculateProfitability(
      0,  // Start balance
      expectedGrossProfit * 1e9,  // Expected end balance in lamports
      result.gasEstimate,
      result.flashLoanAmount,
      CONFIG.flashLoan.solendFee
    );

    console.log('💰 Profitability Analysis:');
    console.log('   Gross profit:', profitability.profitInSOL.toFixed(6), 'SOL');
    console.log('   - Gas cost:', (profitability.gasCost / 1e9).toFixed(6), 'SOL');
    console.log('   - Flash loan fee:', (profitability.flashLoanFee / 1e9).toFixed(6), 'SOL');
    console.log('   = Net profit:', profitability.profitInSOL.toFixed(6), 'SOL');
    console.log('   ROI:', profitability.roi.toFixed(2), '%\n');

    // Step 6: Only execute if profitable after all costs
    if (!profitability.isProfitable || profitability.profitInSOL < CONFIG.minProfitSOL) {
      console.log('❌ Not profitable after costs, skipping...');
      console.log(`   Need at least ${CONFIG.minProfitSOL} SOL profit, only ${profitability.profitInSOL.toFixed(6)} SOL expected\n`);
      return;
    }

    // Step 7: Execute via Jito bundle (no gas burned on revert)
    console.log('🚀 Executing flash loan via Jito bundle...');
    
    const transaction = new Transaction();
    transaction.add(...result.instructions);

    const submitResult = await this.gasOptimizer.submitTransactionSafe(
      transaction,
      result.gasEstimate,
      true  // Use Jito
    );

    if (submitResult.success) {
      console.log(`✅ SUCCESS via ${submitResult.method.toUpperCase()}`);
      console.log(`   Signature: ${submitResult.signature}\n`);

      // Step 8: Verify actual profit
      await this.verifyProfit(submitResult.signature!, result.gasEstimate, result.flashLoanAmount);
    } else {
      console.log(`❌ FAILED: ${submitResult.error}`);
      console.log(`   Method attempted: ${submitResult.method.toUpperCase()}`);
      
      if (submitResult.method === 'jito') {
        console.log(`   ✅ No gas burned - Jito bundle rejected before inclusion\n`);
      } else {
        console.log(`   ⚠️  Gas may have been burned on RPC failure\n`);
      }
    }
  }

  private async findArbitrageOpportunity(): Promise<{
    tokenAddress: string;
    tokenSymbol: string;
    dex1: string;
    dex2: string;
    price1: number;
    price2: number;
    expectedProfit: number;
  } | null> {
    // Simplified - in real implementation, scan multiple DEXes
    // For demo purposes, return a mock opportunity
    return {
      tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      tokenSymbol: 'USDC',
      dex1: 'Raydium',
      dex2: 'Orca',
      price1: 0.999,
      price2: 1.001,
      expectedProfit: 15,  // $15 expected profit
    };
  }

  private async buildArbitrageInstructions(opportunity: any): Promise<any[]> {
    // Build swap instructions:
    // 1. Buy on DEX1 (lower price)
    // 2. Sell on DEX2 (higher price)
    // 3. Return borrowed SOL + fee
    
    // Simplified - in real implementation, use Jupiter API to build swap instructions
    return [];
  }

  private async verifyProfit(
    signature: string,
    gasEstimate: any,
    flashLoanAmount: number
  ): Promise<void> {
    console.log('🔍 Verifying actual profit...');
    
    // Get transaction details
    const tx = await this.connection.getConnection().getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      console.log('   ⚠️  Transaction not found');
      return;
    }

    // Get pre/post balances
    const preBalance = tx.meta?.preBalances[0] || 0;
    const postBalance = tx.meta?.postBalances[0] || 0;
    
    const profitability = this.flashloanManager.calculateProfitability(
      preBalance,
      postBalance,
      gasEstimate,
      flashLoanAmount,
      CONFIG.flashLoan.solendFee
    );

    console.log('   Actual net profit:', profitability.profitInSOL.toFixed(6), 'SOL');
    console.log('   Actual ROI:', profitability.roi.toFixed(2), '%');
    
    if (profitability.isProfitable) {
      console.log('   ✅ Trade was profitable!\n');
    } else {
      console.log('   ❌ Trade was not profitable (after costs)\n');
    }
  }
}

// Main execution
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  FLASH LOAN ARBITRAGE BOT - GAS OPTIMIZED v2        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const bot = new FlashLoanArbitrageBot(
    CONFIG.rpcUrl,
    CONFIG.privateKey
  );

  try {
    await bot.executeArbitrage();
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default FlashLoanArbitrageBot;
