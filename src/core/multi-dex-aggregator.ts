import { Connection, PublicKey } from '@solana/web3.js';
import { RaydiumDirect } from './raydium-direct';
import { OrcaDirect } from './orca-direct';

/**
 * Multi-DEX Aggregator
 * Combines Raydium and Orca to find best prices
 * NO JUPITER - NO RATE LIMITS!
 */

export interface DEXQuote {
  dex: 'raydium' | 'orca';
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  priceImpact: number;
  fee: number;
  price: number; // Output amount per input unit
}

export interface AggregatedQuote {
  bestQuote: DEXQuote;
  allQuotes: DEXQuote[];
  inputToken: string;
  outputToken: string;
  amountIn: number;
  bestAmountOut: number;
  bestDEX: string;
  priceDifference?: number; // % difference between best and worst
}

export class MultiDEXAggregator {
  private connection: Connection;
  private raydium: RaydiumDirect;
  private orca: OrcaDirect;

  constructor(connection: Connection) {
    this.connection = connection;
    this.raydium = new RaydiumDirect(connection);
    this.orca = new OrcaDirect(connection);
  }

  /**
   * Get quotes from all DEXes and return the best one
   */
  async getBestQuote(
    inputMint: string,
    outputMint: string,
    amountIn: number
  ): Promise<AggregatedQuote | null> {
    try {
      const quotes: DEXQuote[] = [];

      // Get Raydium quote
      const raydiumQuote = await this.raydium.getQuote(
        new PublicKey(inputMint),
        new PublicKey(outputMint),
        amountIn
      );
      if (raydiumQuote) {
        quotes.push({
          dex: 'raydium',
          inputMint,
          outputMint,
          inAmount: raydiumQuote.inputAmount,
          outAmount: raydiumQuote.outputAmount,
          priceImpact: raydiumQuote.priceImpact,
          fee: raydiumQuote.fee,
          price: raydiumQuote.outputAmount / amountIn,
        });
      }

      // Get Orca quote
      const orcaQuote = await this.orca.getQuote(inputMint, outputMint, amountIn);
      if (orcaQuote) {
        quotes.push({
          dex: 'orca',
          inputMint,
          outputMint,
          inAmount: parseFloat(orcaQuote.inAmount),
          outAmount: parseFloat(orcaQuote.outAmount),
          priceImpact: orcaQuote.priceImpact,
          fee: parseFloat(orcaQuote.fee),
          price: parseFloat(orcaQuote.outAmount) / amountIn,
        });
      }

      if (quotes.length === 0) {
        console.log(`[MultiDEX] No quotes available for ${this.getTokenSymbol(inputMint)} -> ${this.getTokenSymbol(outputMint)}`);
        return null;
      }

      // Find best quote (highest output amount)
      const bestQuote = quotes.reduce((best, current) => {
        return current.outAmount > best.outAmount ? current : best;
      });

      // Calculate price difference between best and worst
      let priceDifference: number | undefined;
      if (quotes.length > 1) {
        const worstQuote = quotes.reduce((worst, current) => {
          return current.outAmount < worst.outAmount ? current : worst;
        });
        priceDifference = ((bestQuote.outAmount - worstQuote.outAmount) / worstQuote.outAmount) * 100;
      }

      return {
        bestQuote,
        allQuotes: quotes,
        inputToken: this.getTokenSymbol(inputMint),
        outputToken: this.getTokenSymbol(outputMint),
        amountIn,
        bestAmountOut: bestQuote.outAmount,
        bestDEX: bestQuote.dex,
        priceDifference,
      };
    } catch (error) {
      console.error('[MultiDEX] Error getting best quote:', error);
      return null;
    }
  }

  /**
   * Get current price from the best available DEX
   */
  async getPrice(baseMint: string, quoteMint: string): Promise<number | null> {
    try {
      const prices: Array<{ dex: string; price: number }> = [];

      // Get Raydium price
      const raydiumPrice = await this.raydium.getPrice(
        new PublicKey(baseMint),
        new PublicKey(quoteMint)
      );
      if (raydiumPrice) {
        prices.push({ dex: 'raydium', price: raydiumPrice });
      }

      // Get Orca price
      const orcaPrice = await this.orca.getPrice(baseMint, quoteMint);
      if (orcaPrice) {
        prices.push({ dex: 'orca', price: orcaPrice });
      }

      if (prices.length === 0) {
        return null;
      }

      // Return average of all available prices
      const avgPrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
      
      console.log(`[MultiDEX] Price for ${this.getTokenSymbol(baseMint)}/${this.getTokenSymbol(quoteMint)}: $${avgPrice.toFixed(6)} (avg of ${prices.length} DEXes)`);
      
      return avgPrice;
    } catch (error) {
      console.error('[MultiDEX] Error getting price:', error);
      return null;
    }
  }

  /**
   * Get prices for multiple token pairs in parallel
   */
  async getPrices(pairs: Array<{ base: string; quote: string }>): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    const promises = pairs.map(async ({ base, quote }) => {
      const price = await this.getPrice(base, quote);
      if (price) {
        const key = `${this.getTokenSymbol(base)}-${this.getTokenSymbol(quote)}`;
        priceMap.set(key, price);
      }
    });

    await Promise.all(promises);
    return priceMap;
  }

  /**
   * Check for arbitrage opportunity between DEXes
   * (Different prices on Raydium vs Orca = arbitrage!)
   */
  async checkCrossPoolArbitrage(
    inputMint: string,
    outputMint: string,
    amountIn: number
  ): Promise<{ profitable: boolean; profit: number; buyDEX: string; sellDEX: string } | null> {
    try {
      const aggregated = await this.getBestQuote(inputMint, outputMint, amountIn);
      if (!aggregated || aggregated.allQuotes.length < 2) {
        return null;
      }

      // Find highest and lowest prices
      const quotes = aggregated.allQuotes;
      const highestQuote = quotes.reduce((max, q) => 
        q.outAmount > max.outAmount ? q : max
      );
      const lowestQuote = quotes.reduce((min, q) => 
        q.outAmount < min.outAmount ? q : min
      );

      const profit = highestQuote.outAmount - lowestQuote.outAmount;
      const profitPercentage = (profit / lowestQuote.outAmount) * 100;

      return {
        profitable: profitPercentage > 0.5, // Profitable if >0.5% difference
        profit: profitPercentage,
        buyDEX: lowestQuote.dex, // Buy on cheaper DEX
        sellDEX: highestQuote.dex, // Sell on expensive DEX
      };
    } catch (error) {
      console.error('[MultiDEX] Error checking cross-pool arbitrage:', error);
      return null;
    }
  }

  /**
   * Get token symbol from mint address
   */
  private getTokenSymbol(mint: string): string {
    const symbols: Record<string, string> = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    };
    return symbols[mint] || mint.slice(0, 8);
  }
}

