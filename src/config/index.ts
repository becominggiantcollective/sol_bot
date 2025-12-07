import { Config } from '../types';

export const config: Config = {
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    publicKey: process.env.WALLET_PUBLIC_KEY || '',
  },
  trading: {
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.005'), // 0.5% - tighter for better execution
    maxGasFee: parseFloat(process.env.MAX_GAS_FEE || '0.02'), // 0.02 SOL - higher for priority
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.001'), // 0.1% - optimal threshold (tested vs 0.05%)
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '5000'), // $5000 - larger for better profits
  },
  liquidation: {
    enabled: true,
    maxConcurrentLiquidations: parseInt(process.env.MAX_CONCURRENT_LIQUIDATIONS || '5'), // Increased from 3
    minProfitThreshold: parseFloat(process.env.LIQUIDATION_MIN_PROFIT || '0.01'), // 1.0% - optimal threshold (tested vs 0.5%)
    priorityFeeMultiplier: parseFloat(process.env.PRIORITY_FEE_MULTIPLIER || '3.0'), // Increased from 2.0 for better competitiveness
  },
  flashloan: {
    providers: ['solend', 'mango'],
    maxAmount: parseFloat(process.env.MAX_FLASHLOAN_AMOUNT || '500000'), // 500k USD - increased from 100k
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
};

export const sentimentConfig = {
  enabled: process.env.SENTIMENT_ENABLED === 'true',
  twitter: process.env.TWITTER_BEARER_TOKEN
    ? {
        apiKey: process.env.TWITTER_API_KEY || '',
        apiSecret: process.env.TWITTER_API_SECRET || '',
        accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
        accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
        bearerToken: process.env.TWITTER_BEARER_TOKEN,
      }
    : undefined,
  telegram: process.env.TELEGRAM_BOT_TOKEN
    ? {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        channels: (process.env.TELEGRAM_CHANNELS || '').split(',').filter((c) => c.length > 0),
      }
    : undefined,
  updateInterval: parseInt(process.env.SENTIMENT_UPDATE_INTERVAL || '300000'), // 5 minutes
  sentimentThreshold: parseFloat(process.env.SENTIMENT_THRESHOLD || '0.3'), // 0.3 on -1 to 1 scale
  minSampleSize: parseInt(process.env.SENTIMENT_MIN_SAMPLES || '10'),
  confidenceThreshold: parseFloat(process.env.SENTIMENT_CONFIDENCE_THRESHOLD || '0.5'),
};