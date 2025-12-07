# ML Sentiment Analysis Integration

This document explains the ML-powered sentiment analysis feature for enhanced trading decisions.

## Overview

The bot now includes machine learning-based sentiment analysis that collects and analyzes social media data from Twitter/X and Telegram to make smarter trading decisions. This helps identify community sentiment before making trades, reducing risk and improving profitability.

## Features

### 1. Real-time Sentiment Collection
- **Twitter/X Integration**: Collects tweets mentioning tokens using Twitter API v2
- **Telegram Integration**: Monitors Telegram channels for token discussions
- **Multi-source Aggregation**: Combines sentiment from multiple sources for better accuracy

### 2. Sentiment Analysis
- **NLP-based Analysis**: Uses natural language processing to extract sentiment from text
- **Confidence Scoring**: Calculates confidence levels based on sample size and agreement
- **Trend Detection**: Identifies bullish, bearish, or neutral trends

### 3. ML-Enhanced Trading Signals
- **Buy/Sell/Hold Recommendations**: Generates actionable trading signals
- **Risk Assessment**: Evaluates sentiment quality and confidence
- **Momentum Tracking**: Analyzes sentiment changes over time

## Architecture

```
src/ml/
├── types.ts                    # Type definitions for sentiment data
├── sentiment-analyzer.ts       # Core NLP sentiment analysis
├── twitter-collector.ts        # Twitter/X data collection
├── telegram-collector.ts       # Telegram data collection
├── sentiment-aggregator.ts     # Multi-source aggregation and signals
└── index.ts                    # Module exports

src/strategies/
└── sniper.ts                   # Sentiment-aware sniper strategy
```

## Setup

### 1. Install Dependencies

Already included in `package.json`:
- `sentiment` - NLP sentiment analysis
- `twitter-api-v2` - Twitter API client
- `telegraf` - Telegram bot framework
- `@tensorflow/tfjs-node` - ML framework (future use)

### 2. Configure API Keys

Add to your `.env` file:

```env
# Enable sentiment analysis
SENTIMENT_ENABLED=true

# Twitter/X API (Get from https://developer.twitter.com/)
TWITTER_BEARER_TOKEN=your_bearer_token_here

# Telegram Bot (Create via @BotFather)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHANNELS=channel_id_1,channel_id_2

# Sentiment parameters
SENTIMENT_UPDATE_INTERVAL=300000     # 5 minutes
SENTIMENT_THRESHOLD=0.3              # ±0.3 on -1 to 1 scale
SENTIMENT_MIN_SAMPLES=10             # Minimum samples for decision
SENTIMENT_CONFIDENCE_THRESHOLD=0.5   # Minimum confidence to act
```

### 3. Getting API Keys

#### Twitter/X API:
1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new app
3. Generate Bearer Token
4. Copy to `TWITTER_BEARER_TOKEN` in `.env`

#### Telegram Bot:
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Use `/newbot` command
3. Follow instructions to create bot
4. Copy token to `TELEGRAM_BOT_TOKEN` in `.env`
5. Add bot to your channels
6. Get channel IDs and add to `TELEGRAM_CHANNELS`

## Usage

### Running the Sentiment-Aware Sniper

```bash
npm run sniper
```

This runs the sniper bot with ML sentiment analysis enabled.

### Example Output

```
╔══════════════════════════════════════════════════════╗
║     🎯 AI-POWERED TOKEN SNIPER 🤖                   ║
║                                                       ║
║  ML Sentiment Analysis from Twitter & Telegram      ║
║  Target: 10% gains | Stop Loss: 15%                  ║
║                                                       ║
║  ⚠️  HIGH RISK - New tokens can rug/crash!          ║
╚══════════════════════════════════════════════════════╝

✅ Sentiment analysis ENABLED
   - Twitter/X: Connected
   - Telegram: Connected
   - Monitoring 3 channels

🚀 Sniper bot started...

📊 Token Analysis:
   Token: SOL
   Price: $100
   Sentiment: 0.75 (bullish)
   Confidence: 0.85
   Samples: 45
   - Twitter: 0.72
   - Telegram: 0.78
```

## How It Works

### 1. Data Collection

The bot continuously collects mentions of tokens from:
- Twitter: Recent tweets and real-time streaming
- Telegram: Messages from configured channels

### 2. Sentiment Analysis

Each mention is analyzed using NLP:
```typescript
const sentiment = analyzer.analyze(
  "SOL is going to the moon! 🚀",
  'twitter',
  'SOL'
);
// Result: { sentiment: 0.8, confidence: 0.9, ... }
```

### 3. Aggregation

Multiple data points are aggregated:
- Weighted by confidence
- Adjusted for engagement (likes, retweets)
- Normalized across sources
- Trend determination (bullish/bearish/neutral)

### 4. Signal Generation

