import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { FlashloanProvider } from '../types';
import { SolanaConnection } from './connection';

// Utility function to convert number to little-endian bytes
function numberToLE64(num: number): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeUInt32LE(num & 0xffffffff, 0);
  buf.writeUInt32LE(Math.floor(num / 0x100000000), 4);
  return buf;
}

// Solend Program IDs and constants
const SOLEND_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const LENDING_MARKET = new PublicKey('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'); // Main market
const WSOL_RESERVE = new PublicKey('8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36'); // wSOL reserve

export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'solend';
  programId = SOLEND_PROGRAM_ID;
  maxAmount = 1000000; // 1M USD
  fee = 0.0009; // 0.09% Solend flashloan fee

  constructor(private solanaConnection: SolanaConnection) {}

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Solend program exists and is executable
      const accountInfo = await this.solanaConnection
        .getConnection()
        .getAccountInfo(this.programId);
      return accountInfo !== null && accountInfo.executable;
    } catch {
      return false;
    }
  }

  calculateFee(amount: number): number {
    return Math.ceil(amount * this.fee);
  }

  async createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    arbitrageInstructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]> {
    const wallet = this.solanaConnection.getWalletPublicKey();
    const instructions: TransactionInstruction[] = [];

    // Get the reserve for the specific mint (for now, only supporting wSOL)
    if (!mint.equals(new PublicKey('So11111111111111111111111111111111111111112'))) {
      throw new Error('Only wSOL flashloans are currently supported');
    }

    // User's token account
    const userTokenAccount = await getAssociatedTokenAddress(mint, wallet);
    
    // Calculate fee
    const feeAmount = this.calculateFee(amount);
    const repayAmount = amount + feeAmount;

    // 1. Flash Borrow Instruction
    const flashBorrowData = Buffer.concat([
      Buffer.from([12]), // Flash borrow instruction discriminator
      numberToLE64(amount),
    ]);

    const flashBorrowInstruction = new TransactionInstruction({
      keys: [
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: WSOL_RESERVE, isSigner: false, isWritable: true },
        { pubkey: LENDING_MARKET, isSigner: false, isWritable: false },
        { pubkey: wallet, isSigner: true, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: flashBorrowData,
    });

    instructions.push(flashBorrowInstruction);

    // 2. Add user's arbitrage instructions
    instructions.push(...arbitrageInstructions);

    // 3. Flash Repay Instruction
    const flashRepayData = Buffer.concat([
      Buffer.from([13]), // Flash repay instruction discriminator  
      numberToLE64(repayAmount),
    ]);

    const flashRepayInstruction = new TransactionInstruction({
      keys: [
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: WSOL_RESERVE, isSigner: false, isWritable: true },
        { pubkey: LENDING_MARKET, isSigner: false, isWritable: false },
        { pubkey: wallet, isSigner: true, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: flashRepayData,
    });

    instructions.push(flashRepayInstruction);

    return instructions;
  }
}

export class FlashloanManager {
  private providers: Map<string, FlashloanProvider> = new Map();

  constructor(private solanaConnection: SolanaConnection) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.providers.set('solend', new SolendFlashloanProvider(this.solanaConnection));
  }

  async getBestProvider(amount: number): Promise<FlashloanProvider | null> {
    const availableProviders: FlashloanProvider[] = [];

    for (const provider of this.providers.values()) {
      if ((await provider.isAvailable()) && provider.maxAmount >= amount) {
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
