import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { FlashloanProvider } from '../types';
import { SolanaConnection } from './connection';
import { KaminoFlashloanProvider } from './kamino-flashloan';
import { MarginFiFlashloanProvider } from './marginfi-flashloan';

export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'spl-token-lending';
  programId = new PublicKey('LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi'); // SPL Token Lending Program
  maxAmount = 100000000000000; // 100,000 SOL in lamports (~$19M)
  fee = 0.0003; // 0.03% flash loan fee

  constructor(private solanaConnection: SolanaConnection) {}

  async isAvailable(): Promise<boolean> {
    // SPL Token Lending program is always available on mainnet
    // Program ID: LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi (SPL Token Lending)
    return true;
  }

  calculateFee(amount: number): number {
    return amount * this.fee;
  }

  async createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    instructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]> {
    // SPL Token Lending FlashLoan implementation (Instruction 13)
    // Based on: https://github.com/solana-labs/solana-program-library/tree/main/token-lending
    // Uses a flash loan receiver program pattern
    
    const flashloanInstructions: TransactionInstruction[] = [];
    const wallet = this.solanaConnection.getWalletPublicKey();
    
    // Validate inputs
    if (!(mint instanceof PublicKey)) {
      throw new Error(`Invalid mint parameter: ${typeof mint}, value: ${mint}`);
    }
    if (!(wallet instanceof PublicKey)) {
      throw new Error(`Invalid wallet parameter: ${typeof wallet}, value: ${wallet}`);
    }
    
    // Get reserve accounts for the token from SPL Token Lending
    const { reserve, reserveAddress } = await this.getSolendReserve(mint);
    
    if (!reserve || !reserveAddress) {
      throw new Error(`No reserve found for mint: ${mint.toString()}`);
    }
    
    // Derive lending market authority PDA
    const [lendingMarketAuthority] = PublicKey.findProgramAddressSync(
      [reserve.lendingMarket.toBuffer()],
      this.programId
    );
    
    // Create user's token accounts
    const sourceLiquidityAccount = await this.getOrCreateTokenAccount(mint, wallet);
    const destinationLiquidityAccount = await this.getOrCreateTokenAccount(mint, wallet);
    
    // For SPL Token Lending FlashLoan (discriminator 13), we need a receiver program
    // Since we don't have a custom receiver program deployed, we'll use a simpler approach:
    // Execute Jupiter swaps directly with available wallet balance
    //
    // TODO: To properly implement flashloans, need to:
    // 1. Deploy a flash loan receiver program that implements instruction 0
    // 2. That receiver program executes the arbitrage and returns funds + fee
    // 3. Use discriminator 13 (FlashLoan) instead of 10/11 (BorrowObligation/RepayObligation)
    //
    // For now, return the arbitrage instructions directly (no flashloan wrapper)
    console.log('⚠️  FlashLoan requires custom receiver program - using direct swap instead');
    console.log(`   To enable flashloans: Deploy SPL Token Lending receiver program`);
    console.log(`   Falling back to Jupiter direct swaps with wallet balance`);
    
    // Just return the arbitrage instructions without flashloan wrapping
    // This will execute with available wallet balance
    return instructions;
  }
  
  private async getSolendReserve(mint: PublicKey): Promise<{ reserve: any; reserveAddress: PublicKey } | { reserve: null; reserveAddress: null }> {
    // Solend Main Pool reserves (hardcoded for common tokens)
    // Main Pool lending market: 4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY
    const mainPoolMarket = new PublicKey('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY');
    
    // Known Solend reserves for major tokens
    // Note: These are from Solend Main Pool. Flashloans may not be available for all reserves.
    // For production, should fetch reserves dynamically from on-chain data.
    const SOLEND_RESERVES: Record<string, { address: string; liquiditySupply: string; feeReceiver: string }> = {
      // SOL reserve (most liquid, best for flashloans)
      'So11111111111111111111111111111111111111112': {
        address: '8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36',
        liquiditySupply: '8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf',
        feeReceiver: 'CpYwHrVN8gxWXe7fWz5zFmX8EJrhqQxhQJQtFpN7PdPD',
      },
      // USDC reserve (highly liquid)
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
        address: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
        liquiditySupply: '8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf',
        feeReceiver: '5Gdz8oVzpfv6YqJe4LMaHu2Xz59Vr8dNGnSQXM2cksJ',
      },
      // USDT reserve
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
        address: '8K9WC8xoh2rtQNY7iEGXtPvfbDCi563SdWhCAhuMP2xE',
        liquiditySupply: 'Bxc5xU5YBZPMVBmgaJqNXuXGN5WrZ1KfQaYUezkYSYmm',
        feeReceiver: '6K1R7J8jCpxRAwkgTNYkHH4YT9CYxM2c7bSkU8xZBz5M',
      },
      // BONK reserve (if flashloans supported)
      // Note: BONK may not have sufficient liquidity for flashloans on Solend
      // Commenting out for now - focus on SOL/USDC/USDT which have deep liquidity
      // 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
      //   address: 'BONK_RESERVE_ADDRESS',
      //   liquiditySupply: 'BONK_SUPPLY_ADDRESS',
      //   feeReceiver: 'BONK_FEE_RECEIVER',
      // },
    };
    
    const mintStr = mint.toString();
    const reserveInfo = SOLEND_RESERVES[mintStr];
    
    if (!reserveInfo) {
      console.warn(`No Solend reserve configured for mint: ${mintStr}`);
      return { reserve: null, reserveAddress: null };
    }
    
    const reserveAddress = new PublicKey(reserveInfo.address);
    
    // Create reserve object with known structure
    const reserve = {
      lendingMarket: mainPoolMarket,
      liquidity: {
        mintPubkey: mint,
        supply: new PublicKey(reserveInfo.liquiditySupply),
        feeReceiver: new PublicKey(reserveInfo.feeReceiver),
      },
    };
    
    return { reserve, reserveAddress };
  }
  
  private async getOrCreateTokenAccount(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    // For now, derive the associated token account address
    // In production, should check if it exists and create if needed
    
    // REAL TOKEN PROGRAM IDS (verified from @solana/spl-token)
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    const [associatedToken] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    return associatedToken;
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
    amount: number,
    mint: PublicKey,
    instructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]> {
    // Implement Mango Markets flashloan protocol
    // Reference: https://docs.mango.markets/development-resources/flash-loans
    
    const flashloanInstructions: TransactionInstruction[] = [];
    const wallet = this.solanaConnection.getWalletPublicKey();
    
    // Mango uses a different approach with perpetual contracts
    // 1. Begin flashloan (instruction discriminator varies by version)
    const beginData = Buffer.alloc(17);
    beginData.writeUInt8(50, 0); // FlashLoanBegin instruction (Mango v4)
    beginData.writeBigUInt64LE(BigInt(amount), 1);
    
    const beginInstruction = new TransactionInstruction({
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        // Note: Additional Mango accounts needed:
        // - Mango account
        // - Mango group
        // - Bank (token-specific)
        // - Vault
        // These need to be derived from Mango program state
      ],
      programId: this.programId,
      data: beginData,
    });
    
    flashloanInstructions.push(beginInstruction);
    
    // 2. Add user's arbitrage instructions
    flashloanInstructions.push(...instructions);
    
    // 3. End flashloan with repayment
    const repayAmount = amount + this.calculateFee(amount);
    const endData = Buffer.alloc(17);
    endData.writeUInt8(51, 0); // FlashLoanEnd instruction
    endData.writeBigUInt64LE(BigInt(Math.floor(repayAmount)), 1);
    
    const endInstruction = new TransactionInstruction({
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        // Note: Same accounts as begin instruction needed
      ],
      programId: this.programId,
      data: endData,
    });
    
    flashloanInstructions.push(endInstruction);
    
    return flashloanInstructions;
  }
}

