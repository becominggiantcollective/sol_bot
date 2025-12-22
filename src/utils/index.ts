import { PublicKey } from '@solana/web3.js';

// High-volume tokens + volatile meme coins for maximum arbitrage opportunities
export const COMMON_TOKENS = {
  // === CORE STABLES/MAJORS ===
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  
  // === LIQUID STAKING (price dislocations during staking events) ===
  mSOL: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
  jitoSOL: new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'),
  
  // === DEX TOKENS (high volume, cross-DEX arb potential) ===
  JUP: new PublicKey('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'),
  RAY: new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'),
  
  // === HIGH VOLATILITY MEME COINS (where arb opportunities live) ===
  BONK: new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),
  WIF: new PublicKey('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'),
  POPCAT: new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'),
  PENGU: new PublicKey('2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv'),  // $541K vol, $4.1M liq
  
  // === TRENDING HOT TOKENS (High volume on Raydium/Pumpswap) ===
  // pippin - $25.6M vol, $9.5M liq on Raydium
  PIPPIN: new PublicKey('Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump'),
  // arc - $3.1M vol, $3.4M liq on Raydium  
  ARC: new PublicKey('61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump'),
  // Shoggoth - $5.4M vol on Raydium
  SHOGGOTH: new PublicKey('H6YqpXmDH9byrVsdJWgVdTJxzUob9uL7aoSLpFqapump'),
  
  // === ORACLE/DEFI ===
  PYTH: new PublicKey('HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'),
  JTO: new PublicKey('jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'),
  
  // === WORMHOLE BRIDGED (bridge delays = arb windows) ===
  WETH: new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'),
};

export function formatNumber(num: number, decimals = 6): string {
  return num.toFixed(decimals);
}

export function formatPercent(num: number): string {
  return `${(num * 100).toFixed(2)}%`;
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1e9;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  return fn().catch(async (error) => {
    if (retries > 0) {
      await sleep(delay);
      return retry(fn, retries - 1, delay * 2);
    }
    throw error;
  });
}

export function calculatePriceImpact(
  inputAmount: number,
  outputAmount: number,
  marketPrice: number
): number {
  const executionPrice = inputAmount / outputAmount;
  return Math.abs(executionPrice - marketPrice) / marketPrice;
}

export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export class Logger {
  private static instance: Logger;
  private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.logLevel = level;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${new Date().toISOString()} ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${new Date().toISOString()} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${new Date().toISOString()} ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${new Date().toISOString()} ${message}`, ...args);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }
}

// Export KPI tracking and fine-tuning utilities
export { KPITracker } from './kpiTracker.js';
export { FineTuningEngine } from './fineTuning.js';
export type { 
  ComprehensiveKPIs, 
  ExecutionMetrics, 
  RPCMetrics, 
  RiskMetrics, 
  CostMetrics, 
  ProfitabilityMetrics,
  CircuitBreakerStatus,
} from './kpiTracker.js';
export type {
  TradingParameters,
  ParameterTestResult,
  ABTestConfig,
  ABTestResults,
  OptimizationTarget,
} from './fineTuning.js';