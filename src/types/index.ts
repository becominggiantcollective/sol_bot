import { PublicKey } from '@solana/web3.js';

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

export interface FlashloanProvider {
  name: string;
  programId: PublicKey;
  maxAmount: number;
  fee: number;
  isAvailable(): Promise<boolean>;
  calculateFee(amount: number): number;
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