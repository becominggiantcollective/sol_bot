/**
 * Tests for ML Sentiment Analysis
 */

import { SentimentAnalyzer } from '../ml/sentiment-analyzer';
import { SentimentAggregator } from '../ml/sentiment-aggregator';
import { SentimentData, AggregatedSentiment } from '../ml/types';

describe('SentimentAnalyzer', () => {
  let analyzer: SentimentAnalyzer;

  beforeEach(() => {
    analyzer = new SentimentAnalyzer();
  });

  test('should analyze positive sentiment', () => {
    const result = analyzer.analyze(
      'SOL is going to the moon! 🚀 Great project!',
      'twitter',
      'SOL'
    );

    expect(result.sentiment).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.source).toBe('twitter');
    expect(result.token).toBe('SOL');
  });

  test('should analyze negative sentiment', () => {
    const result = analyzer.analyze(
      'This token is terrible, avoid at all costs',
      'twitter',
      'SCAM'
    );

    expect(result.sentiment).toBeLessThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('should analyze neutral sentiment', () => {
    const result = analyzer.analyze(
      'The token exists',
      'twitter',
      'TOKEN'
    );

    expect(Math.abs(result.sentiment)).toBeLessThan(0.5);
  });

  test('should check relevance correctly', () => {
    expect(analyzer.isRelevant('SOL to the moon', 'SOL')).toBe(true);
    expect(analyzer.isRelevant('Buy $SOL now', 'SOL')).toBe(true);
    expect(analyzer.isRelevant('#SOL pumping', 'SOL')).toBe(true);
    expect(analyzer.isRelevant('SOLUSDC pair', 'SOL')).toBe(true);
    expect(analyzer.isRelevant('Bitcoin rising', 'SOL')).toBe(false);
  });

  test('should handle batch analysis', () => {
    const texts = [
      { text: 'Great token!', source: 'twitter' as const, token: 'TOKEN1' },
      { text: 'Bad token', source: 'telegram' as const, token: 'TOKEN2' },
    ];

    const results = analyzer.analyzeBatch(texts);
    
    expect(results).toHaveLength(2);
    expect(results[0].sentiment).toBeGreaterThan(0);
    expect(results[1].sentiment).toBeLessThan(0);
  });
});

describe('SentimentAggregator', () => {
  let aggregator: SentimentAggregator;

  beforeEach(() => {
    aggregator = new SentimentAggregator({
      sentimentThreshold: 0.3,
      minSampleSize: 3,
      confidenceThreshold: 0.5,
    });
  });

  test('should aggregate positive sentiment', () => {
    const sentimentData: SentimentData[] = [
      {
        source: 'twitter',
        token: 'SOL',
        sentiment: 0.8,
        confidence: 0.9,
        timestamp: Date.now(),
        text: 'Great!',
      },
      {
        source: 'twitter',
        token: 'SOL',
        sentiment: 0.7,
        confidence: 0.8,
        timestamp: Date.now(),
        text: 'Amazing!',
      },
      {
        source: 'telegram',
        token: 'SOL',
        sentiment: 0.6,
        confidence: 0.7,
        timestamp: Date.now(),
        text: 'Bullish!',
      },
    ];

    const result = aggregator.aggregate(sentimentData);
    
    expect(result).not.toBeNull();
    expect(result!.overallSentiment).toBeGreaterThan(0);
    expect(result!.trend).toBe('bullish');
    expect(result!.sampleSize).toBe(3);
  });

  test('should aggregate negative sentiment', () => {
    const sentimentData: SentimentData[] = [
      {
        source: 'twitter',
        token: 'SCAM',
        sentiment: -0.8,
        confidence: 0.9,
        timestamp: Date.now(),
        text: 'Terrible!',
      },
      {
        source: 'twitter',
        token: 'SCAM',
        sentiment: -0.7,
        confidence: 0.8,
        timestamp: Date.now(),
        text: 'Avoid!',
      },
      {
        source: 'telegram',
        token: 'SCAM',
        sentiment: -0.6,
        confidence: 0.7,
        timestamp: Date.now(),
        text: 'Bearish!',
      },
    ];

    const result = aggregator.aggregate(sentimentData);
    
    expect(result).not.toBeNull();
    expect(result!.overallSentiment).toBeLessThan(0);
    expect(result!.trend).toBe('bearish');
  });

  test('should generate buy signal for strong positive sentiment', () => {
    const sentiment: AggregatedSentiment = {
      token: 'SOL',
      overallSentiment: 0.8,
      confidence: 0.9,
      sources: { twitter: 0.8, telegram: 0.7 },
      sampleSize: 50,
      timestamp: Date.now(),
      trend: 'bullish',
    };

    const signal = aggregator.generateSignal(sentiment, 100);
    
    expect(signal.action).toBe('buy');
    expect(signal.confidence).toBeGreaterThan(0.5);
  });

  test('should generate sell signal for strong negative sentiment', () => {
    const sentiment: AggregatedSentiment = {
      token: 'SCAM',
      overallSentiment: -0.8,
      confidence: 0.9,
      sources: { twitter: -0.8, telegram: -0.7 },
      sampleSize: 50,
      timestamp: Date.now(),
      trend: 'bearish',
    };

    const signal = aggregator.generateSignal(sentiment, 100);
    
    expect(signal.action).toBe('sell');
  });

  test('should generate hold signal for insufficient data', () => {
    const sentiment: AggregatedSentiment = {
      token: 'TOKEN',
      overallSentiment: 0.5,
      confidence: 0.9,
      sources: { twitter: 0.5, telegram: 0.5 },
      sampleSize: 2, // Below minSampleSize of 3
      timestamp: Date.now(),
      trend: 'neutral',
    };

    const signal = aggregator.generateSignal(sentiment);
    
    expect(signal.action).toBe('hold');
  });

  test('should generate hold signal for low confidence', () => {
    const sentiment: AggregatedSentiment = {
      token: 'TOKEN',
      overallSentiment: 0.5,
      confidence: 0.3, // Below confidenceThreshold of 0.5
      sources: { twitter: 0.5, telegram: 0.5 },
      sampleSize: 10,
      timestamp: Date.now(),
      trend: 'neutral',
    };

    const signal = aggregator.generateSignal(sentiment);
    
    expect(signal.action).toBe('hold');
  });

  test('should analyze trend correctly', () => {
    const historical: AggregatedSentiment[] = [
      {
        token: 'SOL',
        overallSentiment: 0.2,
        confidence: 0.8,
        sources: { twitter: 0.2, telegram: 0.2 },
        sampleSize: 10,
        timestamp: Date.now() - 10000,
        trend: 'neutral',
      },
      {
        token: 'SOL',
        overallSentiment: 0.4,
        confidence: 0.8,
        sources: { twitter: 0.4, telegram: 0.4 },
        sampleSize: 10,
        timestamp: Date.now() - 5000,
        trend: 'bullish',
      },
      {
        token: 'SOL',
        overallSentiment: 0.6,
        confidence: 0.8,
        sources: { twitter: 0.6, telegram: 0.6 },
        sampleSize: 10,
        timestamp: Date.now(),
        trend: 'bullish',
      },
    ];

    const trend = aggregator.analyzeTrend(historical);
    
    expect(trend.direction).toBe('improving');
    expect(trend.momentum).toBeGreaterThan(0);
  });

  test('should return null for empty sentiment data', () => {
    const result = aggregator.aggregate([]);
    expect(result).toBeNull();
  });
});
