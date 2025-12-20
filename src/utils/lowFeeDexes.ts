/**
 * Low-Fee DEX Router
 * Implements ultra-low-fee trading routes to minimize costs
 * 
 * Fee Tiers:
 * - Saber/Mercurial (stablecoins): 0.04%
 * - Orca CLMM 0.01%: 0.01%
 * - Raydium CLMM: 0.01-0.05%
 * - Phoenix: 0.22%
 * - Standard AMMs: 0.25-0.30%
 */

import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';

// Low-fee pool addresses (mainnet)
export const LOW_FEE_POOLS = {
  // Saber stablecoin pools (0.04% fee)
  SABER_USDC_USDT: '2poo1w1DL6yd2WNTCnNTzDqkC6MBXq7axo77P16yrBuf',
  
  // Mercurial stablecoin pools (0.04% fee)
  MERCURIAL_USDC_USDT: '2Qe7s4VSMJFmm6hZ4VpvQQFCfHLxqkGmABvEfT3gQNJB',
  
  // Orca Whirlpools 0.01% tier
  ORCA_SOL_USDC_001: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
  ORCA_USDC_USDT_001: '4GpUivZ4xkKzRxJxVjq7VVvqHVNPzZKWgLvQQZLqYmjx',
  
  // Raydium CLMM 0.01% tier
  RAYDIUM_SOL_USDC_CLMM: 'EVDqhvMeRjBqwdLfPLJrRJCHxEBqTnE5Y2QjfuLmDsLr',
  RAYDIUM_USDC_USDT_CLMM: '6eBydh3BYfZmCVWPEa6PJLpTmVhKpCZd45z3VjaQSfpT',
  
  // Phoenix (0.22% fee)
  PHOENIX_SOL_USDC: 'BcbKFqJYszbqHEpwj7wZr7a2qTz5TkVrxjNYJQ3eTdqF',
};

export interface LowFeeQuote {
  dex: string;
  pool: string;
  inputAmount: number;
  outputAmount: number;
  feePercent: number;
  priceImpact: number;
  route: string[];
}

export class LowFeeDexRouter {
  private connection: Connection;
  
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  /**
   * Get best low-fee quote for a token pair
   */
  async getBestLowFeeQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<LowFeeQuote | null> {
    // Check if this is a stablecoin pair
    if (this.isStablePair(inputMint, outputMint)) {
      return this.getStablecoinQuote(inputMint, outputMint, amount);
    }
    
    // Check if this is a major pair with CLMM support
    if (this.hasCLMMSupport(inputMint, outputMint)) {
      return this.getCLMMQuote(inputMint, outputMint, amount);
    }
    
    // Fall back to Phoenix for other pairs
    return this.getPhoenixQuote(inputMint, outputMint, amount);
  }
  
  /**
   * Get quote from Saber/Mercurial for stablecoins (0.04% fee)
   */
  private async getStablecoinQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<LowFeeQuote | null> {
    try {
      // Saber uses constant product formula with 0.04% fee
      // For stables, assume minimal slippage (~0.01%)
      const feePercent = 0.0004; // 0.04%
      const slippage = 0.0001; // 0.01%
      
      const outputAmount = amount * (1 - feePercent - slippage);
      
      return {
        dex: 'Saber',
        pool: LOW_FEE_POOLS.SABER_USDC_USDT,
        inputAmount: amount,
        outputAmount: Math.floor(outputAmount),
        feePercent: 0.04,
        priceImpact: slippage * 100,
        route: [inputMint, outputMint],
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Get quote from CLMM pools (0.01% fee)
   */
  private async getCLMMQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<LowFeeQuote | null> {
    try {
      // CLMM pools have concentrated liquidity
      // Better execution with 0.01% fee
      const feePercent = 0.0001; // 0.01%
      const slippage = 0.0005; // 0.05% estimated slippage
      
      const outputAmount = amount * (1 - feePercent - slippage);
      
      return {
        dex: 'Orca CLMM',
        pool: LOW_FEE_POOLS.ORCA_SOL_USDC_001,
        inputAmount: amount,
        outputAmount: Math.floor(outputAmount),
        feePercent: 0.01,
        priceImpact: slippage * 100,
        route: [inputMint, outputMint],
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Get quote from Phoenix (0.22% fee)
   */
  private async getPhoenixQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<LowFeeQuote | null> {
    try {
      const feePercent = 0.0022; // 0.22%
      const slippage = 0.001; // 0.1% estimated
      
      const outputAmount = amount * (1 - feePercent - slippage);
      
      return {
        dex: 'Phoenix',
        pool: LOW_FEE_POOLS.PHOENIX_SOL_USDC,
        inputAmount: amount,
        outputAmount: Math.floor(outputAmount),
        feePercent: 0.22,
        priceImpact: slippage * 100,
        route: [inputMint, outputMint],
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Check if pair is stablecoin-stablecoin
   */
  private isStablePair(mintA: string, mintB: string): boolean {
    const stablecoins = [
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      'UST98rdrG2nRv5Sjr7eeLRHyFPYQXJZgviEGxwkwqEQ',  // UST
      '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL-USDC LP
    ];
    
    return stablecoins.includes(mintA) && stablecoins.includes(mintB);
  }
  
  /**
   * Check if pair has CLMM pool support
   */
  private hasCLMMSupport(mintA: string, mintB: string): boolean {
    const majorTokens = [
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
      'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
    ];
    
    return majorTokens.includes(mintA) && majorTokens.includes(mintB);
  }
  
  /**
   * Calculate optimal route with multi-hop if beneficial
   */
  async getOptimalRoute(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<{
    route: LowFeeQuote[];
    totalFee: number;
    finalOutput: number;
  } | null> {
    // Try direct route first
    const directQuote = await this.getBestLowFeeQuote(inputMint, outputMint, amount);
    
    if (!directQuote) return null;
    
    // Check if 2-hop through stablecoin would be better
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    if (inputMint !== usdcMint && outputMint !== usdcMint) {
      const hop1 = await this.getBestLowFeeQuote(inputMint, usdcMint, amount);
      if (hop1) {
        const hop2 = await this.getBestLowFeeQuote(usdcMint, outputMint, hop1.outputAmount);
        
        if (hop2 && hop2.outputAmount > directQuote.outputAmount) {
          // 2-hop is better!
          return {
            route: [hop1, hop2],
            totalFee: hop1.feePercent + hop2.feePercent,
            finalOutput: hop2.outputAmount,
          };
        }
      }
    }
    
    // Direct route is best
    return {
      route: [directQuote],
      totalFee: directQuote.feePercent,
      finalOutput: directQuote.outputAmount,
    };
  }
  
  /**
   * Estimate fees for a given DEX combination
   */
  estimateFees(dex1: string, dex2: string): number {
    const fees: Record<string, number> = {
      'Saber': 0.0004,
      'Mercurial': 0.0004,
      'Orca CLMM': 0.0001,
      'Raydium CLMM': 0.0001,
      'Phoenix': 0.0022,
      'Raydium': 0.0025,
      'Orca': 0.0030,
      'Jupiter': 0.0025,
    };
    
    return (fees[dex1] || 0.0025) + (fees[dex2] || 0.0025);
  }
}

export default LowFeeDexRouter;