Trading signals are generated based on:
- Overall sentiment score
- Confidence level
- Sample size
- Sentiment threshold

```typescript
const signal = aggregator.generateSignal(sentiment);
// Result: { action: 'buy', confidence: 0.82, reasoning: '...' }
```

### 5. Trading Decision

The strategy uses sentiment to enhance decisions:
- **Strong Buy Signal + High Confidence**: Execute trade
- **Weak/Neutral Signal**: Increase profit threshold
- **Sell Signal**: Skip opportunity

## Configuration Parameters

### Sentiment Thresholds

```env
SENTIMENT_THRESHOLD=0.3
```
- Range: -1.0 to 1.0
- Above threshold: Bullish
- Below -threshold: Bearish
- Between: Neutral

Recommended values:
- Conservative: 0.5 (strong sentiment only)
- Moderate: 0.3 (balanced)
- Aggressive: 0.2 (act on weaker signals)

### Minimum Sample Size

```env
SENTIMENT_MIN_SAMPLES=10
```
- Minimum data points before making decisions
- Lower = faster but less reliable
- Higher = slower but more reliable

Recommended values:
- High volume tokens: 20-50
- Medium volume: 10-20
- Low volume: 5-10

### Confidence Threshold

```env
SENTIMENT_CONFIDENCE_THRESHOLD=0.5
```
- Minimum confidence to act on sentiment
- Range: 0.0 to 1.0
- Higher = more conservative

Recommended values:
- Conservative: 0.7
- Moderate: 0.5
- Aggressive: 0.3

## Testing

Run sentiment analysis tests:

```bash
npm test -- src/__tests__/sentiment.test.ts
```

Tests cover:
- Sentiment analysis accuracy
- Positive/negative/neutral detection
- Token relevance checking
- Multi-source aggregation
- Signal generation
- Trend analysis

## Limitations

1. **API Rate Limits**: Twitter and Telegram APIs have rate limits
2. **Language**: Currently optimized for English text
3. **Sarcasm Detection**: May misinterpret sarcastic comments
4. **Bot Spam**: No filtering for automated/bot messages yet
5. **Historical Data**: Sentiment is real-time, no historical analysis

## Future Enhancements

1. **Deep Learning Models**: Replace rule-based NLP with trained models
2. **Sentiment History**: Track sentiment changes over time
3. **Influencer Weighting**: Weight by account authority/follower count
4. **Spam Detection**: Filter bot messages and spam
5. **Multi-language**: Support for major languages
6. **Reddit Integration**: Add Reddit as sentiment source
7. **On-chain Sentiment**: Analyze on-chain data patterns

## Security Considerations

- Never commit API keys to git
- Use environment variables for all credentials
- Consider using read-only API access where possible
- Monitor API usage to stay within rate limits
- Rotate API keys periodically

## Performance Tips

1. **Update Interval**: Balance between freshness and API limits
2. **Sample Size**: Start with larger samples, optimize based on results
3. **Channel Selection**: Choose high-quality Telegram channels
4. **Rate Limiting**: Implement delays between API calls
5. **Caching**: Sentiment data is cached to reduce API calls

## Troubleshooting

### "Twitter client not initialized"
- Check `TWITTER_BEARER_TOKEN` is set correctly
- Verify token has proper permissions

### "Telegram bot not responding"
- Ensure bot token is correct
- Verify bot is added to channels
- Check channel IDs are correct

### "No sentiment data available"
- Wait for data collection period (5-10 minutes)
- Check if tokens are being discussed on social media
- Verify API credentials are working

### "Low confidence warnings"
- Increase `SENTIMENT_MIN_SAMPLES`
- Wait longer for data collection
- Check data quality from sources

## Example Integration

```typescript
import { SentimentAwareSniperStrategy } from './strategies/sniper';
import { sentimentConfig } from './config';

// Initialize strategy
const strategy = new SentimentAwareSniperStrategy(
  sentimentConfig,
  {
    sentimentThreshold: 0.3,
    minSampleSize: 10,
    confidenceThreshold: 0.5,
  }
);

// Start real-time collection
await strategy.startRealtimeCollection();

// Analyze opportunity
const opportunity = await strategy.analyzeOpportunity(
  tokenAddress,
  'TOKEN',
  currentPrice,
  liquidity
);

// Check if viable
if (strategy.isViable(arbitrageOpportunity)) {
  await strategy.execute(arbitrageOpportunity);
}

// Cleanup
await strategy.stopRealtimeCollection();
```

## Contributing

To extend sentiment analysis:

1. **Add New Sources**: Implement collector interface
2. **Improve NLP**: Enhance sentiment detection accuracy
3. **Add Features**: Implement trend prediction, influence scoring
4. **Optimize Performance**: Reduce API calls, improve caching

## License

MIT - See LICENSE file
