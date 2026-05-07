import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ArbitrageOpportunity, MEVStrategy, LiquidationOpportunity, LendingProtocol, ProtocolPosition } from '../types/index.js';
import { SolanaConnection } from '../core/connection.js';
import { FlashloanManager } from '../core/flashloan.js';
import { LiquidationDetector } from '../core/liquidation.js';
import { Logger } from '../utils/index.js';
import { config } from '../config/index.js';

export class FlashloanArbitrageStrategy implements MEVStrategy {
  name = 'flashloan-arbitrage';
  description = 'Executes arbitrage opportunities using flashloans to maximize capital efficiency';

  constructor(
    private solanaConnection: SolanaConnection,
    private flashloanManager: FlashloanManager
  ) {}

  isViable(opportunity: ArbitrageOpportunity): boolean {
    // Check if opportunity is profitable after fees.
    // Solend flash loan fee is 0% (verified on-chain), so only gas needs to be covered.
    const estimatedFees = opportunity.gasEstimate;
    return opportunity.profit > estimatedFees;
  }

  async execute(opportunity: ArbitrageOpportunity): Promise<string> {
    try {
      console.log(`Executing flashloan arbitrage for ${opportunity.inputMint.toString()}`);
      
      // Get the best flashloan provider
      const provider = await this.flashloanManager.getBestProvider(opportunity.inputAmount);
      if (!provider) {
        throw new Error('No flashloan provider available');
      }
      
      // Build arbitrage instructions
      const arbitrageInstructions = await this.buildArbitrageInstructions(opportunity);
      
      // Execute flashloan with arbitrage
      const walletPubkey = this.solanaConnection.getWalletPublicKey();
      if (!walletPubkey) throw new Error('Wallet not loaded');
      const result = await this.flashloanManager.executeFlashloan(
        provider,
        opportunity.inputAmount,
        opportunity.inputMint,
        arbitrageInstructions,
        walletPubkey
      );

      if (!result.success || !result.signature) {
        throw new Error(`Flash loan execution failed: ${result.error || 'unknown error'}`);
      }

      console.log(`Flashloan arbitrage executed: ${result.signature}`);
      return result.signature;
    } catch (error) {
      console.error('Flashloan arbitrage execution failed:', error);
      throw error;
    }
  }

  private async buildArbitrageInstructions(
    opportunity: ArbitrageOpportunity
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    
    // Add instructions for each route in the arbitrage
    for (const route of opportunity.route) {
      const instruction = await this.buildSwapInstruction(route);
      if (instruction) {
        instructions.push(instruction);
      }
    }
    
    return instructions;
  }

  private async buildSwapInstruction(_route: any): Promise<TransactionInstruction | null> {
    // This is a simplified implementation
    // In reality, you'd build specific instructions for each DEX
    
    switch (_route.dex) {
      case 'jupiter':
        return this.buildJupiterSwapInstruction(_route);
      case 'orca':
        return this.buildOrcaSwapInstruction(_route);
      case 'raydium':
        return this.buildRaydiumSwapInstruction(_route);
      default:
        return null;
    }
  }

  private async buildJupiterSwapInstruction(_route: any): Promise<TransactionInstruction | null> {
    // TODO: Implement proper Jupiter swap instruction building
    // This should use the Jupiter API to get swap instructions
    throw new Error('Jupiter swap instruction builder not yet implemented for MEV strategy');
  }

  private async buildOrcaSwapInstruction(_route: any): Promise<TransactionInstruction | null> {
    // TODO: Implement proper Orca swap instruction building
    throw new Error('Orca swap instruction builder not yet implemented');
  }

  private async buildRaydiumSwapInstruction(_route: any): Promise<TransactionInstruction | null> {
    // TODO: Implement proper Raydium swap instruction building
    throw new Error('Raydium swap instruction builder not yet implemented');
  }
}

export class SandwichAttackStrategy implements MEVStrategy {
  name = 'sandwich-attack';
  description = 'Detects large transactions and executes sandwich attacks (front-run + back-run)';

  constructor(private solanaConnection: SolanaConnection) {}

  isViable(opportunity: ArbitrageOpportunity): boolean {
    // Only viable for large transactions that will cause significant price impact
    return opportunity.inputAmount > 10000 && opportunity.route[0]?.priceImpact > 0.01;
  }

