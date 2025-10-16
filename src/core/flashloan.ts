import { 
  PublicKey, 
  Transaction, 
  TransactionInstruction, 
  Keypair,
  SystemProgram 
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync 
} from '@solana/spl-token';
import { struct, u8 } from '@solana/buffer-layout';
import { u64 } from '@solana/buffer-layout-utils';
import { FlashloanProvider } from '../types/index.js';
import { SolanaConnection } from './connection.js';

// SPL Token Lending Program ID (Solend uses this)
const LENDING_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');

enum LendingInstruction {
  InitLendingMarket = 0,
  SetLendingMarketOwner = 1,
  InitReserve = 2,
  RefreshReserve = 3,
  DepositReserveLiquidity = 4,
  RedeemReserveCollateral = 5,
  InitObligation = 6,
  RefreshObligation = 7,
  DepositObligationCollateral = 8,
  WithdrawObligationCollateral = 9,
  BorrowObligationLiquidity = 10,
  RepayObligationLiquidity = 11,
  LiquidateObligation = 12,
  FlashLoan = 13,
}

interface FlashLoanData {
  instruction: number;
  liquidityAmount: bigint;
}

const FlashLoanDataLayout = struct<FlashLoanData>([
  u8('instruction'), 
  u64('liquidityAmount')
]);

// Known Solend reserves on mainnet (updated with real Solend data)
const SOLEND_RESERVES = {
  USDC: {
    reserve: new PublicKey('BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw'),
    liquiditySupply: new PublicKey('8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf'),
    feeReceiver: new PublicKey('4Ru8F3hwF4FJNrXJ7L8tKXJ5uL3LN2WnpJH1SG3rpEtP'),
    hostFeeReceiver: new PublicKey('8c6ZjMUk4Pkn2kX4vhfPgJ1KbFh6r5v5ZMzD7VdT3GK4'),
    lendingMarket: new PublicKey('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'),
    mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
  },
  SOL: {
    reserve: new PublicKey('8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36'),
    liquiditySupply: new PublicKey('8UviNr47S8eL6J3WfDxMRa3hvLta1VDJwNWqsDgtN6Kc'),
    feeReceiver: new PublicKey('2b3XiWWCPC1Q3Nv6LJqgNqnq5zGTxBDzJfCj1J5V3zFu'),
    hostFeeReceiver: new PublicKey('8c6ZjMUk4Pkn2kX4vhfPgJ1KbFh6r5v5ZMzD7VdT3GK4'),
    lendingMarket: new PublicKey('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'),
    mint: new PublicKey('So11111111111111111111111111111111111111112'), // Wrapped SOL
  }
};

export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'solend';
  programId = LENDING_PROGRAM_ID;
  maxAmount = 1000000; // 1M USD
  fee = 0.0003; // 0.03% (3000000000000000 WAD)

  constructor(private solanaConnection: SolanaConnection) {}

  async isAvailable(): Promise<boolean> {
    try {
      // Check if SPL Token Lending program is available
      const accountInfo = await this.solanaConnection
        .getConnection()
        .getAccountInfo(this.programId);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  calculateFee(amount: number): number {
    return Math.floor(amount * this.fee);
  }

  async createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    userInstructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]> {
    // Get reserve info based on mint
    const reserveInfo = this.getReserveByMint(mint);
    if (!reserveInfo) {
      throw new Error(`No Solend reserve found for mint: ${mint.toString()}`);
    }

    console.log(`Creating flashloan for ${amount} tokens using ${this.name}`);
    console.log(`Using reserve: ${reserveInfo.reserve.toString()}`);
    console.log(`Liquidity supply: ${reserveInfo.liquiditySupply.toString()}`);
    
    // For now, return a placeholder implementation that shows the correct structure
    // A full implementation would require:
    // 1. Deploy a receiver program that handles the flashloan logic
    // 2. Create proper instruction data encoding
    // 3. Handle repayment + fees in the same transaction
    
    const flashloanInstructions: TransactionInstruction[] = [];
    
    console.log('⚠️  WARNING: This is a demonstration implementation');
    console.log('Real flashloan requires deploying a receiver program');
    console.log('For production use, integrate with @solendprotocol/solend-sdk');
    
    // Add user's arbitrage instructions (they would be wrapped by flashloan logic)
    flashloanInstructions.push(...userInstructions);
    
    return flashloanInstructions;
  }

  private createFlashLoanInstruction(
    liquidityAmount: number,
    sourceLiquidity: PublicKey,
    destinationLiquidity: PublicKey,
    liquidityReserve: PublicKey,
    flashLoanFeeReceiver: PublicKey,
    hostFeeReceiver: PublicKey,
    lendingMarket: PublicKey,
    flashLoanProgram: PublicKey
  ): TransactionInstruction {
    const data = Buffer.alloc(FlashLoanDataLayout.span);
    FlashLoanDataLayout.encode(
      {
        instruction: LendingInstruction.FlashLoan,
        liquidityAmount: BigInt(liquidityAmount),
      },
      data
    );

    // Get lending market authority (PDA)
    const lendingMarketAuthority = PublicKey.findProgramAddressSync(
      [lendingMarket.toBuffer()],
      this.programId
    )[0];

    const keys = [
      { pubkey: sourceLiquidity, isSigner: false, isWritable: true },
      { pubkey: destinationLiquidity, isSigner: false, isWritable: true },
      { pubkey: liquidityReserve, isSigner: false, isWritable: true },
      { pubkey: flashLoanFeeReceiver, isSigner: false, isWritable: true },
      { pubkey: hostFeeReceiver, isSigner: false, isWritable: true },
      { pubkey: lendingMarket, isSigner: false, isWritable: false },
      { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: flashLoanProgram, isSigner: false, isWritable: false },
      { pubkey: this.solanaConnection.getWallet().publicKey, isSigner: true, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: this.programId,
      data,
    });
  }

  private getReserveByMint(mint: PublicKey): typeof SOLEND_RESERVES.USDC | null {
    for (const reserve of Object.values(SOLEND_RESERVES)) {
      if (reserve.mint.equals(mint)) {
        return reserve;
      }
    }
    return null;
  }
}

export class FlashloanManager {
  private providers: Map<string, FlashloanProvider> = new Map();

  constructor(private solanaConnection: SolanaConnection) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Only initialize working providers
    this.providers.set('solend', new SolendFlashloanProvider(this.solanaConnection));
    // Mango removed due to implementation complexity and unsupported status
  }

  async getBestProvider(amount: number): Promise<FlashloanProvider | null> {
    const availableProviders: FlashloanProvider[] = [];
    
    for (const provider of this.providers.values()) {
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

  async executeFlashloan(
    provider: FlashloanProvider,
    amount: number,
    mint: PublicKey,
    arbitrageInstructions: TransactionInstruction[]
  ): Promise<string> {
    if (provider instanceof SolendFlashloanProvider) {
      const instructions = await provider.createFlashloanInstructions(
        amount,
        mint,
        arbitrageInstructions
      );
      
      const transaction = new Transaction();
      transaction.add(...instructions);
      
      return await this.solanaConnection.sendTransaction(transaction);
    }
    
    throw new Error(`Unsupported flashloan provider: ${provider.name}`);
  }
}