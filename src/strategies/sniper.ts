/**
 * Sentiment-Aware Sniper Strategy
 * Combines technical analysis with ML sentiment analysis for token sniping
 */

import { PublicKey } from '@solana/web3.js';
import { ArbitrageOpportunity, MEVStrategy } from '../types';
import { SentimentCollectorConfig, MLModelConfig, AggregatedSentiment } from '../ml/types';
import { TwitterSentimentCollector } from '../ml/twitter-collector';
import { TelegramSentimentCollector } from '../ml/telegram-collector';
import { SentimentAggregator } from '../ml/sentiment-aggregator';
import { Logger } from '../utils';

export interface SniperOpportunity {
  token: PublicKey;
  symbol: string;
  currentPrice: number;
  liquidity: number;
  volume24h?: number;
  priceChange?: number;
  sentiment?: AggregatedSentiment;
  confidence: number;
}

export class SentimentAwareSniperStrategy implements MEVStrategy {
  name = 'sentiment-aware-sniper';
  description = 'Snipes new tokens using ML sentiment analysis from Twitter and Telegram';

  private twitterCollector: TwitterSentimentCollector;
  private telegramCollector: TelegramSentimentCollector;
  private sentimentAggregator: SentimentAggregator;
  private logger: Logger;
  private sentimentCache: Map<string, AggregatedSentiment> = new Map();
  private lastUpdate: Map<string, number> = new Map();

  constructor(
    sentimentConfig: SentimentCollectorConfig,
    mlConfig: MLModelConfig
  ) {
    this.logger = Logger.getInstance();
    this.twitterCollector = new TwitterSentimentCollector(sentimentConfig);
    this.telegramCollector = new TelegramSentimentCollector(sentimentConfig);
    this.sentimentAggregator = new SentimentAggregator(mlConfig);

    this.logger.info('Sentiment-aware sniper strategy initialized');
  }

  /**
   * Check if an opportunity is viable based on sentiment
   * @param opportunity Arbitrage opportunity
   * @returns Whether the opportunity is viable
   */
  isViable(opportunity: ArbitrageOpportunity): boolean {
    // Basic profitability check
    if (opportunity.profit <= 0 || opportunity.profitPercent < 0.01) {
      return false;
    }

    // Check if we have recent sentiment data
    const tokenSymbol = this.getTokenSymbol(opportunity.inputMint);
    const sentiment = this.sentimentCache.get(tokenSymbol);

    if (!sentiment) {
      // No sentiment data - proceed with caution
      this.logger.debug(`No sentiment data for ${tokenSymbol}, using technical analysis only`);
      return opportunity.profitPercent > 0.05; // Higher threshold without sentiment
    }

    // Use sentiment to enhance decision
    const signal = this.sentimentAggregator.generateSignal(sentiment, opportunity.inputAmount);

    if (signal.action === 'sell' || signal.action === 'hold') {
      this.logger.debug(
        `Sentiment signal is ${signal.action} for ${tokenSymbol}, skipping opportunity`
      );
      return false;
    }

    // Buy signal - check confidence
    if (signal.confidence < 0.3) {
      this.logger.debug(
        `Low sentiment confidence (${signal.confidence.toFixed(2)}) for ${tokenSymbol}`
      );
      return opportunity.profitPercent > 0.03; // Medium threshold
    }

    // Strong buy signal with high confidence
    this.logger.info(
      `Strong buy signal for ${tokenSymbol}: ${signal.reasoning}`
    );
    return true;
  }

  /**
   * Execute the sniper strategy
   * @param opportunity Arbitrage opportunity
   * @returns Transaction signature
   */
  async execute(opportunity: ArbitrageOpportunity): Promise<string> {
    const tokenSymbol = this.getTokenSymbol(opportunity.inputMint);
    
    this.logger.info(
      `Executing sentiment-aware sniper for ${tokenSymbol}, ` +
      `profit: ${opportunity.profitPercent.toFixed(2)}%`
    );

    // In a real implementation, this would execute the trade
    // For now, return a mock signature
    return 'sentiment-aware-sniper-executed-' + Date.now();
  }