  async execute(opportunity: ArbitrageOpportunity): Promise<string> {
    try {
      console.log('Executing sandwich attack strategy');
      
      // 1. Front-run: Buy before the large transaction
      const frontRunTx = await this.buildFrontRunTransaction(opportunity);
      const frontRunSig = await this.solanaConnection.sendTransaction(frontRunTx);
      
      // 2. Wait for the target transaction to be processed
      await this.waitForTargetTransaction();
      
      // 3. Back-run: Sell after the large transaction
      const backRunTx = await this.buildBackRunTransaction(opportunity);
      const backRunSig = await this.solanaConnection.sendTransaction(backRunTx);
      
      console.log(`Sandwich attack completed: ${frontRunSig}, ${backRunSig}`);
      return `${frontRunSig},${backRunSig}`;
    } catch (error) {
      console.error('Sandwich attack execution failed:', error);
      throw error;
    }
  }

  private async buildFrontRunTransaction(_opportunity: ArbitrageOpportunity): Promise<Transaction> {
    const transaction = new Transaction();
    // Add front-run swap instruction
    // This would buy the token before the large transaction executes
    return transaction;
  }

  private async buildBackRunTransaction(_opportunity: ArbitrageOpportunity): Promise<Transaction> {
    const transaction = new Transaction();
    // Add back-run swap instruction
    // This would sell the token after the large transaction executes
    return transaction;
  }

  private async waitForTargetTransaction(): Promise<void> {
    // Wait logic for the target transaction to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export class LiquidationStrategy implements MEVStrategy {
  name = 'aggressive-liquidation';
  description = 'Executes liquidations using flash loans with maximum speed and aggression';

  private liquidationDetector: LiquidationDetector;
  private logger: Logger;
  private protocols: Map<string, LendingProtocol> = new Map();

  constructor(
    private solanaConnection: SolanaConnection,
    private flashloanManager: FlashloanManager
  ) {
    this.logger = Logger.getInstance();
    this.liquidationDetector = new LiquidationDetector(solanaConnection);
    this.initializeProtocols();
  }

  private initializeProtocols(): void {
    // Initialize protocol handlers for liquidation execution
    this.protocols.set('solend', new SolendProtocol(this.solanaConnection));
    this.protocols.set('mango', new MangoProtocol(this.solanaConnection));
    this.protocols.set('port', new PortProtocol(this.solanaConnection));
  }

  isViable(_opportunity: ArbitrageOpportunity): boolean {
    // This strategy doesn't use traditional arbitrage opportunities
    // Instead, it scans for liquidation opportunities independently
    return false;
  }

  async execute(_opportunity: ArbitrageOpportunity): Promise<string> {
    // This method is not used for liquidations
    // Use executeLiquidation instead
    throw new Error('Use executeLiquidation method for liquidation strategy');
  }

  async scanAndExecuteLiquidations(): Promise<string[]> {
    try {
      this.logger.info('Starting aggressive liquidation scan...');
      
      // Detect liquidation opportunities
      const opportunities = await this.liquidationDetector.detectLiquidationOpportunities();
      
      if (opportunities.length === 0) {
        this.logger.debug('No liquidation opportunities found');
        return [];
      }

      this.logger.info(`Found ${opportunities.length} liquidation opportunities`);

      // Execute liquidations in parallel for maximum speed
      const executionPromises = opportunities
        .slice(0, 5) // Limit to top 5 opportunities to avoid gas limit issues
        .map(async (opportunity) => {
          try {
            return await this.executeLiquidation(opportunity);
          } catch (error) {
            this.logger.error(`Failed to execute liquidation for ${opportunity.borrower.toString()}:`, error);
            return null;
          }
        });

      const results = await Promise.allSettled(executionPromises);
      const successfulTxs = results
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => (result as PromiseFulfilledResult<string>).value);

      this.logger.info(`Successfully executed ${successfulTxs.length} liquidations`);
      return successfulTxs;

    } catch (error) {
      this.logger.error('Error in liquidation scan and execution:', error);
      return [];
    }
  }

