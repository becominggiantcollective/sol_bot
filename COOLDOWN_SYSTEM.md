# Progressive Cooldown System

## Overview
The bot now implements a **smart progressive cooldown system** to prevent Jupiter API rate limiting and IP bans. This system automatically backs off when rate limits are detected, progressively increasing wait times to give the API time to recover.

## How It Works

### Cooldown Tracking
The system tracks three key pieces of state:
- **`rateLimitCount`**: Number of consecutive rate limit hits
- **`lastRateLimitTime`**: Timestamp of the last rate limit
- **`cooldownUntil`**: Don't make API requests until this timestamp

### Progressive Backoff Schedule
When a rate limit is detected (HTTP 429), the cooldown duration increases exponentially:

| Attempt | Cooldown Duration | Formula |
|---------|------------------|---------|
| 1st hit | 15 seconds       | 15s × 2^0 |
| 2nd hit | 30 seconds       | 15s × 2^1 |
| 3rd hit | 60 seconds       | 15s × 2^2 |
| 4th hit | 120 seconds      | 15s × 2^3 |
| 5th hit | 240 seconds      | 15s × 2^4 |
| 6th+ hit| 300 seconds (max)| Capped at 5 minutes |

### Reset on Success
When a successful API call is made:
- `rateLimitCount` resets to 0
- `cooldownUntil` resets to 0
- The system is ready to detect opportunities again

## Implementation Details

### Key Features

#### 1. Pre-Request Cooldown Check
Before scanning for opportunities, the detector checks if it's in cooldown:
```typescript
const now = Date.now();
if (now < this.cooldownUntil) {
  const remainingSeconds = Math.ceil((this.cooldownUntil - now) / 1000);
  console.log(`⏰ In cooldown period - ${remainingSeconds}s remaining (rate limit protection)`);
  return []; // Return empty during cooldown
}
```

#### 2. Rate Limit Detection & Activation
When Jupiter returns HTTP 429:
```typescript
if (error.response?.status === 429) {
  this.rateLimitCount++;
  this.lastRateLimitTime = Date.now();
  
  const cooldownDuration = Math.min(
    this.BASE_COOLDOWN * Math.pow(2, this.rateLimitCount - 1),
    this.MAX_COOLDOWN
  );
  
  this.cooldownUntil = Date.now() + cooldownDuration;
  console.warn(`⚠️  Jupiter rate limit hit (attempt ${this.rateLimitCount}) - cooling down for ${Math.ceil(cooldownDuration / 1000)}s`);
  
  await this.delay(cooldownDuration);
}
```

#### 3. Success Reset
When a quote is successfully retrieved:
```typescript
if (response.data && response.data.outAmount) {
  // Successful API call - reset rate limit counter
  this.rateLimitCount = 0;
  this.cooldownUntil = 0;
  // ... process the quote
}
```

## Console Output

### Initialization
When the bot starts, you'll see:
```
Solana Arbitrage Bot initialized successfully
🛡️  Smart rate limit protection: Progressive cooldown (15s → 5min) activated
```

### During Cooldown
When in cooldown period:
```
⏰ In cooldown period - 45s remaining (rate limit protection)
```

### Rate Limit Hit
When rate limit is detected:
```
⚠️  Jupiter rate limit hit (attempt 3) - cooling down for 60s
```

## Configuration

### Adjustable Constants
Located in `src/core/arbitrage.ts`:

```typescript
private readonly BASE_COOLDOWN = 15000; // 15 seconds base cooldown
private readonly MAX_COOLDOWN = 300000; // 5 minutes max cooldown
```

**Recommendations:**
- **BASE_COOLDOWN**: Keep at 15s for quick recovery from occasional limits
- **MAX_COOLDOWN**: Keep at 300s (5min) to prevent excessive waiting
- These values balance protection vs opportunity loss

## Benefits

### 1. Prevents IP Bans
- Progressive backoff gives Jupiter API time to recover
- Prevents accumulation of failed requests
- Avoids temporary IP blocks

### 2. Automatic Recovery
- Resets on successful calls
- No manual intervention needed
- Self-healing system

### 3. Transparent Operation
- Clear console messages
- Shows remaining cooldown time
- Logs attempt count for debugging

### 4. Resource Efficient
- Skips API calls during cooldown
- Doesn't waste rate limit quota
- Reduces unnecessary network traffic

