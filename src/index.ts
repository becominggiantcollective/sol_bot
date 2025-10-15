// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();

import { SolanaConnection } from './core/connection';
import { ArbitrageDetector } from './core/arbitrage';
import { FlashloanManager } from './core/flashloan';
import {
  FlashloanArbitrageStrategy,
  SandwichAttackStrategy,
  LiquidationStrategy,
} from './strategies/mev';
import { COMMON_TOKENS, Logger, sleep } from './utils';
import { config } from './config';

export class SolanaArbitrageBot {
  private solanaConnection: SolanaConnection;
  private arbitrageDetector: ArbitrageDetector;
  private flashloanManager: FlashloanManager;
  private strategies: any[] = [];
  private liquidationStrategy?: LiquidationStrategy;
  private logger: Logger;
  private isRunning = false;

  constructor() {
    this.logger = Logger.getInstance();
    this.logger.setLogLevel('info');

    try {
      this.solanaConnection = new SolanaConnection();
      this.arbitrageDetector = new ArbitrageDetector(this.solanaConnection);
      this.flashloanManager = new FlashloanManager(this.solanaConnection);

      // Initialize strategies
      this.strategies = [
        new FlashloanArbitrageStrategy(this.solanaConnection, this.flashloanManager),
        new SandwichAttackStrategy(this.solanaConnection),
      ];

      // Initialize liquidation strategy if enabled
      if (config.liquidation.enabled) {
        this.liquidationStrategy = new LiquidationStrategy(
          this.solanaConnection,
          this.flashloanManager
        );
        this.logger.info('Liquidation strategy enabled');
      }

      this.logger.info('Solana Arbitrage Bot initialized successfully');
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
  }

  private async tradingLoop(): Promise<void> {
    const tokens = Object.values(COMMON_TOKENS);

    while (this.isRunning) {
      try {
        this.logger.debug('Scanning for trading opportunities...');

        // Run arbitrage detection and liquidation scanning in parallel for maximum speed
        const [opportunities, liquidationTxs] = await Promise.all([
          this.arbitrageDetector.detectOpportunities(tokens),
          this.liquidationStrategy
            ? this.liquidationStrategy.scanAndExecuteLiquidations()
            : Promise.resolve([]),
        ]);

        // Report liquidation results
        if (liquidationTxs.length > 0) {
          this.logger.info(
            `Executed ${liquidationTxs.length} liquidations: ${liquidationTxs.join(', ')}`
          );
        }

        // Process arbitrage opportunities
        if (opportunities.length > 0) {
          this.logger.info(`Found ${opportunities.length} arbitrage opportunities`);

          // Execute the most profitable opportunity
          const bestOpportunity = opportunities[0];
          await this.executeOpportunity(bestOpportunity);
        } else {
          this.logger.debug('No profitable arbitrage opportunities found');
        }

        // Shorter wait time for aggressive liquidation monitoring
        await sleep(2000); // 2 seconds for more aggressive scanning
      } catch (error) {
        this.logger.error('Error in trading loop:', error);
        await sleep(5000); // Wait longer on error
      }
    }
  }

  private async executeOpportunity(opportunity: any): Promise<void> {
    this.logger.info(
      `Executing opportunity: ${opportunity.inputMint.toString()} -> ${opportunity.outputMint.toString()}, Profit: ${opportunity.profitPercent * 100}%`
    );

    // Find the best strategy for this opportunity
    const viableStrategy = this.strategies.find((strategy) => strategy.isViable(opportunity));

    if (!viableStrategy) {
      this.logger.warn('No viable strategy found for opportunity');
      return;
    }

    try {
      // Execute the strategy
      const signature = await viableStrategy.execute(opportunity);
      this.logger.info(`Opportunity executed successfully: ${signature}`);

      // Log profit
      this.logger.info(
        `Estimated profit: ${opportunity.profit} tokens (${opportunity.profitPercent * 100}%)`
      );
    } catch (error) {
      this.logger.error('Failed to execute opportunity:', error);
    }
  }

  private validateConfig(): void {
    if (!config.wallet.privateKey) {
      throw new Error(
        'Wallet private key not configured. Set WALLET_PRIVATE_KEY environment variable.'
      );
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