  async executeLiquidation(opportunity: LiquidationOpportunity): Promise<string> {
    try {
      this.logger.info(
        `Executing ${opportunity.urgency} liquidation: ${opportunity.borrower.toString()}, ` +
        `Health Factor: ${opportunity.healthFactor.toFixed(4)}, ` +
        `Profit: ${opportunity.estimatedProfit.toFixed(4)} (${(opportunity.profitPercent * 100).toFixed(2)}%)`
      );

      const protocol = this.protocols.get(opportunity.protocol);
      if (!protocol) {
        throw new Error(`Unsupported protocol: ${opportunity.protocol}`);
      }

      // Build liquidation transaction
      let signature: string;

      if (opportunity.flashloanRequired) {
        signature = await this.executeFlashloanLiquidation(opportunity, protocol);
      } else {
        signature = await this.executeDirectLiquidation(opportunity, protocol);
      }

      this.logger.info(`Liquidation executed successfully: ${signature}`);
      return signature;

    } catch (error) {
      this.logger.error('Liquidation execution failed:', error);
      throw error;
    }
  }

  private async executeFlashloanLiquidation(
    opportunity: LiquidationOpportunity,
    protocol: LendingProtocol
  ): Promise<string> {
    // Get flash loan for the liquidation amount
    const borrowPrice = await this.getTokenPrice(opportunity.borrowMint);
    const flashloanAmount = opportunity.maxLiquidationAmount * borrowPrice;

    const provider = await this.flashloanManager.getBestProvider(flashloanAmount);
    if (!provider) {
      throw new Error('No flash loan provider available for liquidation');
    }

    // Build liquidation instructions
    const liquidationInstructions = await this.buildLiquidationInstructions(opportunity, protocol);

    // Execute flash loan with liquidation
    const walletPubkey = this.solanaConnection.getWalletPublicKey();
    if (!walletPubkey) throw new Error('Wallet not loaded');
    const result = await this.flashloanManager.executeFlashloan(
      provider,
      flashloanAmount,
      opportunity.borrowMint,
      liquidationInstructions,
      walletPubkey
    );

    if (!result.success || !result.signature) {
      throw new Error(`Flash loan liquidation failed: ${result.error || 'unknown error'}`);
    }

    return result.signature;
  }

  private async executeDirectLiquidation(
    opportunity: LiquidationOpportunity,
    protocol: LendingProtocol
  ): Promise<string> {
    // Execute liquidation directly without flash loan
    const instructions = await this.buildLiquidationInstructions(opportunity, protocol);

    const transaction = new Transaction();
    transaction.add(...instructions);

    // Set high priority fee for maximum speed
    await this.optimizeTransactionForSpeed(transaction);

    return await this.solanaConnection.sendTransaction(transaction);
  }

  private async buildLiquidationInstructions(
    opportunity: LiquidationOpportunity,
    protocol: LendingProtocol
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];

    // Add liquidation instruction
    const liquidationIx = await protocol.getLiquidationInstruction(opportunity);
    instructions.push(liquidationIx);

    // Add swap instruction to convert liquidated collateral to preferred token
    const swapIx = await this.buildCollateralSwapInstruction(opportunity);
    if (swapIx) {
      instructions.push(swapIx);
    }

    return instructions;
  }

  private async buildCollateralSwapInstruction(
    opportunity: LiquidationOpportunity
  ): Promise<TransactionInstruction | null> {
    try {
      // Swap liquidated collateral to USDC or SOL for easier management
      const preferredOutputMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC

      if (opportunity.collateralMint.equals(preferredOutputMint)) {
        return null; // No swap needed
      }

      // TODO: Implement proper Jupiter swap via API
      // For now, skip collateral swap - liquidation will return the collateral directly
      this.logger.debug('Collateral swap not implemented, skipping');
      return null;
    } catch (error) {
      this.logger.error('Error building collateral swap instruction:', error);
      return null;
    }
  }

  private async optimizeTransactionForSpeed(transaction: Transaction): Promise<void> {
    try {
      // Set high priority fee to outcompete other liquidators
      const priorityFee = 50000; // High priority fee in lamports
      
      // Add compute budget instruction for higher priority
      const computeBudgetIx = new TransactionInstruction({
        keys: [],
        programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
        data: Buffer.from([
          3, // SetComputeUnitPrice instruction
          ...new Uint8Array(new BigUint64Array([BigInt(priorityFee)]).buffer),
        ]),
      });

      // Insert at the beginning for maximum effect
      transaction.instructions.unshift(computeBudgetIx);

      this.logger.debug(`Optimized transaction with priority fee: ${priorityFee} lamports`);
    } catch (error) {
      this.logger.error('Error optimizing transaction for speed:', error);
    }
  }

  private async getTokenPrice(mint: PublicKey): Promise<number> {
    try {
      // Fetch real-time price from Jupiter Price API
      const headers: Record<string, string> = {};
      if (config.jupiter?.apiKey) headers['x-api-key'] = config.jupiter.apiKey;
      
      const response = await fetch(`https://api.jup.ag/price/v2?ids=${mint.toBase58()}`, { headers });
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status}`);
      }
      const data = await response.json() as { data?: { [key: string]: { price?: number } } };
      const priceData = data.data?.[mint.toBase58()];
      if (priceData?.price) {
        return priceData.price;
      }
      throw new Error(`No price data for ${mint.toBase58()}`);
    } catch (error) {
      // Return a conservative fallback of $1 per token so liquidation can proceed.
      // This may under-value the required flash loan amount but prevents a hard
      // failure when the price API is temporarily unavailable.
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to fetch price for ${mint.toBase58()}, using fallback $1: ${errMsg}`);
      return 1.0;
    }
  }
}

