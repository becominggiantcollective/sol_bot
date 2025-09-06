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
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.01'), // 1%
    maxGasFee: parseFloat(process.env.MAX_GAS_FEE || '0.01'), // 0.01 SOL
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.001'), // 0.1%
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '1000'), // 1000 USD
  },
  flashloan: {
    providers: ['solend', 'mango'],
    maxAmount: parseFloat(process.env.MAX_FLASHLOAN_AMOUNT || '100000'), // 100k USD
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