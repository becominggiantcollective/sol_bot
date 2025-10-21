import { PublicKey } from '@solana/web3.js';

// 🎯 MINIMAL: 3 tokens to AVOID RATE LIMITING
// 3 tokens = 6 pairs × 2 directions = 12 API calls total
// This is the MINIMUM to stay under Jupiter's rate limit
// ** After IP cooldown (1 hour), this should work **
export const COMMON_TOKENS = {
  // Core trio: One stable base + two volatile for arbitrage
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),     // Native SOL (flashloan supported, most liquid)
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),   // USD Coin (stable anchor)
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenErt9'),   // Tether (stable alternative)
  BONK: new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),   // BONK (highest volatility for arb opportunities)
  
  // This gives us 6 trading pairs with core 3:
  // SOL ↔ USDC, SOL ↔ BONK, USDC ↔ BONK (both directions)
  // = 12 total API calls per scan
  //
  // ⚠️  IP is currently rate-limited by Jupiter
  // ⚠️  Need to wait ~1 hour for cooldown
  // ⚠️  OR get Jupiter Pro API ($49/mo) for higher limits
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