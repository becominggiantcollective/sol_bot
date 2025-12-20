import dotenv from 'dotenv';
import { Config } from '../types/index.js';

// Ensure dotenv is loaded before accessing process.env (quiet mode to reduce log spam)
dotenv.config({ debug: false });

export const config: Config = {
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
  wallet: {
    // Prefer IDK_* keys if provided, fall back to legacy names for compatibility
    privateKey: process.env.WALLET_IDK_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '',
    publicKey: process.env.WALLET_IDK_PUBLIC_KEY || process.env.WALLET_PUBLIC_KEY || '',
  },
  trading: {
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.02'), // 2% - allow for volatile opportunities
    maxGasFee: parseFloat(process.env.MAX_GAS_FEE || '0.01'), // 0.01 SOL max - priority execution
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.002'), // 0.2% minimum - verified: flash loan ~0%, DEX ~0.05%, gas ~0.05%
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '100000'), // $100k with flash loans
  },
  liquidation: {
    enabled: true,
    maxConcurrentLiquidations: parseInt(process.env.MAX_CONCURRENT_LIQUIDATIONS || '5'),
    minProfitThreshold: parseFloat(process.env.LIQUIDATION_MIN_PROFIT || '0.005'), // 0.5% - more aggressive
    priorityFeeMultiplier: parseFloat(process.env.PRIORITY_FEE_MULTIPLIER || '2.0'),
  },
  flashloan: {
    enabled: process.env.FLASHLOAN_ENABLED !== 'false', // Enable by default
    providers: ['solend'],
    maxAmount: parseFloat(process.env.MAX_FLASHLOAN_AMOUNT || '200000'), // $200k max flash loan
    minProfitForFlashloan: 0.002, // 0.2% minimum - verified: Solend fee ~0%, DEX ~0.05%, gas ~0.05%
  },
  jupiter: {
    apiKey: process.env.JUPITER_API_KEY || '',
    apiUrl: process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1',
  },
  dexes: {
    jupiter: {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      enabled: true,
    },
    orca: {
      programId: 'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
      enabled: true,
    },
    raydium: {
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      enabled: true,
    },
  },
  jito: {
    enabled: process.env.JITO_ENABLED === 'true',
    tipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || '500000'), // 0.0005 SOL (~$0.12)
    bundleOnly: process.env.JITO_BUNDLE_ONLY === 'true',
    blockEngine: process.env.JITO_BLOCK_ENGINE || 'https://mainnet.block-engine.jito.wtf',
  },
  helius: {
    apiKey: process.env.HELIUS_API_KEY || '',
    rpcUrl: process.env.HELIUS_RPC_URL || '',
    wsUrl: process.env.HELIUS_WS_URL || '',
  },
};