export class FlashloanManager {
  private providers: Map<string, FlashloanProvider> = new Map();

  constructor(private solanaConnection: SolanaConnection) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize all flashloan providers (best to worst)
    // MarginFi has LOWEST fees (0.01%), Kamino second (0.09%), SPL Token Lending highest (0.30%)
    this.providers.set('marginfi', new MarginFiFlashloanProvider(this.solanaConnection));
    this.providers.set('kamino', new KaminoFlashloanProvider(this.solanaConnection));
    this.providers.set('solend', new SolendFlashloanProvider(this.solanaConnection));
    
    console.log('📋 Initialized flashloan providers:');
    console.log('   1. MarginFi (0.01% fee) - BEST!');
    console.log('   2. Kamino (0.09% fee)');
    console.log('   3. SPL Token Lending (0.30% fee)');
  }

  async getBestProvider(amount: number): Promise<FlashloanProvider | null> {
    console.log(`[DEBUG] getBestProvider called with amount: ${amount}`);
    console.log(`[DEBUG] Total providers: ${this.providers.size}`);
    
    const availableProviders: FlashloanProvider[] = [];
    
    for (const provider of this.providers.values()) {
      console.log(`[DEBUG] Checking provider: ${provider.name}, maxAmount: ${provider.maxAmount}, requested: ${amount}`);
      const isAvail = await provider.isAvailable();
      console.log(`[DEBUG] Provider ${provider.name} isAvailable: ${isAvail}`);
      console.log(`[DEBUG] Amount check: ${provider.maxAmount} >= ${amount} = ${provider.maxAmount >= amount}`);
      
      if (isAvail && provider.maxAmount >= amount) {
        console.log(`[DEBUG] Adding provider ${provider.name} to available list`);
        availableProviders.push(provider);
      }
    }
    
    console.log(`[DEBUG] Total available providers: ${availableProviders.length}`);
    
    if (availableProviders.length === 0) {
      console.log(`[DEBUG] No providers available!`);
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
    const instructions = await provider.createFlashloanInstructions(
      amount,
      mint,
      arbitrageInstructions
    );
    
    const transaction = new Transaction();
    transaction.add(...instructions);
    
    return await this.solanaConnection.sendTransaction(transaction);
  }
}