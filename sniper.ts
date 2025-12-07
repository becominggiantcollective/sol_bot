#!/usr/bin/env node
/**
 * NEW TOKEN SNIPER WITH ML SENTIMENT ANALYSIS
 * 
 * Run: npm run sniper
 * 
 * This finds brand new tokens on pump.fun/Raydium and catches
 * the initial price momentum using ML-powered sentiment analysis
 * from Twitter/X and Telegram to make smarter trading decisions.
 * 
 * Features:
 * - Real-time sentiment analysis from social media
 * - ML-powered trading signals
 * - Combines technical + sentiment analysis
 * - Risk scoring based on community sentiment
 * 
 * RISK WARNING: This is high risk! New tokens can:
 * - Rug pull (developers dump and run)
 * - Have honeypot contracts (can't sell)
 * - Crash 90%+ in minutes
 * 
 * Only use what you can afford to lose.
 */

import { SentimentAwareSniperStrategy } from './src/strategies/sniper';
import { sentimentConfig } from './src/config';
import { PublicKey } from '@solana/web3.js';

console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║     🎯 AI-POWERED TOKEN SNIPER 🤖                   ║');
console.log('║                                                       ║');
console.log('║  ML Sentiment Analysis from Twitter & Telegram      ║');
console.log('║  Target: 10% gains | Stop Loss: 15%                  ║');
console.log('║                                                       ║');
console.log('║  ⚠️  HIGH RISK - New tokens can rug/crash!          ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

export async function runSniper() {
  try {
    // Check if sentiment analysis is enabled
    if (!sentimentConfig.enabled) {
      console.log('⚠️  Sentiment analysis is DISABLED');
      console.log('   Set SENTIMENT_ENABLED=true in .env to enable');
      console.log('   Bot will run with technical analysis only\n');
    } else {
      console.log('✅ Sentiment analysis ENABLED');
      
      if (sentimentConfig.twitter) {
        console.log('   - Twitter/X: Connected');
      } else {
        console.log('   - Twitter/X: Not configured');
      }
      
      if (sentimentConfig.telegram) {
        console.log('   - Telegram: Connected');
        console.log(`   - Monitoring ${sentimentConfig.telegram.channels.length} channels`);
      } else {
        console.log('   - Telegram: Not configured');
      }
      console.log('');
    }

    // Initialize strategy
    const mlConfig = {
      sentimentThreshold: sentimentConfig.sentimentThreshold,
      minSampleSize: sentimentConfig.minSampleSize,
      confidenceThreshold: sentimentConfig.confidenceThreshold,
    };

    const strategy = new SentimentAwareSniperStrategy(sentimentConfig, mlConfig);

    // Start real-time collection if Telegram is configured
    if (sentimentConfig.telegram) {
      await strategy.startRealtimeCollection();
    }

    console.log('🚀 Sniper bot started...\n');
    console.log('Scanning for new token opportunities...\n');

    // Example: Analyze a token opportunity
    // In production, this would scan for new tokens continuously
    const exampleToken = new PublicKey('So11111111111111111111111111111111111111112'); // SOL
    const opportunity = await strategy.analyzeOpportunity(
      exampleToken,
      'SOL',
      100.0, // Current price
      1000000 // Liquidity
    );

    console.log('📊 Example Analysis:');
    console.log(`   Token: ${opportunity.symbol}`);
    console.log(`   Price: $${opportunity.currentPrice}`);
    console.log(`   Liquidity: $${opportunity.liquidity}`);
    
    if (opportunity.sentiment) {
      console.log(`   Sentiment: ${opportunity.sentiment.overallSentiment.toFixed(2)} (${opportunity.sentiment.trend})`);
      console.log(`   Confidence: ${opportunity.confidence.toFixed(2)}`);
      console.log(`   Samples: ${opportunity.sentiment.sampleSize}`);
      console.log(`   - Twitter: ${opportunity.sentiment.sources.twitter.toFixed(2)}`);
      console.log(`   - Telegram: ${opportunity.sentiment.sources.telegram.toFixed(2)}`);
    } else {
      console.log(`   Sentiment: Not available yet`);
    }
    console.log('');

    // In production, implement continuous scanning loop here
    console.log('⏸️  Demo mode - press Ctrl+C to exit');
    
    // Keep running for demo
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Cleanup
    await strategy.stopRealtimeCollection();

  } catch (error) {
    console.error('❌ Error running sniper:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runSniper().catch(console.error);
}
