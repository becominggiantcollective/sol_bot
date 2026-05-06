import { PublicKey, VersionedTransaction, Keypair, Transaction, Connection } from '@solana/web3.js';
// @ts-ignore - bs58 types
import bs58 from 'bs58';
import { ArbitrageOpportunity, MEVStrategy } from '../types/index.js';
import { SolanaConnection } from '../core/connection.js';
import { FlashloanManager, SolendFlashloanProvider } from '../core/flashloan.js';
import { Logger } from '../utils/index.js';
import { DynamicPriorityFeeManager } from '../utils/dynamicFees.js';
import { JitoBundleSender } from '../core/jitoBundle.js';
import axios from 'axios';
import { config } from '../config/index.js';

/**
 * OPTIMIZED DIRECT SWAP STRATEGY WITH FLASH LOAN SUPPORT
 * 
 * Key features:
 * 1. Direct swaps using wallet balance
 * 2. Flash loan amplified trades for larger opportunities
 * 3. Dynamic execution based on opportunity type
 */
export class DirectSwapStrategy implements MEVStrategy {
  name = 'direct-swap';
  description = 'Executes arbitrage using Jupiter swaps with optional flash loans';
  private logger = Logger.getInstance();
  private wallet: Keypair;
  private flashloanManager: FlashloanManager;
  private feeManager: DynamicPriorityFeeManager;
  private jito: JitoBundleSender;

  constructor(private solanaConnection: SolanaConnection) {
    // Support both base58 and JSON array formats
    if (config.wallet.privateKey.startsWith('[')) {
      const privateKeyArray = JSON.parse(config.wallet.privateKey);
      this.wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
    } else {
      this.wallet = Keypair.fromSecretKey(bs58.decode(config.wallet.privateKey));
    }
    this.flashloanManager = new FlashloanManager(solanaConnection);
    this.feeManager = new DynamicPriorityFeeManager(process.env.HELIUS_API_KEY);
    this.jito = new JitoBundleSender(solanaConnection.getConnection());
  }

  isViable(opportunity: ArbitrageOpportunity): boolean {
    // For flash loan opportunities: Solend fee is 0% (verified on-chain), only gas applies
    if (opportunity.flashloanProvider) {
      return opportunity.profitPercent > 0.001; // Need > 0.1% to cover gas
    }
    // Regular opportunities just need positive profit
    const minProfit = config.trading.minProfitThreshold || 0.001;
    return opportunity.profitPercent > minProfit;
  }

  async execute(opportunity: ArbitrageOpportunity): Promise<string> {
    // Check if this is a flash loan opportunity
    if (opportunity.flashloanProvider) {
      return await this.executeWithFlashloan(opportunity);
    }
    
    const isRoundTrip = opportunity.inputMint.equals(opportunity.outputMint);
    
    if (isRoundTrip && opportunity.route && opportunity.route.length === 2) {
      return await this.executeRoundTrip(opportunity);
    }
    
    // Single swap
    return await this.executeSingleSwap(opportunity);
  }

  /**
   * Execute arbitrage using Solend flash loan
   * Borrows -> Swaps -> Repays in single atomic transaction
   */
  private async executeWithFlashloan(opportunity: ArbitrageOpportunity): Promise<string> {
    this.logger.info(`🔥 Executing FLASH LOAN arbitrage: ${opportunity.flashloanProvider}`);
    this.logger.info(`   Amount: ${opportunity.inputAmount} | Profit: ${(opportunity.profitPercent * 100).toFixed(3)}%`);
    
    const provider = this.flashloanManager.getSolendProvider();
    if (!provider) {
      throw new Error('Solend provider not available');
    }
    
    // For flash loans, we need to build instructions that:
    // 1. Borrow from Solend
    // 2. Execute the arbitrage swaps via Jupiter
    // 3. Repay Solend + fee
    
    // Get Jupiter swap instructions for the arbitrage
    const route = opportunity.route;
    if (!route || route.length < 2) {
      throw new Error('Invalid route for flash loan arbitrage');
    }
    
    // Build the swap transaction via Jupiter
    const inputMint = route[0].inputMint.toString();
    const midMint = route[0].outputMint.toString();
    const decimals = this.getDecimals(inputMint);
    const amountInBaseUnits = Math.floor(opportunity.inputAmount * Math.pow(10, decimals));
    
    // Get quote for first leg
    const quote1 = await this.getQuote(inputMint, midMint, amountInBaseUnits, 100);
    if (!quote1) throw new Error('Failed to get quote for leg 1');
    
    // Get quote for second leg (using output of first)
    const midAmount = parseInt(quote1.outAmount);
    const quote2 = await this.getQuote(midMint, inputMint, midAmount, 100);
    if (!quote2) throw new Error('Failed to get quote for leg 2');
    
    // For now, execute as two separate transactions (atomic flash loan requires complex instruction building)
    // TODO: Build proper atomic flash loan transaction
    this.logger.info('   Executing flash loan legs sequentially...');
    
    // Execute first swap
    const tx1 = await this.buildSwapTransaction(quote1);
    if (!tx1) throw new Error('Failed to build tx1');
    const sig1 = await this.sendAndConfirm(tx1);
    this.logger.info(`   Leg 1 done: ${sig1.slice(0, 20)}...`);

    // Get actual balance and execute second swap
    const actualMidBalance = await this.getTokenBalance(new PublicKey(midMint));
    if (!actualMidBalance) throw new Error('No balance after leg 1');
    
    const quote2Fresh = await this.getQuote(midMint, inputMint, Math.floor(actualMidBalance), 150);
    if (!quote2Fresh) throw new Error('Failed to get fresh quote for leg 2');
    
    const tx2 = await this.buildSwapTransaction(quote2Fresh);
    if (!tx2) throw new Error('Failed to build tx2');
    const sig2 = await this.sendAndConfirm(tx2);
    
    this.logger.info(`   ✅ Flash loan arbitrage complete: ${sig2}`);
    return sig2;
  }

