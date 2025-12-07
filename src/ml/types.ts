/**
 * Types for ML and Sentiment Analysis
 */

export interface SentimentData {
  source: 'twitter' | 'telegram';
  token: string;
  sentiment: number; // -1 to 1 scale
  confidence: number; // 0 to 1
  timestamp: number;
  text: string;
  author?: string;
  engagement?: {
    likes?: number;
    retweets?: number;
    replies?: number;
  };
}

export interface AggregatedSentiment {
  token: string;
  overallSentiment: number; // -1 to 1 scale
  confidence: number;
  sources: {
    twitter: number;
    telegram: number;
  };
  sampleSize: number;
  timestamp: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export interface SentimentCollectorConfig {
  twitter?: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
    bearerToken: string;
  };
  telegram?: {
    botToken: string;
    channels: string[];
  };
  enabled: boolean;
  updateInterval: number; // milliseconds
}

export interface MLModelConfig {
  modelPath?: string;
  sentimentThreshold: number; // threshold for considering sentiment significant
  minSampleSize: number; // minimum number of samples to make a decision
  confidenceThreshold: number; // minimum confidence to use sentiment
}

export interface SentimentSignal {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  sentiment: AggregatedSentiment;
  reasoning: string;
}
