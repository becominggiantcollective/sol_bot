import { PublicKey, TransactionInstruction } from '@solana/web3.js';

export interface Config {
  solana: {
    rpcUrl: string;
    wsUrl: string;
    commitment: 'confirmed' | 'finalized' | 'processed';
  };
  wallet: {
    privateKey: string;
    publicKey: string;
  };
  trading: {
    maxSlippage: number;
    maxGasFee: number;
    minProfitThreshold: number;
    maxPositionSize: number;
  };
  liquidation: {
    enabled: boolean;
    maxConcurrentLiquidations: number;
    minProfitThreshold: number;
    priorityFeeMultiplier: number;
  };
  flashloan: {
    providers: string[];
    maxAmount: number;
  };
  dexes: {
    [key: string]: {
      programId: string;
      enabled: boolean;
    };
  };
}

export interface ArbitrageOpportunity {
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputAmount: number;
  expectedOutput: number;
  profit: number;
  profitPercent: number;
  route: TradingRoute[];
  flashloanProvider?: string;
  gasEstimate: number;
}

export interface TradingRoute {
  dex: string;
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
}

export interface ProtocolPosition {
  protocol: string;
  borrower: PublicKey;
  collateral: {
    mint: PublicKey;
    amount: number;
    value: number;
  };
  borrows: {
    mint: PublicKey;
    amount: number;
    value: number;
  }[];
  healthFactor: number;
  liquidationThreshold: number;
}

export interface FlashloanProvider {
  name: string;
  programId: PublicKey;
  maxAmount: number;
  fee: number;
  isAvailable(): Promise<boolean>;
  calculateFee(amount: number): number;
  createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    instructions: TransactionInstruction[]
  ): Promise<TransactionInstruction[]>;
}

export interface MEVStrategy {
  name: string;
  description: string;
  execute(opportunity: ArbitrageOpportunity): Promise<string>;
  isViable(opportunity: ArbitrageOpportunity): boolean;
}

export interface PriceData {
  mint: PublicKey;
  price: number;
  liquidity: number;
  timestamp: number;
  source: string;
}

export interface LiquidationOpportunity {
  protocol: string;
  borrower: PublicKey;
  collateralMint: PublicKey;
  borrowMint: PublicKey;
  collateralAmount: number;
  borrowAmount: number;
  healthFactor: number;
  liquidationThreshold: number;
  maxLiquidationAmount: number;
  estimatedProfit: number;
  profitPercent: number;
  flashloanRequired: boolean;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  lastUpdated: number;
}

export interface LendingProtocol {
  name: string;
  programId: PublicKey;
  isActive: boolean;
  getPositions(): Promise<ProtocolPosition[]>;
  getLiquidationInstruction(opportunity: LiquidationOpportunity): Promise<TransactionInstruction>;
}