  /**
   * Analyze a potential sniper opportunity
   * @param token Token public key
   * @param symbol Token symbol
   * @param currentPrice Current price
   * @param liquidity Available liquidity
   * @returns Sniper opportunity with sentiment analysis
   */
  async analyzeOpportunity(
    token: PublicKey,
    symbol: string,
    currentPrice: number,
    liquidity: number
  ): Promise<SniperOpportunity> {
    // Get or update sentiment
    await this.updateSentiment(symbol);

    const sentiment = this.sentimentCache.get(symbol);
    const signal = sentiment
      ? this.sentimentAggregator.generateSignal(sentiment, currentPrice)
      : null;

    const confidence = signal ? signal.confidence : 0.5; // Default confidence without sentiment

    this.logger.info(
      `Analyzed ${symbol}: price=${currentPrice}, liquidity=${liquidity}, ` +
      `sentiment=${sentiment?.overallSentiment.toFixed(2) || 'N/A'}, ` +
      `confidence=${confidence.toFixed(2)}`
    );

    return {
      token,
      symbol,
      currentPrice,
      liquidity,
      sentiment,
      confidence,
    };
  }

  /**
   * Update sentiment data for a token
   * @param symbol Token symbol
   */
  private async updateSentiment(symbol: string): Promise<void> {
    const now = Date.now();
    const lastUpdate = this.lastUpdate.get(symbol) || 0;
    const updateInterval = 5 * 60 * 1000; // 5 minutes

    // Skip if recently updated
    if (now - lastUpdate < updateInterval) {
      return;
    }

    try {
      // Collect sentiment from Twitter
      const twitterSentiment = await this.twitterCollector.collectSentiment(symbol, 50);

      // Collect sentiment from Telegram
      const telegramSentiment = this.telegramCollector.getSentiment(
        symbol,
        now - updateInterval
      );

      // Combine and aggregate
      const allSentiment = [...twitterSentiment, ...telegramSentiment];

      if (allSentiment.length > 0) {
        const aggregated = this.sentimentAggregator.aggregate(allSentiment);
        
        if (aggregated) {
          this.sentimentCache.set(symbol, aggregated);
          this.logger.debug(
            `Updated sentiment for ${symbol}: ${aggregated.overallSentiment.toFixed(2)} ` +
            `(${aggregated.sampleSize} samples)`
          );
        }
      }

      this.lastUpdate.set(symbol, now);
    } catch (error) {
      this.logger.error(`Error updating sentiment for ${symbol}:`, error);
    }
  }

  /**
   * Get token symbol from public key
   * @param mint Token mint public key
   * @returns Token symbol (placeholder implementation)
   */
  private getTokenSymbol(mint: PublicKey): string {
    // In a real implementation, this would fetch the token symbol from on-chain metadata
    // For now, return a shortened version of the public key
    return mint.toString().substring(0, 6).toUpperCase();
  }

  /**
   * Start the Telegram bot for real-time sentiment collection
   */
  async startRealtimeCollection(): Promise<void> {
    await this.telegramCollector.start();
    this.logger.info('Started real-time sentiment collection from Telegram');
  }

  /**
   * Stop the Telegram bot
   */
  async stopRealtimeCollection(): Promise<void> {
    await this.telegramCollector.stop();
    this.logger.info('Stopped real-time sentiment collection');
  }

  /**
   * Get sentiment summary for multiple tokens
   * @param symbols Array of token symbols
   * @returns Map of symbol to sentiment
   */
  async getSentimentSummary(symbols: string[]): Promise<Map<string, AggregatedSentiment | null>> {
    const summary = new Map<string, AggregatedSentiment | null>();

    for (const symbol of symbols) {
      await this.updateSentiment(symbol);
      summary.set(symbol, this.sentimentCache.get(symbol) || null);
    }

    return summary;
  }
}
