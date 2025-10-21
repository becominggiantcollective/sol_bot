import { Connection, PublicKey } from '@solana/web3.js';
import { parsePriceData } from '@pythnetwork/client';

/**
 * On-chain price oracle using Pyth Network
 * This provides real-time prices without relying on external APIs
 */

// Pyth price feed IDs for major tokens
export const PYTH_PRICE_FEEDS = {
  SOL: new PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'), // SOL/USD
  USDC: new PublicKey('Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'), // USDC/USD
  USDT: new PublicKey('3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL'), // USDT/USD
  BTC: new PublicKey('GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU'), // BTC/USD
  ETH: new PublicKey('JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB'), // ETH/USD
};

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  status: 'trading' | 'halted' | 'unknown';
}

export class PythPriceOracle {
  private connection: Connection;
  private priceCache: Map<string, { data: PriceData; fetchedAt: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getPrice(feedId: PublicKey): Promise<PriceData | null> {
    try {
      // Check cache first
      const cached = this.priceCache.get(feedId.toString());
      if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
        return cached.data;
      }

      // Fetch account data from Pyth price feed
      const accountInfo = await this.connection.getAccountInfo(feedId);
      
      if (!accountInfo || !accountInfo.data) {
        console.debug(`No price data available for ${feedId.toString()}`);
        return null;
      }

      // Parse Pyth price data
      const priceData = parsePriceData(accountInfo.data);
      
      if (!priceData.price || !priceData.confidence) {
        return null;
      }

      const result: PriceData = {
        price: priceData.price,
        confidence: priceData.confidence,
        timestamp: Date.now(),
        status: 'trading',
      };

      // Cache the result
      this.priceCache.set(feedId.toString(), {
        data: result,
        fetchedAt: Date.now(),
      });

      return result;
    } catch (error) {
      console.error(`Error fetching price for ${feedId.toString()}:`, error);
      return null;
    }
  }

  async getSolPrice(): Promise<number | null> {
    const priceData = await this.getPrice(PYTH_PRICE_FEEDS.SOL);
    return priceData ? priceData.price : null;
  }

  async getUsdcPrice(): Promise<number | null> {
    const priceData = await this.getPrice(PYTH_PRICE_FEEDS.USDC);
    return priceData ? priceData.price : null;
  }

  async getPriceRatio(baseToken: PublicKey, quoteToken: PublicKey): Promise<number | null> {
    const [basePrice, quotePrice] = await Promise.all([
      this.getPrice(baseToken),
      this.getPrice(quoteToken),
    ]);

    if (!basePrice || !quotePrice || quotePrice.price === 0) {
      return null;
    }

    // Calculate price ratio with confidence check
    const maxConfidencePercent = 0.01; // 1% maximum confidence interval
    const baseConfPercent = basePrice.confidence / basePrice.price;
    const quoteConfPercent = quotePrice.confidence / quotePrice.price;

    if (baseConfPercent > maxConfidencePercent || quoteConfPercent > maxConfidencePercent) {
      console.warn('Price confidence too wide, skipping trade');
      return null;
    }

    return basePrice.price / quotePrice.price;
  }

  /**
   * Get multiple prices in parallel for efficiency
   */
  async getPrices(feedIds: PublicKey[]): Promise<Map<string, PriceData>> {
    const prices = new Map<string, PriceData>();

    const results = await Promise.allSettled(
      feedIds.map(feedId => this.getPrice(feedId))
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        prices.set(feedIds[index].toString(), result.value);
      }
    });

    return prices;
  }

  /**
   * Simple price check for arbitrage opportunities
   */
  async checkArbitrageOpportunity(
    tokenA: PublicKey,
    tokenB: PublicKey,
    minProfitPercent: number = 0.005 // 0.5% minimum
  ): Promise<boolean> {
    const ratio = await this.getPriceRatio(tokenA, tokenB);
    
    if (!ratio) {
      return false;
    }

    // In a real implementation, you would compare this ratio
    // against actual DEX pool prices to find arbitrage
    // For now, we just verify we can get the price
    
    console.log(`Price ratio ${tokenA.toString().slice(0, 8)}/${tokenB.toString().slice(0, 8)}: ${ratio.toFixed(6)}`);
    
    return ratio > 0;
  }
}
