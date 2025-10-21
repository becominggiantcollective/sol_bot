// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import { SolanaConnection } from './core/connection';
import { ArbitrageDetector } from './core/arbitrage';
import { FlashloanManager } from './core/flashloan';
import { FlashloanArbitrageStrategy } from './strategies/mev';
import { COMMON_TOKENS, Logger, sleep } from './utils';
import { ProfitabilityTracker, Trade } from './utils/profitability';
import { config } from './config';

export class SolanaArbitrageBot {
  private solanaConnection: SolanaConnection;
  private arbitrageDetector: ArbitrageDetector;
  private flashloanManager: FlashloanManager;
  private strategies: any[] = [];
  private logger: Logger;
  private profitTracker: ProfitabilityTracker;
  private isRunning = false;
  private metricsDisplayInterval?: NodeJS.Timeout;

  constructor() {
    this.logger = Logger.getInstance();
    this.logger.setLogLevel('info');
    
    try {
      this.solanaConnection = new SolanaConnection();
      this.arbitrageDetector = new ArbitrageDetector(this.solanaConnection);
      this.flashloanManager = new FlashloanManager(this.solanaConnection);
      this.profitTracker = new ProfitabilityTracker(0); // Initialize with 0, will be updated on start
      
      // Initialize only arbitrage strategy - liquidation removed per user request
      this.strategies = [
        new FlashloanArbitrageStrategy(this.solanaConnection, this.flashloanManager),
      ];
      
      this.logger.info('Solana Arbitrage Bot initialized successfully');
      this.logger.info('🎯 Focus: Flashloan arbitrage opportunities only');
      this.logger.info('🛡️  Smart rate limit protection: Progressive cooldown (15s → 5min) activated');
    } catch (error) {
      this.logger.error('Failed to initialize bot:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting Solana Arbitrage Bot...');
    
    try {
      // Check wallet balance
      const balance = await this.solanaConnection.getBalance();
      this.logger.info(`Wallet balance: ${balance} SOL`);
      
      if (balance < 0.1) {
        this.logger.warn('Low wallet balance. Consider adding more SOL for gas fees.');
      }
      
      // Validate configuration
      this.validateConfig();
      
      this.isRunning = true;
      
      // Start metrics display interval (every 5 minutes)
      this.metricsDisplayInterval = setInterval(() => {
        this.profitTracker.displayMetrics();
        
        // Check if bot is performing well
        if (!this.profitTracker.isPerformingWell(55, 0.5)) {
          this.logger.warn('Bot performance is below target. Consider adjusting parameters.');
        }
      }, 5 * 60 * 1000);
      
      // Start main trading loop
      await this.tradingLoop();
    } catch (error) {
      this.logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Solana Arbitrage Bot...');
    this.isRunning = false;
    
    if (this.metricsDisplayInterval) {
      clearInterval(this.metricsDisplayInterval);
    }
    
    // Display final metrics
    this.profitTracker.displayMetrics();
  }

  private async tradingLoop(): Promise<void> {
    const tokens = Object.values(COMMON_TOKENS);
    
    while (this.isRunning) {
      try {
        this.logger.debug('Scanning for arbitrage opportunities...');
        
        // Detect arbitrage opportunities using real-time on-chain price feeds
        const opportunities = await this.arbitrageDetector.detectOpportunities(tokens);

        // Process arbitrage opportunities
        if (opportunities.length > 0) {
          this.logger.info(`Found ${opportunities.length} arbitrage opportunities`);
          
          // Execute the most profitable opportunity
          const bestOpportunity = opportunities[0];
          await this.executeOpportunity(bestOpportunity);
        } else {
          this.logger.debug('No profitable arbitrage opportunities found');
        }
        
        // Wait 20 seconds between scans (6 tokens = 60 API calls, well under rate limit)
        // With proper rate limiting, we can scan faster and catch more opportunities!
        await sleep(20000);
      } catch (error) {
        this.logger.error('Error in trading loop:', error);
        await sleep(30000); // Wait longer on error to avoid rate limiting
      }
    }
  }

  private async executeOpportunity(opportunity: any): Promise<void> {
    this.logger.info(
      `Executing opportunity: ${opportunity.inputMint.toString()} -> ${opportunity.outputMint.toString()}, Profit: ${opportunity.profitPercent * 100}%`
    );
    
    // Find the best strategy for this opportunity
    const viableStrategy = this.strategies.find(strategy => strategy.isViable(opportunity));
    
    if (!viableStrategy) {
      this.logger.warn('No viable strategy found for opportunity');
      return;
    }
    
    try {
      // Execute the strategy
      const signature = await viableStrategy.execute(opportunity);
      this.logger.info(`Opportunity executed successfully: ${signature}`);
      
      // Log profit and record trade
      const profit = opportunity.profit;
      this.logger.info(`Estimated profit: ${profit} tokens (${opportunity.profitPercent * 100}%)`);
      
      // Record successful trade
      const trade: Trade = {
        timestamp: new Date(),
        type: 'arbitrage',
        profit,
        success: true,
        details: {
          inputToken: opportunity.inputMint.toString(),
          outputToken: opportunity.outputMint.toString(),
          inputAmount: opportunity.inputAmount,
          outputAmount: opportunity.expectedOutput,
          gasUsed: opportunity.gasEstimate,
        },
      };
      this.profitTracker.recordTrade(trade);
    } catch (error) {
      this.logger.error('Failed to execute opportunity:', error);
      
      // Record failed trade
      const trade: Trade = {
        timestamp: new Date(),
        type: 'arbitrage',
        profit: -opportunity.gasEstimate, // Loss is the gas fee
        success: false,
        details: {
          inputToken: opportunity.inputMint.toString(),
          outputToken: opportunity.outputMint.toString(),
          gasUsed: opportunity.gasEstimate,
        },
      };
      this.profitTracker.recordTrade(trade);
    }
  }

  private validateConfig(): void {
    if (!config.wallet.privateKey) {
      throw new Error('Wallet private key not configured. Set WALLET_PRIVATE_KEY environment variable.');
    }
    
    if (!config.solana.rpcUrl) {
      throw new Error('Solana RPC URL not configured. Set SOLANA_RPC_URL environment variable.');
    }
    
    this.logger.info('Configuration validated successfully');
  }

  // Public methods for monitoring
  async getWalletBalance(): Promise<number> {
    return await this.solanaConnection.getBalance();
  }

  async getWalletAddress(): Promise<string> {
    return this.solanaConnection.getWalletPublicKey().toString();
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getProfitMetrics() {
    return this.profitTracker.getMetrics();
  }

  exportMetrics(): string {
    return this.profitTracker.exportToJSON();
  }
}

// Main execution
async function main(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const bot = new SolanaArbitrageBot();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bot.stop();
      process.exit(0);
    });
    
    // Start the bot
    await bot.start();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

// SolanaArbitrageBot is already exported above

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}