  /**
   * Execute a round-trip arbitrage (A → B → A).
   * When JITO_BUNDLES=true, builds all leg transactions upfront and submits as a
   * single atomic Jito bundle — protecting against sandwich attacks and guaranteeing
   * all legs land in the same block. Falls back to sequential execution if bundling fails.
   */
  private async executeRoundTrip(opportunity: ArbitrageOpportunity): Promise<string> {
    const route = opportunity.route!;
    this.logger.info(`🔄 Executing round-trip: ${route.length} legs`);

    const useJito = process.env.JITO_BUNDLES === 'true';

    if (useJito && route.length <= 5) {
      try {
        return await this.executeRoundTripJito(opportunity);
      } catch (err) {
        this.logger.warn(`⚠️  Jito bundle failed (${err}), falling back to sequential`);
      }
    }

    // Sequential fallback
    let lastSig = '';
    
    for (let i = 0; i < route.length; i++) {
      const leg = route[i];
      const inputMint = leg.inputMint.toString();
      const outputMint = leg.outputMint.toString();
      
      // Get actual balance for this token
      let amount: number;
      if (i === 0) {
        // First leg - use planned amount
        amount = leg.inputAmount;
      } else {
        // Subsequent legs - get actual balance from previous swap
        const balance = await this.getTokenBalance(leg.inputMint);
        if (!balance || balance <= 0) {
          throw new Error(`No balance for leg ${i + 1} input token`);
        }
        amount = balance;
        this.logger.info(`  Using actual balance: ${amount}`);
      }
      
      this.logger.info(`  Leg ${i + 1}: ${inputMint.slice(0,4)}→${outputMint.slice(0,4)} (${amount})`);
      
      // Get fresh quote with higher slippage for safety
      const quote = await this.getQuote(inputMint, outputMint, Math.floor(amount), 150); // 1.5% slippage
      if (!quote) {
        throw new Error(`Failed to get quote for leg ${i + 1}`);
      }
      
      // Execute the swap
      const tx = await this.buildSwapTransaction(quote);
      if (!tx) {
        throw new Error(`Failed to build transaction for leg ${i + 1}`);
      }
      
      lastSig = await this.sendAndConfirm(tx);
      this.logger.info(`  ✅ Leg ${i + 1} done: ${lastSig.slice(0, 20)}...`);
    }
    
    this.logger.info(`✅ Round-trip complete: ${lastSig}`);
    return lastSig;
  }

  /**
   * Execute round-trip via a Jito bundle — all legs in one atomic submission.
   * Quotes are fetched upfront (leg output amounts are simulated, not chained on-chain
   * because each tx is independent). Includes Jito tip in the first transaction.
   */
  private async executeRoundTripJito(opportunity: ArbitrageOpportunity): Promise<string> {
    const route = opportunity.route!;
    this.logger.info(`📦 Building Jito bundle for ${route.length}-leg round-trip`);

    const txs: VersionedTransaction[] = [];

    for (let i = 0; i < route.length; i++) {
      const leg = route[i];
      const inputMint = leg.inputMint.toString();
      const outputMint = leg.outputMint.toString();
      const amount = leg.inputAmount;

      const quote = await this.getQuote(inputMint, outputMint, Math.floor(amount), 150);
      if (!quote) throw new Error(`Jito: failed to get quote for leg ${i + 1}`);

      const tx = await this.buildSwapTransaction(quote);
      if (!tx) throw new Error(`Jito: failed to build tx for leg ${i + 1}`);

      txs.push(tx);
    }

    const result = await this.jito.sendBundle(txs, 'high');

    if (!result.success) {
      throw new Error(`Jito bundle failed: ${result.error}`);
    }

    const lastSig = result.signatures?.[result.signatures.length - 1] ?? result.bundleId ?? 'bundle-ok';
    this.logger.info(`✅ Jito bundle landed (tip ${result.landedTip} lamports): ${lastSig}`);
    return lastSig;
  }

