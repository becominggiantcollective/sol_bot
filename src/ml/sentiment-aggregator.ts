/**
 * Sentiment Aggregator
 * Aggregates sentiment data from multiple sources and provides trading signals
 */

import { SentimentData, AggregatedSentiment, SentimentSignal, MLModelConfig } from './types';
import { Logger } from '../utils';

export class SentimentAggregator {
  private logger: Logger;
  private config: MLModelConfig;

  constructor(config: MLModelConfig) {
    this.config = config;
    this.logger = Logger.getInstance();
  }

  /**
   * Aggregate sentiment data from multiple sources
   * @param sentimentData Array of sentiment data points
   * @returns Aggregated sentiment
   */
  aggregate(sentimentData: SentimentData[]): AggregatedSentiment | null {
    if (sentimentData.length === 0) {
      return null;
    }

    // Group by source
    const bySource = {
      twitter: sentimentData.filter((s) => s.source === 'twitter'),
      telegram: sentimentData.filter((s) => s.source === 'telegram'),
    };

    // Calculate weighted average sentiment
    // Weight by confidence and engagement metrics
    let totalWeightedSentiment = 0;
    let totalWeight = 0;

    for (const data of sentimentData) {
      // Base weight is confidence
      let weight = data.confidence;

      // Increase weight for high engagement
      if (data.engagement) {
        const engagementScore =
          (data.engagement.likes || 0) +
          (data.engagement.retweets || 0) * 2 +
          (data.engagement.replies || 0);
        
        // Log scale for engagement to avoid outliers dominating
        weight *= 1 + Math.log10(Math.max(1, engagementScore));
      }

      totalWeightedSentiment += data.sentiment * weight;
      totalWeight += weight;
    }

    const overallSentiment = totalWeight > 0 ? totalWeightedSentiment / totalWeight : 0;

    // Calculate source-specific sentiments
    const twitterSentiment =
      bySource.twitter.length > 0
        ? bySource.twitter.reduce((sum, s) => sum + s.sentiment, 0) / bySource.twitter.length
        : 0;

    const telegramSentiment =
      bySource.telegram.length > 0
        ? bySource.telegram.reduce((sum, s) => sum + s.sentiment, 0) / bySource.telegram.length
        : 0;

    // Calculate overall confidence based on sample size and agreement
    const sampleSizeConfidence = Math.min(1, sentimentData.length / this.config.minSampleSize);
    
    // Calculate agreement between sources
    const sourceAgreement =
      bySource.twitter.length > 0 && bySource.telegram.length > 0
        ? 1 - Math.abs(twitterSentiment - telegramSentiment) / 2
        : 1;

    const confidence = sampleSizeConfidence * sourceAgreement;

    // Determine trend
    let trend: 'bullish' | 'bearish' | 'neutral';
    if (overallSentiment > this.config.sentimentThreshold) {
      trend = 'bullish';
    } else if (overallSentiment < -this.config.sentimentThreshold) {
      trend = 'bearish';
    } else {
      trend = 'neutral';
    }

    return {
      token: sentimentData[0].token,
      overallSentiment,
      confidence,
      sources: {
        twitter: twitterSentiment,
        telegram: telegramSentiment,
      },
      sampleSize: sentimentData.length,
      timestamp: Date.now(),
      trend,
    };
  }

  /**
   * Generate a trading signal based on aggregated sentiment
   * @param sentiment Aggregated sentiment
   * @param currentPrice Current token price (optional, for logging)
   * @returns Trading signal
   */
  generateSignal(sentiment: AggregatedSentiment, currentPrice?: number): SentimentSignal {
    // Check if we have enough data and confidence
    if (
      sentiment.sampleSize < this.config.minSampleSize ||
      sentiment.confidence < this.config.confidenceThreshold
    ) {
      return {
        action: 'hold',
        confidence: sentiment.confidence,
        sentiment,
        reasoning: `Insufficient data or confidence (samples: ${sentiment.sampleSize}, confidence: ${sentiment.confidence.toFixed(2)})`,
      };
    }

    let action: 'buy' | 'sell' | 'hold';
    let reasoning: string;

    const sentimentScore = sentiment.overallSentiment;
    const absScore = Math.abs(sentimentScore);

    if (sentiment.trend === 'bullish' && sentimentScore > this.config.sentimentThreshold) {
      action = 'buy';
      reasoning = `Strong bullish sentiment (${sentimentScore.toFixed(2)}) across ${sentiment.sampleSize} samples. `;
      reasoning += `Twitter: ${sentiment.sources.twitter.toFixed(2)}, Telegram: ${sentiment.sources.telegram.toFixed(2)}`;
      
      if (currentPrice) {
        reasoning += ` at price ${currentPrice}`;
      }
    } else if (sentiment.trend === 'bearish' && sentimentScore < -this.config.sentimentThreshold) {
      action = 'sell';
      reasoning = `Strong bearish sentiment (${sentimentScore.toFixed(2)}) across ${sentiment.sampleSize} samples. `;
      reasoning += `Twitter: ${sentiment.sources.twitter.toFixed(2)}, Telegram: ${sentiment.sources.telegram.toFixed(2)}`;
      
      if (currentPrice) {
        reasoning += ` at price ${currentPrice}`;
      }
    } else {
      action = 'hold';
      reasoning = `Neutral or weak sentiment (${sentimentScore.toFixed(2)}). `;
      reasoning += `Not enough conviction to trade (threshold: ±${this.config.sentimentThreshold})`;
    }

    // Adjust confidence based on sentiment strength
    const adjustedConfidence = sentiment.confidence * absScore;

    this.logger.info(`Generated signal for ${sentiment.token}: ${action} (confidence: ${adjustedConfidence.toFixed(2)})`);

    return {
      action,
      confidence: adjustedConfidence,
      sentiment,
      reasoning,
    };
  }

  /**
   * Analyze sentiment trend over time
   * @param historicalSentiment Array of historical aggregated sentiment
   * @returns Trend analysis
   */
  analyzeTrend(
    historicalSentiment: AggregatedSentiment[]
  ): {
    direction: 'improving' | 'declining' | 'stable';
    momentum: number;
    volatility: number;
  } {
    if (historicalSentiment.length < 2) {
      return { direction: 'stable', momentum: 0, volatility: 0 };
    }

    // Sort by timestamp
    const sorted = [...historicalSentiment].sort((a, b) => a.timestamp - b.timestamp);

    // Calculate momentum (rate of change)
    const recent = sorted.slice(-5); // Last 5 data points
    const sentiments = recent.map((s) => s.overallSentiment);
    
    let momentum = 0;
    for (let i = 1; i < sentiments.length; i++) {
      momentum += sentiments[i] - sentiments[i - 1];
    }
    momentum /= sentiments.length - 1;

    // Calculate volatility (standard deviation)
    const mean = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
    const variance =
      sentiments.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sentiments.length;
    const volatility = Math.sqrt(variance);

    // Determine direction
    let direction: 'improving' | 'declining' | 'stable';
    if (momentum > 0.05) {
      direction = 'improving';
    } else if (momentum < -0.05) {
      direction = 'declining';
    } else {
      direction = 'stable';
    }

    return { direction, momentum, volatility };
  }
}
