/**
 * Sentiment Analyzer
 * Uses natural language processing to analyze sentiment from text
 */

import { SentimentData } from './types';
// @ts-ignore - sentiment module has no type definitions
import Sentiment from 'sentiment';

export class SentimentAnalyzer {
  private sentiment: any;

  constructor() {
    this.sentiment = new Sentiment();
  }

  /**
   * Analyze sentiment from text
   * @param text Text to analyze
   * @param source Source of the text (twitter or telegram)
   * @param token Token symbol being discussed
   * @param metadata Additional metadata (author, engagement, etc.)
   * @returns Sentiment data
   */
  analyze(
    text: string,
    source: 'twitter' | 'telegram',
    token: string,
    metadata?: {
      author?: string;
      engagement?: {
        likes?: number;
        retweets?: number;
        replies?: number;
      };
    }
  ): SentimentData {
    const result = this.sentiment.analyze(text);
    
    // Normalize score to -1 to 1 range
    // sentiment library returns scores typically in range of -10 to 10
    const normalizedScore = Math.max(-1, Math.min(1, result.score / 10));
    
    // Calculate confidence based on comparative score and number of tokens
    // Higher comparative score (absolute value) = higher confidence
    const confidence = Math.min(1, Math.abs(result.comparative) * 2);

    return {
      source,
      token,
      sentiment: normalizedScore,
      confidence: Math.max(0.1, confidence), // Minimum confidence of 0.1
      timestamp: Date.now(),
      text,
      author: metadata?.author,
      engagement: metadata?.engagement,
    };
  }

  /**
   * Batch analyze multiple texts
   * @param texts Array of texts with metadata
   * @returns Array of sentiment data
   */
  analyzeBatch(
    texts: Array<{
      text: string;
      source: 'twitter' | 'telegram';
      token: string;
      metadata?: {
        author?: string;
        engagement?: {
          likes?: number;
          retweets?: number;
          replies?: number;
        };
      };
    }>
  ): SentimentData[] {
    return texts.map((item) =>
      this.analyze(item.text, item.source, item.token, item.metadata)
    );
  }

  /**
   * Determine if text is relevant to a token
   * @param text Text to check
   * @param token Token symbol
   * @returns Whether text is relevant
   */
  isRelevant(text: string, token: string): boolean {
    const lowerText = text.toLowerCase();
    const lowerToken = token.toLowerCase();
    
    // Check for token symbol, variations, and common patterns
    const patterns = [
      lowerToken,
      `$${lowerToken}`,
      `#${lowerToken}`,
      `${lowerToken}usdc`,
      `${lowerToken}sol`,
    ];
    
    return patterns.some((pattern) => lowerText.includes(pattern));
  }
}
