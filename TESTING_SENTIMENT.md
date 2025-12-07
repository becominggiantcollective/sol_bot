# Testing Guide for ML Sentiment Analysis

This guide explains how to test the ML sentiment analysis feature.

## Prerequisites

- Node.js and npm installed
- Twitter API credentials (optional, for Twitter integration)
- Telegram Bot token (optional, for Telegram integration)

## Running Tests

### Unit Tests

Run all sentiment analysis tests:

```bash
npm test -- src/__tests__/sentiment.test.ts
```

Expected output:
```
PASS src/__tests__/sentiment.test.ts
  SentimentAnalyzer
    ✓ should analyze positive sentiment
    ✓ should analyze negative sentiment
    ✓ should analyze neutral sentiment
    ✓ should check relevance correctly
    ✓ should handle batch analysis
  SentimentAggregator
    ✓ should aggregate positive sentiment
    ✓ should aggregate negative sentiment
    ✓ should generate buy signal for strong positive sentiment
    ✓ should generate sell signal for strong negative sentiment
    ✓ should generate hold signal for insufficient data
    ✓ should generate hold signal for low confidence
    ✓ should analyze trend correctly
    ✓ should return null for empty sentiment data

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

### Integration Testing

1. **Without API Keys (Basic Mode)**

   ```bash
   # Sentiment analysis will be disabled
   npm run sniper
   ```

   Expected: Bot runs with technical analysis only, warning about disabled sentiment.

2. **With Twitter Only**

   ```bash
   # Add to .env:
   SENTIMENT_ENABLED=true
   TWITTER_BEARER_TOKEN=your_token_here
   
   npm run sniper
   ```

   Expected: Bot collects Twitter sentiment but not Telegram.

3. **With Telegram Only**

   ```bash
   # Add to .env:
   SENTIMENT_ENABLED=true
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHANNELS=channel1,channel2
   
   npm run sniper
   ```

   Expected: Bot monitors Telegram channels but not Twitter.

4. **Full Integration**

   ```bash
   # Add to .env:
   SENTIMENT_ENABLED=true
   TWITTER_BEARER_TOKEN=your_token_here
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHANNELS=channel1,channel2
   
   npm run sniper
   ```

   Expected: Bot collects from both sources.

## Manual Testing

### Test Sentiment Analysis

Create a test script `test-sentiment.ts`:

```typescript
import { SentimentAnalyzer } from './src/ml/sentiment-analyzer';

const analyzer = new SentimentAnalyzer();

// Test positive sentiment
const positive = analyzer.analyze(
  'SOL is amazing! Going to the moon! 🚀',
  'twitter',
  'SOL'
);
console.log('Positive:', positive);

// Test negative sentiment
const negative = analyzer.analyze(
  'This token is terrible, stay away!',
  'twitter',
  'SCAM'
);
console.log('Negative:', negative);

// Test neutral
const neutral = analyzer.analyze(
  'The price is $100',
  'twitter',
  'TOKEN'
);
console.log('Neutral:', neutral);
```

Run:
```bash
ts-node test-sentiment.ts
```

### Test Aggregation

Create `test-aggregation.ts`:

```typescript
import { SentimentAggregator } from './src/ml/sentiment-aggregator';
import { SentimentData } from './src/ml/types';

const aggregator = new SentimentAggregator({
  sentimentThreshold: 0.3,
  minSampleSize: 3,
  confidenceThreshold: 0.5,
});

