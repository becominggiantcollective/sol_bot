/**
 * Twitter/X Sentiment Collector
 * Collects tweets about tokens and analyzes sentiment
 */

import { TwitterApi } from 'twitter-api-v2';
import { SentimentData, SentimentCollectorConfig } from './types';
import { SentimentAnalyzer } from './sentiment-analyzer';
import { Logger } from '../utils';

export class TwitterSentimentCollector {
  private client?: TwitterApi;
  private analyzer: SentimentAnalyzer;
  private logger: Logger;
  private config: SentimentCollectorConfig;

  constructor(config: SentimentCollectorConfig) {
    this.config = config;
    this.analyzer = new SentimentAnalyzer();
    this.logger = Logger.getInstance();

    if (config.twitter?.bearerToken) {
      this.client = new TwitterApi(config.twitter.bearerToken);
      this.logger.info('Twitter sentiment collector initialized');
    } else {
      this.logger.warn('Twitter API credentials not provided, collector disabled');
    }
  }

  /**
   * Collect recent tweets about a token
   * @param token Token symbol to search for
   * @param maxResults Maximum number of tweets to collect
   * @returns Array of sentiment data
   */
  async collectSentiment(token: string, maxResults: number = 100): Promise<SentimentData[]> {
    if (!this.client) {
      this.logger.warn('Twitter client not initialized, skipping collection');
      return [];
    }

    try {
      // Search for tweets about the token
      const searchQuery = `(${token} OR $${token} OR #${token}) -is:retweet lang:en`;
      
      const tweets = await this.client.v2.search({
        query: searchQuery,
        max_results: Math.min(maxResults, 100), // Twitter API limits
        'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
        expansions: ['author_id'],
      });

      const sentimentData: SentimentData[] = [];

      for (const tweet of tweets.data.data || []) {
        // Check if tweet is relevant
        if (!this.analyzer.isRelevant(tweet.text, token)) {
          continue;
        }

        // Analyze sentiment
        const sentiment = this.analyzer.analyze(
          tweet.text,
          'twitter',
          token,
          {
            author: tweet.author_id,
            engagement: {
              likes: tweet.public_metrics?.like_count || 0,
              retweets: tweet.public_metrics?.retweet_count || 0,
              replies: tweet.public_metrics?.reply_count || 0,
            },
          }
        );

        sentimentData.push(sentiment);
      }

      this.logger.info(`Collected ${sentimentData.length} tweets for ${token}`);
      return sentimentData;

    } catch (error) {
      this.logger.error(`Error collecting Twitter sentiment for ${token}:`, error);
      return [];
    }
  }

  /**
   * Collect sentiment for multiple tokens
   * @param tokens Array of token symbols
   * @param maxResultsPerToken Maximum results per token
   * @returns Map of token to sentiment data
   */
  async collectMultiple(
    tokens: string[],
    maxResultsPerToken: number = 50
  ): Promise<Map<string, SentimentData[]>> {
    const results = new Map<string, SentimentData[]>();

    for (const token of tokens) {
      const sentiment = await this.collectSentiment(token, maxResultsPerToken);
      results.set(token, sentiment);
      
      // Rate limiting - wait 1 second between requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return results;
  }

  /**
   * Stream real-time tweets about tokens
   * @param tokens Array of token symbols to track
   * @param callback Callback function to handle new sentiment data
   */
  async streamSentiment(
    tokens: string[],
    callback: (sentiment: SentimentData) => void
  ): Promise<void> {
    if (!this.client) {
      this.logger.warn('Twitter client not initialized, cannot stream');
      return;
    }

    try {
      // Build search rules for streaming
      const rules = tokens.map((token) => ({
        value: `(${token} OR $${token} OR #${token}) -is:retweet lang:en`,
        tag: token,
      }));

      // Note: Streaming requires elevated access
      // This is a placeholder for the streaming implementation
      this.logger.info('Twitter streaming would be implemented here with elevated access');
      
    } catch (error) {
      this.logger.error('Error streaming Twitter sentiment:', error);
    }
  }
}
