import { PublicKey } from '@solana/web3.js';
import { SolanaConnection } from './connection';
import { LiquidationOpportunity } from '../types';
import { Logger } from '../utils';
import axios from 'axios';

export class LiquidationDetector {
  private priceCache: Map<string, number> = new Map();
  private logger: Logger;
  private readonly HEALTH_FACTOR_THRESHOLD = 1.0;
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private lastPriceUpdate = 0;

  constructor(private solanaConnection: SolanaConnection) {
    this.logger = Logger.getInstance();
  }

  async detectLiquidationOpportunities(): Promise<LiquidationOpportunity[]> {
    try {
      // Update prices if cache is stale
      if (Date.now() - this.lastPriceUpdate > this.CACHE_DURATION) {
        await this.updatePrices();
      }

      const allOpportunities: LiquidationOpportunity[] = [];

      // For demo purposes, create mock liquidation opportunities
      // In production, this would scan actual lending protocols
      const mockOpportunities = await this.createMockLiquidationOpportunities();
      allOpportunities.push(...mockOpportunities);

      // Sort by urgency and profit potential
      return allOpportunities
        .filter(opp => opp.healthFactor <= this.HEALTH_FACTOR_THRESHOLD)
        .sort((a, b) => {
          // First by urgency (critical > high > medium > low)
          const urgencyWeight = { critical: 4, high: 3, medium: 2, low: 1 };
          const urgencyDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
          if (urgencyDiff !== 0) return urgencyDiff;
          
          // Then by profit percentage
          return b.profitPercent - a.profitPercent;
        });

    } catch (error) {
      this.logger.error('Error detecting liquidation opportunities:', error);
      return [];
    }
  }

  private async createMockLiquidationOpportunities(): Promise<LiquidationOpportunity[]> {
    // Create some mock liquidation opportunities for testing
    const opportunities: LiquidationOpportunity[] = [];
    
    // Mock undercollateralized position
    const mockBorrower = new PublicKey('11111111111111111111111111111112');
    const solMint = new PublicKey('So11111111111111111111111111111111111111112');
    const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    opportunities.push({
      protocol: 'solend',
      borrower: mockBorrower,
      collateralMint: solMint,
      borrowMint: usdcMint,
      collateralAmount: 10, // 10 SOL
      borrowAmount: 950, // 950 USDC
      healthFactor: 0.95, // Undercollateralized
      liquidationThreshold: 0.85,
      maxLiquidationAmount: 475, // 50% of borrow
      estimatedProfit: 23.75, // 5% liquidation bonus
      profitPercent: 0.05,
      flashloanRequired: true,
      urgency: 'high',
      lastUpdated: Date.now(),
    });

    return opportunities;
  }

  private async updatePrices(): Promise<void> {
    try {
      // Get prices from multiple sources for accuracy and speed
      const [jupiterPrices, coinGeckoPrices] = await Promise.all([
        this.getJupiterPrices(),
        this.getCoinGeckoPrices(),
      ]);

      // Merge prices, preferring Jupiter for Solana tokens
      for (const [mint, price] of jupiterPrices) {
        this.priceCache.set(mint, price);
      }

      // Fill gaps with CoinGecko prices
      for (const [mint, price] of coinGeckoPrices) {
        if (!this.priceCache.has(mint)) {
          this.priceCache.set(mint, price);
        }
      }

      this.lastPriceUpdate = Date.now();
      this.logger.debug(`Updated prices for ${this.priceCache.size} tokens`);
    } catch (error) {
      this.logger.error('Error updating prices:', error);
    }
  }

  private async getJupiterPrices(): Promise<Map<string, number>> {
    try {
      // Use Jupiter API to get SOL/USDC price via quote
      const jupiterUrl = process.env.JUPITER_API_URL || 'https://public.jupiterapi.com';
      
      let quoteUrl: string;
      if (jupiterUrl.includes('quote-api')) {
        quoteUrl = `${jupiterUrl}/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50`;
      } else {
        quoteUrl = `${jupiterUrl}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50`;
      }
      
      const response = await axios.get(quoteUrl, { timeout: 5000 });

      const prices = new Map<string, number>();
      if (response.data?.outAmount) {
        // 1 SOL (100000000 lamports) = outAmount USDC (with 6 decimals)
        const solPriceInUSDC = parseInt(response.data.outAmount) / 1_000_000;
        prices.set('So11111111111111111111111111111111111111112', solPriceInUSDC);
        prices.set('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1.0); // USDC = $1
      }

      return prices;
    } catch (error) {
      this.logger.debug('Error fetching Jupiter prices, using fallback');
      // Fallback prices
      const fallback = new Map<string, number>();
      fallback.set('So11111111111111111111111111111111111111112', 190); // ~$190 SOL
      fallback.set('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1.0);
      return fallback;
    }
  }

  private async getCoinGeckoPrices(): Promise<Map<string, number>> {
    try {
      // Simplified CoinGecko integration - in production, you'd use their token list
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'solana,usd-coin',
          vs_currencies: 'usd',
        },
        timeout: 5000,
      });

      const prices = new Map<string, number>();
      if (response.data) {
        // Map CoinGecko IDs to Solana mint addresses
        const tokenMapping = {
          'solana': 'So11111111111111111111111111111111111111112',
          'usd-coin': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        };

        for (const [coinId, priceData] of Object.entries(response.data)) {
          const mint = tokenMapping[coinId as keyof typeof tokenMapping];
          if (mint && typeof (priceData as any).usd === 'number') {
            prices.set(mint, (priceData as any).usd);
          }
        }
      }

      return prices;
    } catch (error) {
      this.logger.error('Error fetching CoinGecko prices:', error);
      return new Map();
    }
  }
}

