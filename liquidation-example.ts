import dotenv from 'dotenv';
import { SolanaConnection } from './src/core/connection';
import { FlashloanManager } from './src/core/flashloan';
import { LiquidationStrategy } from './src/strategies/mev';
import { LiquidationDetector } from './src/core/liquidation';
import { Logger } from './src/utils';

// Load environment variables
dotenv.config();

/**
 * Liquidation Bot Example
 * 
 * This example demonstrates the aggressive liquidation strategy implementation
 * that uses flash loans to execute liquidations with maximum speed and efficiency.
 * 
 * Features demonstrated:
 * - Real-time liquidation opportunity detection
 * - Flash loan-based liquidation execution
 * - Priority fee optimization for speed
 * - Multi-protocol support (Solend, Mango, Port)
 * - Parallel execution capabilities
 */
async function runLiquidationExample(): Promise<void> {
  const logger = Logger.getInstance();
  logger.setLogLevel('info');
  
  try {
    logger.info('🚀 Starting Liquidation Bot Example...');
    
    // Initialize core components
    logger.info('📡 Initializing Solana connection...');
    const solanaConnection = new SolanaConnection();
    
    logger.info('💰 Initializing flash loan manager...');
    const flashloanManager = new FlashloanManager(solanaConnection);
    
    logger.info('🎯 Initializing liquidation strategy...');
    const liquidationStrategy = new LiquidationStrategy(solanaConnection, flashloanManager);
    
    logger.info('🔍 Initializing liquidation detector...');
    const liquidationDetector = new LiquidationDetector(solanaConnection);
    
    // Check wallet balance
    const balance = await solanaConnection.getBalance();
    logger.info(`💳 Wallet balance: ${balance.toFixed(4)} SOL`);
    
    if (balance < 0.1) {
      logger.warn('⚠️  Low wallet balance. Consider adding more SOL for gas fees.');
    }
    
    // Demonstrate liquidation detection
    logger.info('\n🔍 Scanning for liquidation opportunities...');
    const opportunities = await liquidationDetector.detectLiquidationOpportunities();
    
    if (opportunities.length === 0) {
      logger.info('✅ No liquidation opportunities found (good for the market!)');
      return;
    }
    
    logger.info(`📈 Found ${opportunities.length} liquidation opportunities:`);
    
    // Display opportunities
    opportunities.forEach((opportunity, index) => {
      logger.info(`\n💀 Liquidation Opportunity #${index + 1}:`);
      logger.info(`   Protocol: ${opportunity.protocol}`);
      logger.info(`   Borrower: ${opportunity.borrower.toString()}`);
      logger.info(`   Health Factor: ${opportunity.healthFactor.toFixed(4)}`);
      logger.info(`   Urgency: ${opportunity.urgency.toUpperCase()}`);
      logger.info(`   Est. Profit: ${opportunity.estimatedProfit.toFixed(4)} (${(opportunity.profitPercent * 100).toFixed(2)}%)`);
      logger.info(`   Flash Loan Required: ${opportunity.flashloanRequired ? 'Yes' : 'No'}`);
    });
    
    // Execute liquidations (limited to top 2 for demo)
    const topOpportunities = opportunities.slice(0, 2);
    logger.info(`\n⚡ Executing top ${topOpportunities.length} liquidations with maximum aggression...`);
    
    const startTime = Date.now();
    
    // Execute liquidations in parallel for maximum speed
    const executionPromises = topOpportunities.map(async (opportunity, index) => {
      try {
        logger.info(`🏃‍♂️ Starting liquidation ${index + 1}...`);
        const signature = await liquidationStrategy.executeLiquidation(opportunity);
        logger.info(`✅ Liquidation ${index + 1} completed: ${signature}`);
        return { success: true, signature, opportunity };
      } catch (error) {
        logger.error(`❌ Liquidation ${index + 1} failed:`, error);
        return { success: false, error, opportunity };
      }
    });
    
    const results = await Promise.allSettled(executionPromises);
    const executionTime = Date.now() - startTime;
    
    // Report results
    logger.info(`\n📊 Liquidation Execution Summary (${executionTime}ms):`);
    
    let successCount = 0;
    let totalProfit = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
        totalProfit += result.value.opportunity.estimatedProfit;
        logger.info(`✅ Liquidation ${index + 1}: SUCCESS - ${result.value.signature}`);
      } else {
        logger.info(`❌ Liquidation ${index + 1}: FAILED`);
      }
    });
    
    logger.info(`\n🏆 Final Results:`);
    logger.info(`   Successful Liquidations: ${successCount}/${topOpportunities.length}`);
    logger.info(`   Total Estimated Profit: ${totalProfit.toFixed(4)} tokens`);
    logger.info(`   Average Execution Time: ${(executionTime / topOpportunities.length).toFixed(2)}ms per liquidation`);
    logger.info(`   Success Rate: ${((successCount / topOpportunities.length) * 100).toFixed(1)}%`);
    
    if (successCount > 0) {
      logger.info('\n🎉 Liquidations executed successfully! The bot is working optimally.');
    } else {
      logger.info('\n🤔 No liquidations were executed. This could be due to network conditions or competition.');
    }
    
  } catch (error) {
    logger.error('💥 Fatal error in liquidation example:', error);
    process.exit(1);
  }
}

/**
 * Demonstration of liquidation strategy features
 */
async function demonstrateFeatures(): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('\n🔥 AGGRESSIVE LIQUIDATION BOT FEATURES:');
  logger.info('\n⚡ SPEED OPTIMIZATIONS:');
  logger.info('   • Priority fee bidding to outcompete other liquidators');
  logger.info('   • Parallel execution of multiple liquidations');
  logger.info('   • Optimized transaction construction');
  logger.info('   • 2-second scanning intervals for fastest detection');
  
  logger.info('\n💰 CAPITAL EFFICIENCY:');
  logger.info('   • Flash loan integration for zero-capital liquidations');
  logger.info('   • Automatic provider selection (Solend, Mango)');
  logger.info('   • Collateral swapping for optimal profit realization');
  
  logger.info('\n🎯 MULTI-PROTOCOL SUPPORT:');
  logger.info('   • Solend Protocol liquidations');
  logger.info('   • Mango Markets perpetual liquidations');
  logger.info('   • Port Finance lending liquidations');
  
  logger.info('\n🛡️ RISK MANAGEMENT:');
  logger.info('   • Configurable profit thresholds');
  logger.info('   • Maximum concurrent liquidation limits');
  logger.info('   • Health factor monitoring and urgency classification');
  logger.info('   • Automatic fallback to direct execution when flash loans unavailable');
  
  logger.info('\n🚀 COMPETITIVE ADVANTAGES:');
  logger.info('   • Fastest detection through parallel protocol scanning');
  logger.info('   • Highest priority fees for maximum win rate');
  logger.info('   • Zero slippage through atomic flash loan execution');
  logger.info('   • MEV-optimized transaction ordering');
}

// Main execution
async function main(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    // Show features
    await demonstrateFeatures();
    
    // Run the example
    await runLiquidationExample();
    
    logger.info('\n🎯 Example completed! To run this bot continuously, use: npm run dev');
    
  } catch (error) {
    logger.error('Example failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Liquidation example terminated by user');
  process.exit(0);
});

// Run the example
main().catch(console.error);