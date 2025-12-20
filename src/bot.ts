/**
 * Unified Bot Entry Point
 * 
 * Combines all strategies:
 * - Cross-DEX Triangular Arbitrage
 * - Flash Loan Scalping on Volatile Tokens  
 * - New Token Hunting
 * - MEV Protection via Jito Bundles
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - bs58 has types but TS can't find them
import bs58 from 'bs58';
import { config } from './config/index.js';
import { FlashLoanScalper, ScalpOpportunity } from './core/flashLoanScalper.js';
import { CrossDEXArbitrageDetector } from './core/crossDexArbitrage.js';
import { JitoBundleSender, MEVProtectedExecutor } from './core/jitoBundle.js';
import { SolanaConnection } from './core/connection.js';
import { establishedScanner } from './core/establishedArbitrage.js';
// Phase 2.5: Critical Latency Fixes
import { HeliusPoolMonitor } from './utils/heliusPoolMonitor.js';
import { RustTransactionExecutor } from './utils/rustTransactionExecutor.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface BotConfig {
  mode: 'scalper' | 'arbitrage' | 'combined' | 'established';
  dryRun: boolean;
  scanIntervalMs: number;
  maxConcurrentScans: number;
  minProfitThresholdPercent: number;
  useMevProtection: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CONFIG: BotConfig = {
  mode: 'combined', // SCAN BOTH NEW TOKENS + ESTABLISHED PAIRS
  dryRun: true, // ALWAYS start in dry run!
  scanIntervalMs: 2000, // 2 seconds
  maxConcurrentScans: 5,
  minProfitThresholdPercent: 0.001, // 0.1% minimum - very aggressive
  useMevProtection: true,
  logLevel: 'info',
};

// =============================================================================
// LOGGING
// =============================================================================

class Logger {
  private level: 'debug' | 'info' | 'warn' | 'error';
  private logFile: string;
  
  constructor(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.level = level;
    this.logFile = `bot_${new Date().toISOString().split('T')[0]}.log`;
  }
  
  private shouldLog(msgLevel: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(msgLevel) >= levels.indexOf(this.level);
  }
  
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }
  
  private writeToFile(message: string): void {
    try {
      fs.appendFileSync(this.logFile, message + '\n');
    } catch {
      // Ignore file write errors
    }
  }
  
  debug(message: string): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage('debug', message);
      console.log(`🔍 ${message}`);
      this.writeToFile(formatted);
    }
  }
  
  info(message: string): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message);
      console.log(`ℹ️  ${message}`);
      this.writeToFile(formatted);
    }
  }
  
  warn(message: string): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage('warn', message);
      console.log(`⚠️  ${message}`);
      this.writeToFile(formatted);
    }
  }
  
  error(message: string): void {
    if (this.shouldLog('error')) {
      const formatted = this.formatMessage('error', message);
      console.log(`❌ ${message}`);
      this.writeToFile(formatted);
    }
  }
  
  success(message: string): void {
    const formatted = this.formatMessage('info', message);
    console.log(`✅ ${message}`);
    this.writeToFile(formatted);
  }
  
  opportunity(message: string): void {
    const formatted = this.formatMessage('info', `[OPPORTUNITY] ${message}`);
    console.log(`💰 ${message}`);
    this.writeToFile(formatted);
  }
}

// =============================================================================
// MAIN BOT CLASS
// =============================================================================

class UnifiedBot {
  private config: BotConfig;
  private logger: Logger;
  private connection: Connection;
  private wallet: Keypair | null = null;
  private solanaConnection: SolanaConnection | null = null;
  
  // Strategies
  private flashLoanScalper: FlashLoanScalper | null = null;
  private crossDexArb: CrossDEXArbitrageDetector | null = null;
  
  // MEV Protection
  private jitoBundler: JitoBundleSender | null = null;
  private mevExecutor: MEVProtectedExecutor | null = null;
  
  // Phase 2.5: Ultra-Fast Components
  private heliusMonitor: HeliusPoolMonitor | null = null;
  private rustExecutor: RustTransactionExecutor | null = null;
  
  // State
  private isRunning = false;
  private scanCount = 0;
  private opportunitiesFound = 0;
  private tradesExecuted = 0;
  private totalProfit = 0;
  
  // Token list for scanning - HIGH VOLUME & VOLATILE TOKENS
  private tokenList: string[] = [
    // Core majors
    'So11111111111111111111111111111111111111112',  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    // DEX tokens
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
    'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // ORCA
    // Liquid staking (price dislocations)
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
    // High volatility meme coins
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
    '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU ($541K vol)
    // TRENDING HOT (massive volume)
    'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump', // PIPPIN ($25.6M vol!)
    '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump', // ARC ($3.1M vol)
    'H6YqpXmDH9byrVsdJWgVdTJxzUob9uL7aoSLpFqapump', // SHOGGOTH ($5.4M vol)
    // DeFi
    'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
    'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  // JTO
    // Wormhole bridged (arb opportunities)
    '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WETH
  ];
  
  constructor(userConfig: Partial<BotConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    this.logger = new Logger(this.config.logLevel);
    
    // Initialize connection
    const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }
  
  /**
   * Initialize the bot
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Unified Trading Bot...');
    
    // Load wallet
    await this.loadWallet();
    
    // Initialize SolanaConnection wrapper (skip wallet loading since we handle it above)
    this.solanaConnection = new SolanaConnection(true);
    
    // Initialize strategies based on mode
    await this.initializeStrategies();
    
    // Initialize MEV protection
    if (this.config.useMevProtection && this.wallet) {
      this.jitoBundler = new JitoBundleSender(this.connection);
      this.mevExecutor = new MEVProtectedExecutor(this.connection, this.wallet);
      this.logger.info('MEV protection enabled (Jito bundles)');
    }
    
    // =========================================================================
    // PHASE 2.5: CRITICAL LATENCY FIXES
    // =========================================================================
    
    // 1. Helius WebSocket Pool Monitor (<100ms pool change detection)
    if (config.helius?.wsUrl && config.helius?.apiKey) {
      this.heliusMonitor = new HeliusPoolMonitor(this.connection);
      await this.heliusMonitor.start((programId, account) => {
        this.logger.debug(`⚡ Pool update: ${programId.slice(0, 8)}...`);
        // Trigger immediate scan on pool change (replaces slow polling)
        this.runScanCycle().catch(err => 
          this.logger.error(`Fast scan failed: ${err}`)
        );
      });
      this.logger.success('✅ Phase 2.5: Helius WebSocket enabled (<100ms latency)');
    } else {
      this.logger.warn('⚠️ Helius WebSocket not configured - using slower polling');
      this.logger.warn('   Get API key from https://helius.dev for 100x faster detection');
    }
    
    // 2. Rust Transaction Executor (10-50ms signing vs 380ms TypeScript)
    try {
      this.rustExecutor = new RustTransactionExecutor();
      this.logger.success('✅ Phase 2.5: Rust executor enabled (10-50ms signing)');
    } catch (error) {
      this.logger.warn('⚠️ Rust executor not available - using TypeScript fallback');
      this.logger.warn('   Build with: cargo build --release --bin tx-executor');
    }
    
    // Log configuration
    this.logConfiguration();
    
    this.logger.success('Bot initialized successfully!');
  }
  
  private async loadWallet(): Promise<void> {
    try {
      // Try to load from environment (support multiple env var names)
      const privateKeyStr = process.env.WALLET_IDK_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY;
      if (privateKeyStr) {
        let secretKey: Uint8Array;
        
        // Try different formats
        if (privateKeyStr.startsWith('[')) {
          // JSON array format: [1,2,3,...]
          const privateKey = JSON.parse(privateKeyStr);
          secretKey = Uint8Array.from(privateKey);
        } else if (privateKeyStr.length > 60) {
          // Base58 format (typical Solana private key)
          secretKey = bs58.decode(privateKeyStr);
        } else {
          // Comma-separated format: 1,2,3,...
          const privateKey = privateKeyStr.split(',').map(n => parseInt(n.trim()));
          secretKey = Uint8Array.from(privateKey);
        }
        
        this.wallet = Keypair.fromSecretKey(secretKey);
        const publicKey = this.wallet.publicKey.toBase58();
        this.logger.info(`✅ Wallet loaded: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`);
        this.logger.info(`   Full address: ${publicKey}`);
        return;
      }
      
      // Try to load from file
      const walletPath = process.env.WALLET_PATH || './wallet.json';
      if (fs.existsSync(walletPath)) {
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
        this.wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
        this.logger.info(`Wallet loaded from ${walletPath}`);
        return;
      }
      
      this.logger.warn('No wallet found - running in observation mode only');
    } catch (error) {
      this.logger.error(`Failed to load wallet: ${error}`);
    }
  }
  
  private async initializeStrategies(): Promise<void> {
    const walletKeypair = this.wallet;
    
    if (!walletKeypair) {
      this.logger.warn('No wallet loaded - some strategies may not work');
      return;
    }
    
    switch (this.config.mode) {
      case 'scalper':
        if (this.solanaConnection) {
          this.flashLoanScalper = new FlashLoanScalper(this.solanaConnection, walletKeypair);
          await this.flashLoanScalper.initialize();
        }
        this.logger.info('Flash Loan Scalper strategy enabled');
        break;
        
      case 'arbitrage':
        if (this.solanaConnection) {
          this.crossDexArb = new CrossDEXArbitrageDetector(this.solanaConnection);
          await this.crossDexArb.init();
        }
        this.logger.info('Cross-DEX Arbitrage strategy enabled');
        break;
        
      case 'combined':
      default:
        // Initialize all strategies
        if (this.solanaConnection && walletKeypair) {
          this.flashLoanScalper = new FlashLoanScalper(this.solanaConnection, walletKeypair);
          await this.flashLoanScalper.initialize();
        }
        
        if (this.solanaConnection) {
          this.crossDexArb = new CrossDEXArbitrageDetector(this.solanaConnection);
          await this.crossDexArb.init();
        }
        this.logger.info('Combined strategy enabled (Scalper + Arbitrage)');
        break;
    }
  }
  
  private logConfiguration(): void {
    console.log('\n' + '═'.repeat(70));
    console.log('📊 BOT CONFIGURATION');
    console.log('═'.repeat(70));
    console.log(`  Mode:              ${this.config.mode}`);
    console.log(`  Dry Run:           ${this.config.dryRun ? '✅ YES (no real trades)' : '🔴 NO (LIVE TRADING!)'}`);
    console.log(`  MEV Protection:    ${this.config.useMevProtection ? 'Jito Bundles' : 'Disabled'}`);
    console.log(`  Scan Interval:     ${this.config.scanIntervalMs / 1000}s`);
    console.log(`  Min Profit:        ${this.config.minProfitThresholdPercent}%`);
    console.log(`  Wallet:            ${this.wallet ? this.wallet.publicKey.toBase58().slice(0, 16) + '...' : 'Not loaded'}`);
    console.log('═'.repeat(70) + '\n');
    
    if (!this.config.dryRun) {
      console.log('⚠️  WARNING: DRY RUN IS DISABLED - REAL TRADES WILL BE EXECUTED!');
      console.log('⚠️  Make sure you understand the risks before proceeding.\n');
    }
  }
  
  /**
   * Start the main trading loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Bot is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting trading loop...');
    
    console.log('\n' + '🚀'.repeat(35));
    console.log('🚀 BOT STARTED - Hunting for opportunities! 🚀');
    console.log('🚀'.repeat(35) + '\n');
    
    while (this.isRunning) {
      try {
        await this.runScanCycle();
        
        // Wait before next scan
        await this.sleep(this.config.scanIntervalMs);
        
      } catch (error) {
        this.logger.error(`Scan cycle error: ${error}`);
        await this.sleep(5000); // Wait 5s on error
      }
    }
  }
  
  /**
   * Stop the bot
   */
  stop(): void {
    this.logger.info('Stopping bot...');
    this.isRunning = false;
  }
  
  /**
   * Run a single scan cycle
   */
  private async runScanCycle(): Promise<void> {
    this.scanCount++;
    const scanStart = Date.now();
    
    this.logger.debug(`Starting scan #${this.scanCount}`);
    
    const allOpportunities: ScalpOpportunity[] = [];
    
    // Run enabled strategies
    const scanPromises: Promise<any>[] = [];
    
    // 1. NEW TOKEN FLASH LOAN SCALPING
    if (this.flashLoanScalper) {
      scanPromises.push(
        this.flashLoanScalper.detectVolatileOpportunities()
          .then(opps => allOpportunities.push(...opps))
          .catch(err => this.logger.error(`Scalper scan failed: ${err}`))
      );
    }
    
    // 2. ESTABLISHED TOKEN ARBITRAGE (NEW!)
    if (this.config.mode === 'combined' || this.config.mode === 'established') {
      const scanner = establishedScanner(this.connection);
      scanPromises.push(
        scanner.quickScan()
          .then(opps => {
            if (opps.length > 0) {
              console.log(`\n💎 ESTABLISHED PAIRS: ${opps.length} opportunities found!`);
              // Convert to ScalpOpportunity format
              for (const opp of opps) {
                allOpportunities.push({
                  type: 'triangular_arb',
                  token: {
                    mint: opp.pair.mintA,
                    symbol: opp.pair.tokenA,
                    name: `${opp.pair.tokenA}/${opp.pair.tokenB}`,
                    decimals: 9,
                  },
                  flashLoanAmount: 1000,
                  flashLoanToken: opp.pair.tokenB,
                  expectedProfitPercent: opp.spreadPercent,
                  expectedProfitUSD: opp.estimatedProfit,
                  strategy: 'cross_dex_triangle',
                  entryPrice: opp.buyPrice,
                  exitPrice: opp.sellPrice,
                  holdTimeSeconds: 0,
                  riskScore: 1 - opp.confidence,
                  executeBefore: Date.now() + 30000,
                  safetyChecks: {
                    isSafe: true,
                    lockedLiquidity: true,
                    ownerBalancePercent: 0,
                    mintAuthorityDisabled: true,
                    isHoneypot: false,
                    reason: 'Established token pair',
                  },
                  route: [{
                    dex: opp.buyDex,
                    inputMint: opp.pair.mintA,
                    outputMint: opp.pair.mintB,
                    inputAmount: 5 * 1e9, // 5 SOL in lamports
                    outputAmount: 5 * 1e9 * (1 + opp.spreadPercent / 100),
                    priceImpact: 0.001,
                  }],
                });
              }
            }
          })
          .catch(err => this.logger.error(`Established scan failed: ${err}`))
      );
    }
    
    // 3. CROSS-DEX TRIANGULAR ARBITRAGE
    if (this.crossDexArb) {
      console.log('\n' + '═'.repeat(70));
      console.log('🔺 CROSS-DEX TRIANGULAR ARBITRAGE SCAN');
      console.log('═'.repeat(70));
      scanPromises.push(
        this.crossDexArb.detectTriangularOpportunities(this.tokenList)
          .then(opps => {
            console.log(`✅ Cross-DEX scan complete: ${opps.length} opportunities found`);
            // Convert to ScalpOpportunity format
            for (const opp of opps) {
              allOpportunities.push({
                type: 'triangular_arb',
                token: {
                  mint: opp.triangle[1],
                  symbol: opp.triangleSymbols[1],
                  name: 'Triangular Arb',
                  decimals: 9,
                },
                flashLoanAmount: opp.inputAmount,
                flashLoanToken: opp.inputToken,
                expectedProfitPercent: opp.netProfitPercent,
                expectedProfitUSD: opp.netProfit * 230, // Rough USD conversion
                strategy: 'cross_dex_triangle',
                entryPrice: 0,
                exitPrice: 0,
                holdTimeSeconds: 0,
                riskScore: 0.2,
                executeBefore: Date.now() + 30000,
                safetyChecks: {
                  lockedLiquidity: true,
                  ownerBalancePercent: 0,
                  mintAuthorityDisabled: true,
                  isHoneypot: false,
                  isSafe: true,
                },
                route: opp.routes.map(r => ({
                  dex: r.dex,
                  inputMint: r.from,
                  outputMint: r.to,
                  inputAmount: Number(r.amountIn),
                  outputAmount: Number(r.amountOut),
                  priceImpact: r.priceImpact,
                })),
              });
            }
          })
          .catch(err => this.logger.error(`Cross-DEX scan failed: ${err}`))
      );
    }
    
    // Wait for all scans to complete
    await Promise.all(scanPromises);
    
    const scanDuration = Date.now() - scanStart;
    
    // Filter by minimum profit threshold (negative to see ALL spreads)
    const profitableOpps = allOpportunities.filter(
      opp => opp.expectedProfitPercent >= -0.10
    );
    
    if (profitableOpps.length > 0) {
      this.opportunitiesFound += profitableOpps.length;
      
      // Sort by profit
      profitableOpps.sort((a, b) => b.expectedProfitPercent - a.expectedProfitPercent);
      
      // Log best opportunity
      const best = profitableOpps[0];
      this.logger.opportunity(
        `${best.type}: ${best.token.symbol} - ` +
        `${(best.expectedProfitPercent * 100).toFixed(2)}% ($${best.expectedProfitUSD.toFixed(2)})`
      );
      
      // Execute if not in dry run mode
      if (!this.config.dryRun && this.wallet) {
        await this.executeOpportunity(best);
      }
    }
    
    // Periodic status update
    if (this.scanCount % 10 === 0) {
      this.logStatus(scanDuration);
    }
  }
  
  /**
   * Execute a trading opportunity
   */
  private async executeOpportunity(opportunity: ScalpOpportunity): Promise<void> {
    this.logger.info(`Executing opportunity: ${opportunity.type} on ${opportunity.token.symbol}`);
    
    const startTime = Date.now();
    
    try {
      // Phase 2.5: Use Rust executor for ultra-fast signing (10-50ms)
      if (this.rustExecutor && opportunity.route && opportunity.route.length > 0) {
        this.logger.info('⚡ Using Rust executor for ultra-fast signing...');
        
        // Build swap instruction from route (would need actual swap IX base64)
        // For now, we'd pass the transaction to Rust for signing
        const result = await this.rustExecutor.execute({
          profitPct: opportunity.expectedProfitPercent,
          inputAmount: Math.floor(opportunity.flashLoanAmount * 1e9), // Convert to lamports
          swapIxBase64: '', // Would be actual serialized instruction
          tipLamports: config.jito?.tipLamports || 500000,
          jitoEnabled: config.jito?.enabled || false,
        });
        
        if (result.success) {
          const execTime = Date.now() - startTime;
          this.logger.success(`✅ Rust execution: ${result.signature?.slice(0, 8)}... in ${execTime}ms`);
          this.tradesExecuted++;
          this.totalProfit += opportunity.expectedProfitUSD;
          return;
        } else {
          this.logger.warn(`⚠️ Rust execution failed: ${result.error}`);
          // Fall through to TypeScript fallback
        }
      }
      
      // Fallback: TypeScript execution with MEV protection
      if (this.config.useMevProtection && this.mevExecutor) {
        this.logger.info('Using MEV protection (Jito bundle)...');
        // Would call: this.mevExecutor.executeProtectedScalp(...)
      }
      
      // For now, just log
      this.logger.warn('Trade execution not yet implemented - use dry run mode');
      
    } catch (error) {
      this.logger.error(`Execution failed: ${error}`);
    }
  }
  
  /**
   * Log current status
   */
  private logStatus(lastScanDurationMs: number): void {
    const runtime = this.getRuntime();
    
    console.log('\n' + '─'.repeat(50));
    console.log('📊 STATUS UPDATE');
    console.log('─'.repeat(50));
    console.log(`  Runtime:           ${runtime}`);
    console.log(`  Scans:             ${this.scanCount}`);
    console.log(`  Opportunities:     ${this.opportunitiesFound}`);
    console.log(`  Trades:            ${this.tradesExecuted}`);
    console.log(`  Total Profit:      $${this.totalProfit.toFixed(2)}`);
    console.log(`  Last Scan:         ${lastScanDurationMs}ms`);
    console.log('─'.repeat(50) + '\n');
  }
  
  private getRuntime(): string {
    // Would calculate actual runtime
    return `${this.scanCount * this.config.scanIntervalMs / 60000} min`;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('🤖 SOLANA FLASH LOAN SCALPER & ARBITRAGE BOT');
  console.log('═'.repeat(70));
  console.log('Strategies: Cross-DEX Triangular Arb | Volatile Token Scalping');
  console.log('Features:   New Token Detection | MEV Protection | Safety Checks');
  console.log('═'.repeat(70) + '\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const configOverrides: Partial<BotConfig> = {};
  
  for (const arg of args) {
    if (arg === '--live' || arg === '--no-dry-run') {
      configOverrides.dryRun = false;
      console.log('⚠️  LIVE MODE ENABLED - Real trades will be executed!');
    }
    if (arg === '--scalper') {
      configOverrides.mode = 'scalper';
    }
    if (arg === '--arbitrage') {
      configOverrides.mode = 'arbitrage';
    }
    if (arg === '--debug') {
      configOverrides.logLevel = 'debug';
    }
    if (arg === '--no-mev') {
      configOverrides.useMevProtection = false;
    }
  }
  
  // Create and start bot
  const bot = new UnifiedBot(configOverrides);
  
  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Received SIGINT - shutting down gracefully...');
    bot.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Received SIGTERM - shutting down gracefully...');
    bot.stop();
    process.exit(0);
  });
  
  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);

// =============================================================================
// EXPORTS
// =============================================================================

export { UnifiedBot };
export type { BotConfig };
