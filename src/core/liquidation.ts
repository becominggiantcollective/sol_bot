import { PublicKey } from '@solana/web3.js';
import { SolanaConnection } from './connection.js';
import { LiquidationOpportunity } from '../types/index.js';
import { Logger } from '../utils/index.js';
import { config } from '../config/index.js';
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

      // Scan Solend for underwater positions
      const solendOpps = await this.scanSolendLiquidations();
      allOpportunities.push(...solendOpps);

      if (allOpportunities.length > 0) {
        this.logger.info(`🔥 Found ${allOpportunities.length} liquidation opportunities!`);
      }

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

  /**
   * Scan Solend for liquidatable positions
   * Uses Solend's obligation accounts to find underwater borrowers
   */
  private async scanSolendLiquidations(): Promise<LiquidationOpportunity[]> {
    const opportunities: LiquidationOpportunity[] = [];
    
    try {
      // Solend main market obligations - these are accounts with borrow positions
      // In production, you'd fetch all obligation accounts via getProgramAccounts
      // For efficiency, we use Solend's API if available
      
      const response = await axios.get('https://api.solend.fi/v1/obligations', {
        params: { market: 'main' },
        timeout: 10000,
      }).catch(() => null);
      
      if (response?.data?.results) {
        for (const obligation of response.data.results) {
          // Check if position is liquidatable (health < 1.0)
          const healthFactor = obligation.loanToValue ? 1 / obligation.loanToValue : 999;
          
          if (healthFactor < 1.0 && obligation.borrowedValue > 0) {
            const solPrice = this.priceCache.get('So11111111111111111111111111111111111111112') || 230;
            const borrowValue = obligation.borrowedValue || 0;
            const collateralValue = obligation.depositedValue || 0;
            
            // Liquidation bonus is typically 5-10%
            const liquidationBonus = 0.05;
            const maxLiquidation = Math.min(borrowValue * 0.5, collateralValue * 0.5); // Close factor
            const estimatedProfit = maxLiquidation * liquidationBonus;
            
            if (estimatedProfit > 0.5) { // Only if profit > $0.50
              opportunities.push({
                protocol: 'solend',
                borrower: new PublicKey(obligation.obligationAddress || obligation.owner),
                collateralMint: new PublicKey('So11111111111111111111111111111111111111112'), // Simplified
                borrowMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // Simplified
                collateralAmount: collateralValue / solPrice,
                borrowAmount: borrowValue,
                healthFactor,
                liquidationThreshold: 0.85,
                maxLiquidationAmount: maxLiquidation,
                estimatedProfit,
                profitPercent: estimatedProfit / maxLiquidation,
                urgency: healthFactor < 0.9 ? 'critical' : healthFactor < 0.95 ? 'high' : 'medium',
                flashloanRequired: maxLiquidation > 100, // Flash loan for > $100
                lastUpdated: Date.now(),
              });
              
              this.logger.info(`💰 Solend liquidation: HF=${healthFactor.toFixed(3)}, Profit=$${estimatedProfit.toFixed(2)}`);
            }
          }
        }
      }
    } catch (error) {
      // Solend API might not be available, fall back to on-chain scanning
      this.logger.debug('Solend API not available, skipping API-based detection');
    }
    
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
      const headers: Record<string, string> = {};
      if (config.jupiter?.apiKey) {
        headers['x-api-key'] = config.jupiter.apiKey;
      }
      // Updated to use Jupiter Price API v3
      const response = await axios.get('https://api.jup.ag/price/v3', {
        params: {
          ids: 'So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // SOL, USDC, mSOL
        },
        timeout: 5000,
        headers,
      });

      const prices = new Map<string, number>();
      if (response.data) {
        // V3 format: { tokenAddress: { usdPrice: number, ... } }
        for (const [mint, data] of Object.entries(response.data as any)) {
          if (data && typeof (data as any).usdPrice === 'number') {
            prices.set(mint, (data as any).usdPrice);
          }
        }
      }

      return prices;
    } catch (error) {
      this.logger.error('Error fetching Jupiter prices:', error);
      return new Map();
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

