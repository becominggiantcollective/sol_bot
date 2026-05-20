import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports that use process.env
dotenv.config();

import { SolanaConnection } from './core/connection.js';
import { detectOpportunities, compareCrossDexPrices, calculateFlashLoan, isFlashLoanProfitable, tradeLogs, flushArbitrageLog } from './core/arbitrage.js';
import { FlashloanManager } from './core/flashloan.js';
import { FlashloanArbitrageStrategy, SandwichAttackStrategy, LiquidationStrategy } from './strategies/mev.js';
import { DirectSwapStrategy } from './strategies/direct-swap.js';
import { COMMON_TOKENS, Logger, sleep } from './utils/index.js';
import { ProfitabilityTracker, Trade } from './utils/profitability.js';
import { config } from './config/index.js';
import { AgentCoordinator } from './agents/index.js';

export class SolanaArbitrageBot {
  private solanaConnection: SolanaConnection;
  private flashloanManager: FlashloanManager;
  private strategies: any[] = [];
  private liquidationStrategy?: LiquidationStrategy;
  private agentCoordinator?: AgentCoordinator;
  private logger: Logger;
  private profitTracker: ProfitabilityTracker;
  private isRunning = false;
  private metricsDisplayInterval?: NodeJS.Timeout;

  constructor() {
    this.logger = Logger.getInstance();
    this.logger.setLogLevel('info');
    
    try {
      this.solanaConnection = new SolanaConnection();
      this.flashloanManager = new FlashloanManager(this.solanaConnection);
      this.profitTracker = new ProfitabilityTracker(0); // Initialize with 0, will be updated on start
      
      // Initialize strategies - DirectSwapStrategy FIRST (preferred, actually works)
      this.strategies = [
        new DirectSwapStrategy(this.solanaConnection),
        new FlashloanArbitrageStrategy(this.solanaConnection, this.flashloanManager),
        new SandwichAttackStrategy(this.solanaConnection),
      ];

      // Initialize liquidation strategy if enabled
      if (config.liquidation.enabled) {
        this.liquidationStrategy = new LiquidationStrategy(this.solanaConnection, this.flashloanManager);
        this.logger.info('Liquidation strategy enabled');
      }
      
      this.logger.info('Solana Triangular Cross-DEX Arbitrage Bot initialized successfully');
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
      
      if (balance < 0.01) {
        this.logger.warn('Low wallet balance. Consider adding more SOL for gas fees.');
      }
      
      // Validate configuration
      this.validateConfig();
      
      this.isRunning = true;
      
      // Start the multi-agent coordinator
      this.agentCoordinator = new AgentCoordinator(
        this.solanaConnection,
        this.flashloanManager
      );
      await this.agentCoordinator.start();
      this.logger.info('Multi-agent trading system active');
      
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

    // Stop multi-agent coordinator
    if (this.agentCoordinator) {
      this.agentCoordinator.stop();
    }
    
    // Flush any pending async log queue entries before exit
    flushArbitrageLog();
    
    // Display final metrics
    this.profitTracker.displayMetrics();
  }

  private async tradingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        this.logger.info('🔺 Scanning for TRIANGULAR CROSS-DEX arbitrage opportunities...');
        
        // Run triangular arbitrage detection and liquidation scanning in parallel for maximum speed
        const [opportunities, liquidationTxs] = await Promise.all([
          detectOpportunities(),
          this.liquidationStrategy ? this.liquidationStrategy.scanAndExecuteLiquidations() : Promise.resolve([])
        ]);
        
        // Report liquidation results
        if (liquidationTxs.length > 0) {
          this.logger.info(`Executed ${liquidationTxs.length} liquidations: ${liquidationTxs.join(', ')}`);
        }

        // Process arbitrage opportunities
        if (opportunities.length > 0) {
          this.logger.info(`🎯 Found ${opportunities.length} TRIANGULAR arbitrage opportunities!`);
          
          // Execute the most profitable opportunity
          const bestOpportunity = opportunities[0];
          await this.executeTriangularOpportunity(bestOpportunity);
        } else {
          this.logger.debug('No profitable triangular arbitrage opportunities found');
        }
        
        // Wait between scans — parallelised scanning is much faster now so 2 s is sufficient
        await sleep(2000);
      } catch (error) {
        this.logger.error('Error in trading loop:', error);
        await sleep(5000); // Wait longer on error
      }
    }
  }

  private async executeTriangularOpportunity(opportunity: any): Promise<void> {
    const SOL_PRICE = 230;
    
    this.logger.info('═'.repeat(80));
    this.logger.info('🔺 EXECUTING TRIANGULAR ARBITRAGE OPPORTUNITY');
    this.logger.info('═'.repeat(80));
    this.logger.info(`Type:        ${opportunity.type}`);
    this.logger.info(`Path:        ${opportunity.route}`);
    this.logger.info(`Input:       ${opportunity.inputAmount.toFixed(6)} ${opportunity.tokenA}`);
    this.logger.info(`Expected:    ${opportunity.expectedOutput.toFixed(6)} ${opportunity.tokenA}`);
    this.logger.info(`Net Profit:  ${opportunity.profit.toFixed(6)} ${opportunity.tokenA} (${opportunity.profitPercent.toFixed(4)}%)`);
    
    if (opportunity.details) {
      this.logger.info('─'.repeat(80));
      this.logger.info('LEG BREAKDOWN:');
      this.logger.info(`  Leg 1: ${opportunity.tokenA} → ${opportunity.tokenB} = ${opportunity.details.leg1Output.toFixed(6)}`);
      this.logger.info(`  Leg 2: ${opportunity.tokenB} → ${opportunity.tokenC} = ${opportunity.details.leg2Output.toFixed(6)}`);
      this.logger.info(`  Leg 3: ${opportunity.tokenC} → ${opportunity.tokenA} = ${opportunity.details.leg3Output.toFixed(6)}`);
      this.logger.info(`  Gross Profit: ${opportunity.details.grossProfitPercent.toFixed(4)}%`);
      this.logger.info(`  Gas Cost:     ${opportunity.details.estimatedGasCost.toFixed(6)} ${opportunity.tokenA}`);
    }
    this.logger.info('─'.repeat(80));
    
    // Check if flash loan would be profitable
    const flashLoanCheck = opportunity.details ? 
      isFlashLoanProfitable(opportunity.details, 100) : // Check with $100 worth
      { profitable: false, reason: 'No details available' };
    
    this.logger.info(`Flash Loan Viable: ${flashLoanCheck.profitable ? '✅ YES' : '❌ NO'}`);
    this.logger.info(`Flash Loan Note:   ${flashLoanCheck.reason}`);
    
    // Find the best strategy for this opportunity
    const viableStrategy = this.strategies.find(strategy => strategy.isViable(opportunity));
    
    if (!viableStrategy) {
      this.logger.warn('❌ No viable execution strategy found for this triangular opportunity');
      this.logger.info('   (This is expected in simulation mode - we detect but don\'t execute)');
      this.logger.info('═'.repeat(80));
      return;
    }
    
    this.logger.info(`Strategy:    ${viableStrategy.constructor.name}`);
    
    try {
      const startTime = Date.now();
      
      // Execute the strategy
      const signature = await viableStrategy.execute(opportunity);
      
      const executionTime = Date.now() - startTime;
      
      this.logger.info('─'.repeat(80));
      this.logger.info('✅ TRIANGULAR TRADE EXECUTED SUCCESSFULLY');
      this.logger.info(`Signature:   ${signature}`);
      this.logger.info(`Exec Time:   ${executionTime}ms`);
      
      // Log profit
      const profitTokens = opportunity.profit;
      const profitUSD = profitTokens * (opportunity.tokenA === 'USDC' ? 1 : SOL_PRICE);
      
      this.logger.info('─'.repeat(80));
      this.logger.info('💰 PROFIT SUMMARY');
      this.logger.info(`Profit:      ${profitTokens.toFixed(6)} ${opportunity.tokenA} ($${profitUSD.toFixed(4)})`);
      this.logger.info(`ROI:         ${opportunity.profitPercent.toFixed(4)}%`);
      this.logger.info('═'.repeat(80));
      
      // Record successful trade
      const trade: Trade = {
        timestamp: new Date(),
        type: 'triangular-arbitrage',
        profit: profitUSD,
        success: true,
        details: {
          path: opportunity.route,
          inputAmount: opportunity.inputAmount,
          outputAmount: opportunity.expectedOutput,
          gasUsed: opportunity.details?.estimatedGasCost || 0,
        },
      };
      this.profitTracker.recordTrade(trade);
    } catch (error) {
      this.logger.info('─'.repeat(80));
      this.logger.error('❌ TRIANGULAR TRADE EXECUTION FAILED');
      this.logger.error(`Error: ${error}`);
      this.logger.info('═'.repeat(80));
      
      // Record failed trade
      const trade: Trade = {
        timestamp: new Date(),
        type: 'triangular-arbitrage',
        profit: -(opportunity.details?.estimatedGasCost || 0) * SOL_PRICE,
        success: false,
        details: {
          path: opportunity.route,
          gasUsed: opportunity.details?.estimatedGasCost || 0,
        },
      };
      this.profitTracker.recordTrade(trade);
    }
  }

  private validateConfig(): void {
    if (config.wallet.provider === 'hardware') {
      if (!config.wallet.hardwarePublicKey) {
        throw new Error(
          'Hardware wallet mode requires WALLET_HARDWARE_PUBLIC_KEY (or WALLET_PUBLIC_KEY).'
        );
      }
    } else if (!config.wallet.privateKey) {
      throw new Error(
        'Wallet private key not configured. Set WALLET_IDK_PRIVATE_KEY (or legacy WALLET_PRIVATE_KEY) environment variable.'
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
    const pubkey = this.solanaConnection.getWalletPublicKey();
    if (!pubkey) throw new Error('Wallet not loaded');
    return pubkey.toString();
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

  getAgentMetrics() {
    return this.agentCoordinator?.getMetrics() ?? null;
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

// Run if this file is executed directly (ES module compatible)
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch(console.error);
}