## Interaction with Other Protections

The cooldown system works alongside existing protections:

### 1. API Call Delays (3 seconds)
Located in `src/core/arbitrage.ts` after each successful quote:
```typescript
await this.delay(3000); // 3 second delay between calls
```
**Purpose**: Prevent hitting rate limits in the first place

### 2. Token Count Limit (3 tokens)
Located in `src/utils/index.ts`:
```typescript
export const TRADING_TOKENS = [
  new PublicKey('So11111111111111111111111111111111111111112'), // SOL
  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
  new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), // BONK
];
```
**Purpose**: Minimize API calls (3 tokens = 12 routes = 12 API calls per scan)

### 3. Scan Interval (20 seconds)
Located in `src/index.ts`:
```typescript
await this.delay(20000); // 20s between full scans
```
**Purpose**: Spread out scans to stay under rate limits

## Testing the System

### Expected Behavior

#### Normal Operation
1. Bot scans every 20 seconds
2. Makes 12 API calls (3 tokens, 6 pairs, 2 directions)
3. 3s delay between each call = 36s per scan
4. Rate limit: Never triggered

#### Rate Limit Hit
1. Rate limit detected (429 error)
2. Bot activates 15s cooldown
3. Console shows: `⚠️  Jupiter rate limit hit (attempt 1) - cooling down for 15s`
4. Bot waits 15s, then resumes
5. If hit again: 30s cooldown (attempt 2)
6. Progressive increase until issue resolves

#### Recovery
1. Successful API call received
2. Counter resets to 0
3. Normal operation resumes
4. System ready to detect opportunities

### Manual Testing
```bash
# Build and start the bot
npm run build && npm start

# Watch for initialization message
# Expected: "🛡️  Smart rate limit protection: Progressive cooldown (15s → 5min) activated"

# Monitor for rate limits (should be rare with current config)
# If rate limit hits: Look for "⚠️  Jupiter rate limit hit (attempt X)"
# Watch cooldown countdown: "⏰ In cooldown period - XXs remaining"

# After recovery: Look for normal operation
# Expected: "Found X total opportunities" without rate limit warnings
```

## Current Status

### IP Ban Situation (Temporary)
**Issue**: IP was temporarily banned during testing with 12 tokens (132 API calls)
**Duration**: ~1 hour from last rate limit (~3:11 PM → ~4:15 PM)
**Status**: Waiting for Jupiter to unblock IP

**What to do:**
1. Wait until ~4:15 PM for cooldown to expire
2. Run `npm start` to test with 3 tokens
3. Monitor for rate limits
4. Cooldown system will prevent future bans

### Protection Layers Active
✅ 3 tokens only (minimal API calls)
✅ 3s delay between calls (conservative timing)
✅ 20s scan interval (spread out requests)
✅ **Progressive cooldown system** (NEW - prevents accumulation)

## Upgrading to Jupiter Pro

If you find profitable opportunities and want to scale up:

### Jupiter Pro Benefits
- **300+ requests/minute** (vs 120 free tier)
- Better for 10+ tokens
- Dedicated infrastructure
- Priority support

### Cost
- **$49/month**
- Worth it if bot generates >$50 profit/month

### When to Upgrade
- After confirming profitability with 3 tokens
- When ready to expand to 10-15 tokens
- If cooldowns become frequent during peak times

## Troubleshooting

### Q: Still getting rate limited with 3 tokens?
**A:** This means your IP is still in cooldown from previous testing. Wait the full hour, then restart.

### Q: Cooldown lasts too long?
**A:** Reduce `MAX_COOLDOWN` from 300000ms (5min) to 120000ms (2min) in `src/core/arbitrage.ts`.

### Q: Want faster recovery?
**A:** Reduce `BASE_COOLDOWN` from 15000ms (15s) to 10000ms (10s), but risk more rate limits.

### Q: Cooldown never activates?
**A:** Good! This means the 3s delays and 20s scan interval are working perfectly.

## Summary

The progressive cooldown system is a **defensive mechanism** that:
1. ✅ Prevents IP bans through exponential backoff
2. ✅ Automatically recovers when API is healthy
3. ✅ Provides transparent status updates
4. ✅ Works alongside existing protections
5. ✅ Requires no manual intervention

Combined with the current configuration (3 tokens, 3s delays), your bot should operate smoothly once the current IP ban expires (~1 hour from 3:11 PM).
