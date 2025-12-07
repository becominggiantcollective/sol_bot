/**
 * Telegram Sentiment Collector
 * Collects messages from Telegram channels about tokens
 */

import { Telegraf } from 'telegraf';
import { SentimentData, SentimentCollectorConfig } from './types';
import { SentimentAnalyzer } from './sentiment-analyzer';
import { Logger } from '../utils';

export class TelegramSentimentCollector {
  private bot?: Telegraf;
  private analyzer: SentimentAnalyzer;
  private logger: Logger;
  private config: SentimentCollectorConfig;
  private messageCache: Map<string, SentimentData[]> = new Map();

  constructor(config: SentimentCollectorConfig) {
    this.config = config;
    this.analyzer = new SentimentAnalyzer();
    this.logger = Logger.getInstance();

    if (config.telegram?.botToken) {
      this.bot = new Telegraf(config.telegram.botToken);
      this.setupMessageHandler();
      this.logger.info('Telegram sentiment collector initialized');
    } else {
      this.logger.warn('Telegram bot token not provided, collector disabled');
    }
  }

  /**
   * Setup message handler for Telegram bot
   */
  private setupMessageHandler(): void {
    if (!this.bot) return;

    this.bot.on('text', (ctx) => {
      const text = ctx.message.text;
      const chatId = ctx.chat.id.toString();
      
      // Only process messages from configured channels
      if (this.config.telegram?.channels.includes(chatId)) {
        this.processMessage(text, ctx.from?.username || 'unknown');
      }
    });

    this.bot.on('channel_post', (ctx) => {
      if ('text' in ctx.channelPost && ctx.channelPost.text) {
        const text = ctx.channelPost.text;
        const chatId = ctx.channelPost.chat.id.toString();
        
        if (this.config.telegram?.channels.includes(chatId)) {
          this.processMessage(text, ctx.channelPost.chat.title || 'unknown');
        }
      }
    });
  }

  /**
   * Process a Telegram message
   * @param text Message text
   * @param author Author username or channel name
   */
  private processMessage(text: string, author: string): void {
    // Try to detect token mentions
    const tokenMatches = text.match(/\$([A-Z]+)/g);
    
    if (!tokenMatches) return;

    for (const match of tokenMatches) {
      const token = match.substring(1); // Remove $
      
      if (this.analyzer.isRelevant(text, token)) {
        const sentiment = this.analyzer.analyze(text, 'telegram', token, {
          author,
        });

        // Add to cache
        if (!this.messageCache.has(token)) {
          this.messageCache.set(token, []);
        }
        this.messageCache.get(token)!.push(sentiment);

        // Limit cache size per token
        const cache = this.messageCache.get(token)!;
        if (cache.length > 1000) {
          cache.shift(); // Remove oldest
        }
      }
    }
  }

  /**
   * Get collected sentiment for a token
   * @param token Token symbol
   * @param since Timestamp to get sentiment from (optional)
   * @returns Array of sentiment data
   */
  getSentiment(token: string, since?: number): SentimentData[] {
    const cache = this.messageCache.get(token) || [];
    
    if (since) {
      return cache.filter((s) => s.timestamp >= since);
    }
    
    return cache;
  }

  /**
   * Clear cache for a token
   * @param token Token symbol (if not provided, clears all)
   */
  clearCache(token?: string): void {
    if (token) {
      this.messageCache.delete(token);
    } else {
      this.messageCache.clear();
    }
  }

  /**
   * Start the Telegram bot
   */
  async start(): Promise<void> {
    if (!this.bot) {
      this.logger.warn('Telegram bot not initialized, cannot start');
      return;
    }

    try {
      await this.bot.launch();
      this.logger.info('Telegram bot started and listening for messages');
    } catch (error) {
      this.logger.error('Error starting Telegram bot:', error);
    }
  }

  /**
   * Stop the Telegram bot
   */
  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.logger.info('Telegram bot stopped');
    }
  }

  /**
   * Get sentiment for multiple tokens
   * @param tokens Array of token symbols
   * @param since Timestamp to get sentiment from (optional)
   * @returns Map of token to sentiment data
   */
  getMultipleSentiment(
    tokens: string[],
    since?: number
  ): Map<string, SentimentData[]> {
    const results = new Map<string, SentimentData[]>();
    
    for (const token of tokens) {
      results.set(token, this.getSentiment(token, since));
    }
    
    return results;
  }
}