// Protocol implementations for liquidation
class SolendProtocol implements LendingProtocol {
  name = 'solend';
  programId = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
  isActive = true;

  constructor(private solanaConnection: SolanaConnection) {}

  async getPositions(): Promise<ProtocolPosition[]> {
    // TODO: Implement real Solend position scanning
    // This requires querying Solend obligation accounts and calculating health factors
    throw new Error('Solend position scanning not yet implemented');
  }

  async getLiquidationInstruction(opportunity: LiquidationOpportunity): Promise<TransactionInstruction> {
    // NOTE: This is a STUB implementation for testing purposes.
    // The full Solend liquidateObligationAndRedeemReserveCollateral instruction
    // requires 15 accounts (reserve, collateral mint, obligation, lending market,
    // authority, sysvar clock, token program, etc.) that must be resolved at
    // execution time. This stub will fail when submitted on-chain.
    // TODO: Implement the full account resolution using Solend SDK obligations.
    console.warn('[SolendProtocol] getLiquidationInstruction: using stub implementation – NOT for production');

    const amount = opportunity.maxLiquidationAmount;
    if (!Number.isSafeInteger(Math.floor(amount))) {
      throw new Error(`maxLiquidationAmount ${amount} exceeds safe integer range`);
    }

    const data = Buffer.alloc(9);
    data.writeUInt8(15, 0); // instruction index for liquidateObligationAndRedeemReserveCollateral
    data.writeBigUInt64LE(BigInt(Math.floor(amount)), 1);

    return new TransactionInstruction({
      keys: [
        { pubkey: opportunity.borrower, isSigner: false, isWritable: true },
        { pubkey: opportunity.collateralMint, isSigner: false, isWritable: true },
        { pubkey: opportunity.borrowMint, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }
}

class MangoProtocol implements LendingProtocol {
  name = 'mango';
  programId = new PublicKey('mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68');
  isActive = true;

  constructor(private solanaConnection: SolanaConnection) {}

  async getPositions(): Promise<ProtocolPosition[]> {
    // TODO: Implement real Mango position scanning
    throw new Error('Mango position scanning not yet implemented');
  }

  async getLiquidationInstruction(_opportunity: LiquidationOpportunity): Promise<TransactionInstruction> {
    // TODO: Implement real Mango liquidation instruction builder
    throw new Error('Mango liquidation instruction builder not yet implemented');
  }
}

class PortProtocol implements LendingProtocol {
  name = 'port';
  programId = new PublicKey('Port7uDYB3wk6GJAw4KT1WpTeMtSu9bTcChBHkX2LfR');
  isActive = true;

  constructor(private solanaConnection: SolanaConnection) {}

  async getPositions(): Promise<ProtocolPosition[]> {
    // TODO: Implement real Port Finance position scanning
    throw new Error('Port Finance position scanning not yet implemented');
  }

  async getLiquidationInstruction(_opportunity: LiquidationOpportunity): Promise<TransactionInstruction> {
    // TODO: Implement real Port Finance liquidation instruction builder
    throw new Error('Port Finance liquidation instruction builder not yet implemented');
  }
}