const testData: SentimentData[] = [
  {
    source: 'twitter',
    token: 'SOL',
    sentiment: 0.8,
    confidence: 0.9,
    timestamp: Date.now(),
    text: 'Great project!',
  },
  {
    source: 'twitter',
    token: 'SOL',
    sentiment: 0.7,
    confidence: 0.8,
    timestamp: Date.now(),
    text: 'Love it!',
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

const aggregated = aggregator.aggregate(testData);
console.log('Aggregated:', aggregated);

if (aggregated) {
  const signal = aggregator.generateSignal(aggregated, 100);
  console.log('Signal:', signal);
}
```

## Test Coverage

Current test coverage for sentiment analysis:

- **SentimentAnalyzer**: 100%
  - Positive/negative/neutral analysis
  - Relevance checking
  - Batch analysis

- **SentimentAggregator**: 100%
  - Multi-source aggregation
  - Signal generation (buy/sell/hold)
  - Trend analysis
  - Edge cases (empty data, low confidence)

## Performance Testing

### Response Time

Test sentiment analysis speed:

```typescript
import { SentimentAnalyzer } from './src/ml/sentiment-analyzer';

const analyzer = new SentimentAnalyzer();
const iterations = 1000;

console.time('1000 analyses');
for (let i = 0; i < iterations; i++) {
  analyzer.analyze('Test message', 'twitter', 'TEST');
}
console.timeEnd('1000 analyses');
```

Expected: < 100ms for 1000 analyses

### Memory Usage

Monitor memory during sentiment collection:

```bash
node --expose-gc test-memory.js
```

## Error Handling Tests

### Test API Failures

1. **Invalid Twitter Token**
   - Set invalid `TWITTER_BEARER_TOKEN`
   - Run sniper
   - Expected: Warning logged, continues without Twitter data

2. **Invalid Telegram Token**
   - Set invalid `TELEGRAM_BOT_TOKEN`
   - Run sniper
   - Expected: Warning logged, continues without Telegram data

3. **Rate Limiting**
   - Make many rapid API calls
   - Expected: Graceful handling with delays

### Test Edge Cases

```typescript
// Empty text
analyzer.analyze('', 'twitter', 'TOKEN');

// Very long text
analyzer.analyze('word '.repeat(10000), 'twitter', 'TOKEN');

// Special characters
analyzer.analyze('🚀💎🙌', 'twitter', 'TOKEN');

// Empty aggregation
aggregator.aggregate([]);

// Single sample
aggregator.aggregate([singleSample]);
```

## Continuous Testing

### Pre-commit Testing

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm test -- src/__tests__/sentiment.test.ts
if [ $? -ne 0 ]; then
  echo "Sentiment tests failed, commit aborted"
  exit 1
fi
```

### CI/CD Integration

GitHub Actions workflow (`.github/workflows/test.yml`):

```yaml
name: Test Sentiment Analysis

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test -- src/__tests__/sentiment.test.ts
```

## Troubleshooting

### Tests Failing

1. **Module not found errors**
   ```bash
   npm install
   npm run build
   ```

2. **Type errors**
   ```bash
   npm install --save-dev @types/sentiment
   ```

3. **Test timeout**
   - Increase Jest timeout in `jest.config.cjs`:
   ```javascript
   testTimeout: 30000
   ```

### Integration Issues

1. **No sentiment data collected**
   - Check API credentials
   - Verify tokens are being discussed
   - Check rate limits

2. **Low confidence scores**
   - Increase sample size
   - Wait longer for data collection
   - Verify data quality

3. **Incorrect sentiment**
   - Check text preprocessing
   - Verify token relevance detection
   - Review NLP model settings

## Best Practices

1. **Run tests before commits**
2. **Test with real API credentials periodically**
3. **Monitor test performance over time**
4. **Add tests for new features**
5. **Keep test data realistic**
6. **Test error scenarios**
7. **Verify security (no secrets in tests)**

## Test Data

Example test data for manual testing:

### Positive Sentiment
- "SOL to the moon! 🚀"
- "Best project ever! Buying more"
- "Amazing gains today! 💎🙌"

### Negative Sentiment
- "This token is a scam"
- "Terrible project, lost money"
- "Avoid at all costs"

### Neutral Sentiment
- "Current price is $100"
- "Token launched today"
- "Trading volume increased"

## Security Testing

1. **API Key Validation**
   - Test with invalid keys
   - Test with expired keys
   - Test with insufficient permissions

2. **Input Sanitization**
   - Test with SQL injection attempts
   - Test with XSS payloads
   - Test with path traversal

3. **Rate Limiting**
   - Test rapid API calls
   - Verify backoff behavior
   - Check error handling

## Reporting Issues

When reporting test failures, include:
- Test command used
- Full error output
- Environment details (Node version, OS)
- Configuration used (.env values without secrets)
- Steps to reproduce
