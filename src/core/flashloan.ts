import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { FlashloanProvider } from '../types/index.js';
import { SolanaConnection } from './connection.js';
import { GasOptimizer } from '../utils/gas-optimizer.js';
import BN from 'bn.js';

// Import official Solend SDK instructions directly using static imports
import { flashBorrowReserveLiquidityInstruction } from '@solendprotocol/solend-sdk/instructions/flashBorrowReserveLiquidity';
import { flashRepayReserveLiquidityInstruction } from '@solendprotocol/solend-sdk/instructions/flashRepayReserveLiquidity';

// Solend Main Pool reserve configurations
const SOLEND_RESERVES: Record<string, {
  reserveAddress: string;
  liquiditySupplyAddress: string;
  liquidityFeeReceiverAddress: string;
  mint: string;
  decimals: number;
}> = {
  // SOL reserve in main pool
  'So11111111111111111111111111111111111111112': {
    reserveAddress: '8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36',
    liquiditySupplyAddress: '8UviNr47S8eL6J3WfDxMRa3hvLta1VDJwNWqsDgtN3Cv',
    liquidityFeeReceiverAddress: '5wo1tFpi4HaVKnemqaXeQnBEpezrJXcXvuztYaPhvgC7',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  // USDC reserve in main pool
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    reserveAddress: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
    liquiditySupplyAddress: '8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf',
    liquidityFeeReceiverAddress: '5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
};

// Solend Main Pool lending market
const SOLEND_MAIN_POOL = new PublicKey('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY');
const SOLEND_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');

export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'solend';
  programId = SOLEND_PROGRAM_ID;
  maxAmount = 1000000; // 1M USD
  fee = 0.003; // 0.3% flash loan fee
  private gasOptimizer: GasOptimizer;

  constructor(private solanaConnection: SolanaConnection) {
    this.gasOptimizer = new GasOptimizer(solanaConnection.getConnection());
  }

  async isAvailable(): Promise<boolean> {
    try {
      const accountInfo = await this.solanaConnection
        .getConnection()
        .getAccountInfo(this.programId);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  calculateFee(amount: number): number {
    return amount * this.fee;
  }

  getReserveConfig(mint: PublicKey): typeof SOLEND_RESERVES[string] | null {
    return SOLEND_RESERVES[mint.toBase58()] || null;
  }

  createFlashBorrowInstruction(
    liquidityAmount: BN,
    sourceLiquidity: PublicKey,
    destinationLiquidity: PublicKey,
    reserve: PublicKey,
  ): TransactionInstruction {
    // The Solend SDK accepts BN directly – pass liquidityAmount as-is.
    return flashBorrowReserveLiquidityInstruction(
      liquidityAmount,
      sourceLiquidity,
      destinationLiquidity,
      reserve,
      SOLEND_MAIN_POOL,
      this.programId
    );
  }

  createFlashRepayInstruction(
    liquidityAmount: BN,
    borrowInstructionIndex: number,
    sourceLiquidity: PublicKey,
    destinationLiquidity: PublicKey,
    reserveLiquidityFeeReceiver: PublicKey,
    hostFeeReceiver: PublicKey,
    reserve: PublicKey,
    userTransferAuthority: PublicKey,
  ): TransactionInstruction {
    // Use official Solend SDK function to create the instruction
    // Signature: flashRepayReserveLiquidityInstruction(liquidityAmount, borrowInstructionIndex, sourceLiquidity, destinationLiquidity, reserveLiquidityFeeReceiver, hostFeeReceiver, reserve, lendingMarket, userTransferAuthority, lendingProgramId)
    return flashRepayReserveLiquidityInstruction(
      liquidityAmount,
      borrowInstructionIndex,
      sourceLiquidity,
      destinationLiquidity,
      reserveLiquidityFeeReceiver,
      hostFeeReceiver,
      reserve,
      SOLEND_MAIN_POOL,
      userTransferAuthority,
      this.programId
    );
  }

  async createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    arbitrageInstructions: TransactionInstruction[],
    walletPubkey?: PublicKey
  ): Promise<{
    instructions: TransactionInstruction[];
    gasEstimate: any;
    flashLoanAmount: number;
    totalCost: number;
  }> {
    const reserveConfig = this.getReserveConfig(mint);
    if (!reserveConfig) {
      throw new Error(`No reserve config found for mint ${mint.toBase58()}`);
    }

    if (!walletPubkey) {
      throw new Error('Wallet public key is required for flash loan');
    }

    const flashloanInstructions: TransactionInstruction[] = [];
    
    // Get the reserve details
    const reserve = new PublicKey(reserveConfig.reserveAddress);
    const sourceLiquidity = new PublicKey(reserveConfig.liquiditySupplyAddress);
    const reserveFeeReceiver = new PublicKey(reserveConfig.liquidityFeeReceiverAddress);
    
    // User's token account for this mint
    const userTokenAccount = await getAssociatedTokenAddress(mint, walletPubkey);
    
    // Check if user has token account, if not create it
    const connection = this.solanaConnection.getConnection();
    const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
    if (!tokenAccountInfo) {
      flashloanInstructions.push(
        createAssociatedTokenAccountInstruction(
          walletPubkey,
          userTokenAccount,
          walletPubkey,
          mint
        )
      );
    }

    // Build temporary transaction to estimate gas
    const tempTx = new Transaction();
    tempTx.add(...flashloanInstructions, ...arbitrageInstructions);
    
    // Estimate gas for flash loan transaction (includes buffer)
    const gasEstimate = await this.gasOptimizer.estimateGas(tempTx, true, true);
    
    // Calculate flash loan amount WITH gas buffer
    // Need to borrow: targetAmount + gas + flashLoanFee
    const amountInLamports = Math.floor(amount * Math.pow(10, reserveConfig.decimals));
    const flashLoanAmount = this.gasOptimizer.calculateFlashLoanAmount(
      amountInLamports,
      gasEstimate,
      this.fee
    );
    
    const liquidityAmountRaw = new BN(flashLoanAmount);
    
    // 1. Flash borrow instruction (index will be 0 or 1 depending on ATA creation)
    const borrowInstructionIndex = flashloanInstructions.length;
    const borrowInstruction = this.createFlashBorrowInstruction(
      liquidityAmountRaw,
      sourceLiquidity,
      userTokenAccount,
      reserve,
    );
    flashloanInstructions.push(borrowInstruction);

    // 2. Add user's arbitrage instructions
    flashloanInstructions.push(...arbitrageInstructions);

    // 3. Flash repay instruction
    const repayInstruction = this.createFlashRepayInstruction(
      liquidityAmountRaw,
      borrowInstructionIndex,
      userTokenAccount,
      sourceLiquidity,
      reserveFeeReceiver,
      reserveFeeReceiver, // Using same as fee receiver for host fee
      reserve,
      walletPubkey,
    );
    flashloanInstructions.push(repayInstruction);

    return {
      instructions: flashloanInstructions,
      gasEstimate,
      flashLoanAmount,
      totalCost: gasEstimate.totalCost + Math.floor(flashLoanAmount * this.fee),
    };
  }
}

export class MangoFlashloanProvider implements FlashloanProvider {
  name = 'mango';
  programId = new PublicKey('mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68');
  maxAmount = 5000000; // 5M USD
  fee = 0.0001; // 0.01%

  constructor(private solanaConnection: SolanaConnection) {}

  async isAvailable(): Promise<boolean> {
    try {
      const accountInfo = await this.solanaConnection
        .getConnection()
        .getAccountInfo(this.programId);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  calculateFee(amount: number): number {
    return amount * this.fee;
  }

  async createFlashloanInstructions(
    _amount: number,
    _mint: PublicKey,
    _instructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]> {
    // Not fully implemented
    return [];
  }
}

export class FlashloanManager {
  private providers: Map<string, FlashloanProvider> = new Map();
  private solendProvider: SolendFlashloanProvider;
  private gasOptimizer: GasOptimizer;

  constructor(private solanaConnection: SolanaConnection) {
    this.solendProvider = new SolendFlashloanProvider(this.solanaConnection);
    this.gasOptimizer = new GasOptimizer(this.solanaConnection.getConnection());
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.providers.set('solend', this.solendProvider);
    this.providers.set('mango', new MangoFlashloanProvider(this.solanaConnection));
  }

  async getBestProvider(amount: number): Promise<FlashloanProvider | null> {
    const availableProviders: FlashloanProvider[] = [];
    
    for (const provider of this.providers.values()) {
      // Skip Mango for now as it's not fully implemented
      if (provider.name === 'mango') continue;
      
      if (await provider.isAvailable() && provider.maxAmount >= amount) {
        availableProviders.push(provider);
      }
    }
    
    if (availableProviders.length === 0) {
      return null;
    }
    
    // Return provider with lowest fee
    return availableProviders.reduce((best, current) =>
      current.calculateFee(amount) < best.calculateFee(amount) ? current : best
    );
  }

  getSolendProvider(): SolendFlashloanProvider {
    return this.solendProvider;
  }

  async executeFlashloan(
    provider: FlashloanProvider,
    amount: number,
    mint: PublicKey,
    arbitrageInstructions: TransactionInstruction[],
    walletPubkey: PublicKey,
    useJito: boolean = true
  ): Promise<{
    success: boolean;
    signature?: string;
    method: 'jito' | 'rpc';
    profit?: {
      grossProfit: number;
      netProfit: number;
      isProfitable: boolean;
      profitInSOL: number;
    };
    error?: string;
  }> {
    if (provider instanceof SolendFlashloanProvider) {
      const result = await provider.createFlashloanInstructions(
        amount,
        mint,
        arbitrageInstructions,
        walletPubkey
      );
      
      const transaction = new Transaction();
      transaction.add(...result.instructions);
      
      // Submit via Jito (with fallback to RPC)
      const submitResult = await this.gasOptimizer.submitTransactionSafe(
        transaction,
        result.gasEstimate,
        useJito
      );
      
      if (submitResult.success) {
        // Calculate net profit (needs gross profit from arbitrage)
        // This would be calculated by the calling code after getting token balances
        return {
          success: true,
          signature: submitResult.signature,
          method: submitResult.method,
          profit: {
            grossProfit: 0,  // To be filled by caller
            netProfit: 0,    // To be filled by caller
            isProfitable: false,
            profitInSOL: 0,
          },
        };
      }
      
      return {
        success: false,
        method: submitResult.method,
        error: submitResult.error,
      };
    }
    
    throw new Error(`Unsupported flashloan provider: ${provider.name}`);
  }

  /**
   * Calculate if arbitrage is profitable after all costs
   */
  calculateProfitability(
    startBalance: number,
    endBalance: number,
    gasEstimate: any,
    flashLoanAmount: number,
    flashLoanFeePct: number = 0.003
  ): {
    grossProfit: number;
    gasCost: number;
    flashLoanFee: number;
    netProfit: number;
    isProfitable: boolean;
    profitInSOL: number;
    roi: number;
  } {
    const grossProfit = endBalance - startBalance;
    
    const profitCalc = this.gasOptimizer.calculateNetProfit(
      grossProfit,
      gasEstimate,
      flashLoanAmount,
      flashLoanFeePct
    );
    
    const roi = flashLoanAmount > 0 ? (profitCalc.netProfit / flashLoanAmount) * 100 : 0;
    
    return {
      ...profitCalc,
      roi,
    };
  }
}
