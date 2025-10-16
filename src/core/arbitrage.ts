import { PublicKey } from '@solana/web3.js';
import { ArbitrageOpportunity, TradingRoute, PriceData } from '../types';
import { SolanaConnection } from './connection';
import axios from 'axios';

export class ArbitrageDetector {
  private priceCache: Map<string, PriceData> = new Map();
  private readonly CACHE_DURATION = 5000; // 5 seconds
  private readonly MIN_PROFIT_THRESHOLD = 0.002; // 0.2% minimum for better profitability

  constructor(private solanaConnection: SolanaConnection) {}

  async detectOpportunities(tokens: PublicKey[]): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Get latest prices from multiple DEXes
    await this.updatePrices(tokens);
    
    // Compare prices across DEXes to find arbitrage opportunities
    // Use parallel processing for faster detection
    const opportunityPromises: Promise<ArbitrageOpportunity | null>[] = [];
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];
        
        // Check both directions for maximum profitability
        opportunityPromises.push(this.findArbitrageOpportunity(tokenA, tokenB));
        opportunityPromises.push(this.findArbitrageOpportunity(tokenB, tokenA));
      }
    }
    
    const results = await Promise.allSettled(opportunityPromises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && result.value.profitPercent > this.MIN_PROFIT_THRESHOLD) {
        opportunities.push(result.value);
      }
    }
    
    // Sort by profit and filter duplicates
    return opportunities
      .sort((a, b) => b.profitPercent - a.profitPercent)
      .filter((opp, index, self) => 
        index === self.findIndex(o => 
          o.inputMint.toString() === opp.inputMint.toString() && 
          o.outputMint.toString() === opp.outputMint.toString()
        )
      )
      .slice(0, 10); // Return top 10 opportunities
  }

  private async findArbitrageOpportunity(
    tokenA: PublicKey,
    tokenB: PublicKey
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Get prices from different DEXes with larger amount for better price discovery
      const testAmount = 10000; // Increased from 1000 for more realistic profitability
      const jupiterRoute = await this.getJupiterRoute(tokenA, tokenB, testAmount);
      const orcaRoute = await this.getOrcaRoute(tokenA, tokenB, testAmount);
      const raydiumRoute = await this.getRaydiumRoute(tokenA, tokenB, testAmount);
      
      const routes = [jupiterRoute, orcaRoute, raydiumRoute].filter(Boolean);
      
      if (routes.length < 2) {
        return null; // Need at least 2 routes for arbitrage
      }
      
      // Find the best buy and sell routes
      const bestBuy = routes.reduce((best, current) =>
        current!.outputAmount > best!.outputAmount ? current : best
      );
      
      const bestSell = routes.reduce((best, current) =>
        current!.inputAmount < best!.inputAmount ? current : best
      );
      
      if (!bestBuy || !bestSell || bestBuy === bestSell) {
        return null;
      }
      
      const profit = bestBuy.outputAmount - bestSell.inputAmount;
      
      // Account for gas fees and flashloan fees in profit calculation
      const gasFee = 0.005; // 0.005 SOL estimated gas fee
      const flashloanFee = testAmount * 0.0003; // 0.03% flashloan fee
      const totalFees = gasFee + flashloanFee;
      const netProfit = profit - totalFees;
      const netProfitPercent = netProfit / testAmount;
      
      if (netProfit <= 0) {
        return null;
      }
      
      return {
        inputMint: tokenA,
        outputMint: tokenB,
        inputAmount: testAmount,
        expectedOutput: bestBuy.outputAmount,
        profit: netProfit,
        profitPercent: netProfitPercent,
        route: [bestSell, bestBuy],
        gasEstimate: gasFee,
      };
    } catch (error) {
      console.error('Error finding arbitrage opportunity:', error);
      return null;
    }
  }

  private async getJupiterRoute(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number
  ): Promise<TradingRoute | null> {
    try {
      // Use Jupiter V6 API with better slippage settings
      const response = await axios.get(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint.toString()}&outputMint=${outputMint.toString()}&amount=${amount}&slippageBps=30&onlyDirectRoutes=false&maxAccounts=64`,
        {
          timeout: 3000, // 3 second timeout for faster response
        }
      );
      
      if (response.data && response.data.outAmount) {
        return {
          dex: 'jupiter',
          inputMint,
          outputMint,
          inputAmount: amount,
          outputAmount: parseInt(response.data.outAmount),
          priceImpact: response.data.priceImpactPct || 0,
        };
      }
    } catch (error) {
      // Silent fail for API errors - this is normal in fast scanning
      if (axios.isAxiosError(error) && error.code !== 'ECONNABORTED') {
        console.debug('Jupiter API temporary unavailable');
      }
    }
    
    return null;
  }

  private async getOrcaRoute(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number
  ): Promise<TradingRoute | null> {
    try {
      // Use Orca Whirlpool API for real price quotes
      const response = await axios.get(
        `https://api.mainnet.orca.so/v1/quote?inputMint=${inputMint.toString()}&outputMint=${outputMint.toString()}&amount=${amount}&slippage=0.5`,
        {
          timeout: 3000,
        }
      );
      
      if (response.data && response.data.outAmount) {
        return {
          dex: 'orca',
          inputMint,
          outputMint,
          inputAmount: amount,
          outputAmount: parseInt(response.data.outAmount),
          priceImpact: response.data.priceImpact || 0,
        };
      }
    } catch (error) {
      // Silent fail for API errors
      if (axios.isAxiosError(error) && error.code !== 'ECONNABORTED') {
        console.debug('Orca API temporary unavailable');
      }
    }
    
    return null;
  }

  private async getRaydiumRoute(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number
  ): Promise<TradingRoute | null> {
    try {
      // Use Raydium API for real price quotes
      const response = await axios.get(
        `https://api.raydium.io/v2/main/quote?inputMint=${inputMint.toString()}&outputMint=${outputMint.toString()}&amount=${amount}&slippage=0.5`,
        {
          timeout: 3000,
        }
      );
      
      if (response.data && response.data.outAmount) {
        return {
          dex: 'raydium',
          inputMint,
          outputMint,
          inputAmount: amount,
          outputAmount: parseInt(response.data.outAmount),
          priceImpact: response.data.priceImpact || 0,
        };
      }
    } catch (error) {
      // Silent fail for API errors
      if (axios.isAxiosError(error) && error.code !== 'ECONNABORTED') {
        console.debug('Raydium API temporary unavailable');
      }
    }
    
    return null;
  }

  private async updatePrices(tokens: PublicKey[]): Promise<void> {
    const now = Date.now();
    
    for (const token of tokens) {
      const cacheKey = token.toString();
      const cached = this.priceCache.get(cacheKey);
      
      if (!cached || now - cached.timestamp > this.CACHE_DURATION) {
        // Update price cache from real price feeds
        try {
          // Use Jupiter price API for real price data
          const response = await axios.get(
            `https://price.jup.ag/v4/price?ids=${token.toString()}`,
            { timeout: 3000 }
          );
          
          if (response.data && response.data.data && response.data.data[token.toString()]) {
            const priceInfo = response.data.data[token.toString()];
            const priceData: PriceData = {
              mint: token,
              price: priceInfo.price || 0,
              liquidity: priceInfo.liquidity || 0,
              timestamp: now,
              source: 'jupiter',
            };
            
            this.priceCache.set(cacheKey, priceData);
          }
        } catch (error) {
          console.debug(`Failed to update price for ${token.toString()}:`, error);
        }
      }
    }
  }

  getPrice(token: PublicKey): PriceData | null {
    return this.priceCache.get(token.toString()) || null;
  }
}