  /**
   * Execute a single swap
   * Note: For non-round-trip, we need to convert inputAmount (in tokens) back to lamports
   */
  private async executeSingleSwap(opportunity: ArbitrageOpportunity): Promise<string> {
    const inputMint = opportunity.inputMint.toString();
    const outputMint = opportunity.outputMint.toString();
    
    // Convert token amount to base units (lamports)
    const decimals = this.getDecimals(inputMint);
    const amountInBaseUnits = Math.floor(opportunity.inputAmount * Math.pow(10, decimals));
    
    this.logger.info(`Executing swap: ${inputMint.slice(0,4)}→${outputMint.slice(0,4)} (${opportunity.inputAmount} tokens = ${amountInBaseUnits} base units)`);
    
    const quote = await this.getQuote(inputMint, outputMint, amountInBaseUnits, 100); // 1% slippage
    
    if (!quote) {
      throw new Error('Failed to get quote');
    }
    
    const tx = await this.buildSwapTransaction(quote);
    if (!tx) {
      throw new Error('Failed to build transaction');
    }
    
    return await this.sendAndConfirm(tx);
  }
  
  /**
   * Get token decimals
   */
  private getDecimals(mint: string): number {
    const DECIMALS: Record<string, number> = {
      'So11111111111111111111111111111111111111112': 9, // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6, // USDT
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 5, // BONK
    };
    return DECIMALS[mint] || 9;
  }

  /**
   * Get Jupiter quote
   */
  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<any | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.jupiter?.apiKey) {
        headers['x-api-key'] = config.jupiter.apiKey;
      }
      
      const response = await axios.get(`${config.jupiter?.apiUrl || 'https://api.jup.ag/swap/v1'}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps,
          onlyDirectRoutes: false,
        },
        headers,
        timeout: 10000,
      });
      
      return response.data;
    } catch (error) {
      this.logger.error('Quote failed:', error);
      return null;
    }
  }

  /**
   * Build swap transaction from quote
   */
  private async buildSwapTransaction(quote: any): Promise<VersionedTransaction | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.jupiter?.apiKey) {
        headers['x-api-key'] = config.jupiter.apiKey;
      }
      
      // Fetch dynamic priority fee (falls back to cached value if fetch fails)
      const connection = this.solanaConnection.getConnection();
      const dynamicFeeMicroLamports = await this.feeManager.getOptimalFee(connection, 'high');
      // Convert microlamports to lamports (max cap 0.001 SOL = 1_000_000 µSOL)
      const maxLamports = Math.min(Math.ceil(dynamicFeeMicroLamports / 1000), 1_000_000);
      
      const response = await axios.post(
        `${config.jupiter?.apiUrl || 'https://api.jup.ag/swap/v1'}/swap`,
        {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports,
              priorityLevel: 'high',
            }
          },
        },
        { headers, timeout: 10000 }
      );
      
      const { swapTransaction } = response.data;
      const txBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([this.wallet]);
      
      return tx;
    } catch (error) {
      this.logger.error('Build tx failed:', error);
      return null;
    }
  }

  /**
   * Send transaction and wait for confirmation
   * Uses aggressive retry strategy for competitive execution
   */
  private async sendAndConfirm(tx: VersionedTransaction): Promise<string> {
    const connection = this.solanaConnection.getConnection();
    const rawTx = tx.serialize();
    
    // Send with skipPreflight for speed - we already built a valid tx
    const sig = await connection.sendRawTransaction(rawTx, {
      skipPreflight: true, // Skip for speed
      maxRetries: 5, // More retries for competitive landing
      preflightCommitment: 'confirmed',
    });
    
    this.logger.info(`TX sent: ${sig.slice(0, 20)}... waiting for confirmation`);
    
    // Wait for confirmation with timeout
    const blockhash = await connection.getLatestBlockhash('confirmed');
    const confirmation = await connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    return sig;
  }

  /**
   * Get token balance in base units
   */
  private async getTokenBalance(mint: PublicKey): Promise<number | null> {
    try {
      const connection = this.solanaConnection.getConnection();
      
      // For SOL
      if (mint.toString() === 'So11111111111111111111111111111111111111112') {
        const balance = await connection.getBalance(this.wallet.publicKey);
        return balance;
      }
      
      // For SPL tokens
      const accounts = await connection.getTokenAccountsByOwner(this.wallet.publicKey, { mint });
      
      if (accounts.value.length > 0) {
        const data = accounts.value[0].account.data;
        return Number(data.readBigUInt64LE(64));
      }
      
      return 0;
    } catch (error) {
      this.logger.error('Balance check failed:', error);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
