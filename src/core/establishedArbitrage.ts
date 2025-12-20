/**
 * Established Token Arbitrage Scanner
 * Scans high-volume liquid pairs for cross-DEX price discrepancies
 * 
 * Targets:
 * - SOL/USDC (largest pair, constant volume)
 * - mSOL/SOL (liquid staking derivative)
 * - JitoSOL/SOL (MEV staking)
 * - USDC/USDT (stablecoin arbitrage)
 * - RAY/USDC, ORCA/USDC (DEX tokens)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';

export interface EstablishedPair {
  tokenA: string;
  tokenB: string;
  mintA: string;
  mintB: string;
  liquidity: number;
  volume24h: number;
  priority: 'high' | 'medium' | 'low';
}

export interface ArbitrageOpportunity {
  pair: EstablishedPair;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadPercent: number;
  estimatedProfit: number;
  confidence: number;
  reasoning: string;
}

export class EstablishedTokenScanner {
  private connection: Connection;
  private readonly JUPITER_API = 'https://quote-api.jup.ag/v6';
  
  // High-priority established pairs
  private readonly TARGET_PAIRS: EstablishedPair[] = [
    {
      tokenA: 'SOL',
      tokenB: 'USDC',
      mintA: 'So11111111111111111111111111111111111111112',
      mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      liquidity: 50000000, // $50M
      volume24h: 20000000, // $20M daily
      priority: 'high',
    },
    {
      tokenA: 'mSOL',
      tokenB: 'SOL',
      mintA: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      mintB: 'So11111111111111111111111111111111111111112',
      liquidity: 10000000, // $10M
      volume24h: 3000000, // $3M daily
      priority: 'high',
    },
    {
      tokenA: 'JitoSOL',
      tokenB: 'SOL',
      mintA: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      mintB: 'So11111111111111111111111111111111111111112',
      liquidity: 5000000, // $5M
      volume24h: 2000000, // $2M daily
      priority: 'high',
    },
    {
      tokenA: 'USDC',
      tokenB: 'USDT',
      mintA: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      mintB: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      liquidity: 15000000, // $15M
      volume24h: 5000000, // $5M daily
      priority: 'medium',
    },
    {
      tokenA: 'RAY',
      tokenB: 'USDC',
      mintA: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      liquidity: 8000000, // $8M
      volume24h: 4000000, // $4M daily
      priority: 'medium',
    },
    {
      tokenA: 'ORCA',
      tokenB: 'USDC',
      mintA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
      mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      liquidity: 5000000, // $5M
      volume24h: 2000000, // $2M daily
      priority: 'medium',
    },
  ];

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Scan all established pairs for arbitrage opportunities
   */
  async scanForArbitrage(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    console.log('\n💎 Scanning ESTABLISHED liquid pairs for arbitrage...');
    
    for (const pair of this.TARGET_PAIRS) {
      try {
        const opp = await this.scanPair(pair);
        if (opp && opp.spreadPercent > 0.12) { // 0.12% breakeven with optimizations
          opportunities.push(opp);
          console.log(`   ✅ ${pair.tokenA}/${pair.tokenB}: ${opp.spreadPercent.toFixed(3)}% spread`);
        }
      } catch (error) {
        // Continue scanning other pairs
      }
    }
    
    if (opportunities.length === 0) {
      console.log('   📭 No profitable spreads found (all < 0.12% breakeven)');
    }
    
    return opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);
  }

  /**
   * Scan a specific pair for cross-DEX arbitrage
   */
  private async scanPair(pair: EstablishedPair): Promise<ArbitrageOpportunity | null> {
    const amount = 1000000000; // 1 SOL equivalent for testing
    
    try {
      // Get quotes from multiple DEXs via Jupiter
      const response = await axios.get(`${this.JUPITER_API}/quote`, {
        params: {
          inputMint: pair.mintA,
          outputMint: pair.mintB,
          amount,
          slippageBps: 50,
          onlyDirectRoutes: false,
        },
        timeout: 5000,
      });

      const route = response.data;
      if (!route || !route.routePlan || route.routePlan.length === 0) {
        return null;
      }

      // Calculate effective price and spread
      const inputAmount = parseFloat(route.inAmount);
      const outputAmount = parseFloat(route.outAmount);
      const price = outputAmount / inputAmount;
      
      // Simulate reverse quote to find spread
      const reverseResponse = await axios.get(`${this.JUPITER_API}/quote`, {
        params: {
          inputMint: pair.mintB,
          outputMint: pair.mintA,
          amount: Math.floor(outputAmount),
          slippageBps: 50,
        },
        timeout: 5000,
      });

      const reverseRoute = reverseResponse.data;
      if (!reverseRoute) return null;

      const reverseOutput = parseFloat(reverseRoute.outAmount);
      const roundTripProfit = reverseOutput - inputAmount;
      const spreadPercent = (roundTripProfit / inputAmount) * 100;

      // Only return if profitable after fees (0.113% total)
      const netSpread = spreadPercent - 0.113;
      
      if (netSpread <= 0) return null;

      const dexes = route.routePlan.map((r: any) => r.swapInfo?.label || 'Unknown');
      
      return {
        pair,
        buyDex: dexes[0] || 'Jupiter',
        sellDex: dexes[dexes.length - 1] || 'Jupiter',
        buyPrice: price,
        sellPrice: price * (1 + spreadPercent / 100),
        spread: roundTripProfit,
        spreadPercent,
        estimatedProfit: (netSpread / 100) * 1000, // On $1000 trade
        confidence: this.calculateConfidence(pair, spreadPercent),
        reasoning: this.generateReasoning(pair, spreadPercent, dexes),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate confidence score based on pair characteristics
   */
  private calculateConfidence(pair: EstablishedPair, spread: number): number {
    let confidence = 0.7; // Base confidence for established pairs

    // High liquidity bonus
    if (pair.liquidity > 10000000) confidence += 0.15;
    else if (pair.liquidity > 5000000) confidence += 0.1;

    // High volume bonus
    if (pair.volume24h > 10000000) confidence += 0.1;
    else if (pair.volume24h > 5000000) confidence += 0.05;

    // Spread quality bonus
    if (spread > 0.5) confidence += 0.1;
    else if (spread > 0.3) confidence += 0.05;

    // Priority bonus
    if (pair.priority === 'high') confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate reasoning for opportunity
   */
  private generateReasoning(pair: EstablishedPair, spread: number, dexes: string[]): string {
    const reasons: string[] = [];

    reasons.push(`${pair.tokenA}/${pair.tokenB} liquid pair`);
    
    if (pair.liquidity > 10000000) {
      reasons.push(`$${(pair.liquidity / 1e6).toFixed(0)}M liquidity`);
    }
    
    if (spread > 0.5) {
      reasons.push('🔥 High spread');
    } else if (spread > 0.3) {
      reasons.push('✅ Good spread');
    }
    
    if (dexes.length > 0) {
      reasons.push(`Route: ${dexes.join('→')}`);
    }
    
    if (pair.priority === 'high') {
      reasons.push('⭐ Priority pair');
    }

    return reasons.join(' | ');
  }

  /**
   * Get recommended pairs to scan based on market conditions
   */
  getRecommendedPairs(): EstablishedPair[] {
    return this.TARGET_PAIRS.filter(p => p.priority === 'high');
  }

  /**
   * Quick scan of top 3 pairs only (for fast iteration)
   */
  async quickScan(): Promise<ArbitrageOpportunity[]> {
    const topPairs = this.TARGET_PAIRS.slice(0, 3);
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const pair of topPairs) {
      try {
        const opp = await this.scanPair(pair);
        if (opp && opp.spreadPercent > 0.12) {
          opportunities.push(opp);
        }
      } catch {
        continue;
      }
    }
    
    return opportunities;
  }
}

export const establishedScanner = (connection: Connection) => new EstablishedTokenScanner(connection);
