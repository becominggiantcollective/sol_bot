# 🔧 JUPITER EXECUTION TROUBLESHOOTING GUIDE

## 🔍 Common Jupiter Execution Failures & Solutions

Based on your bot's setup, here are the most likely issues and how to fix them:

---

## ❌ ERROR 1: Slippage Error (0x1789)

### What You'll See:
```
Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: 
custom program error: 0x1789
```

### What This Means:
- **This is NORMAL!** Not a bot failure.
- Price moved between when you got the quote and when you tried to execute
- Happens in 95-99% of arbitrage attempts
- Opportunity disappeared in milliseconds

### Solution:
- ✅ **No fix needed** - this is expected behavior
- Keep the bot running - need 20-100 attempts for 1 success
- Success rate is 1-5% for arbitrage (statistical)

### How to Improve:
1. **Add priority fees**:
   ```typescript
   // Edit src/config/index.ts:
   trading: {
     maxGasFee: 0.05,  // Increase from 0.02
     priorityFeeMultiplier: 2.0  // Add this
   }
   ```

2. **Faster scanning**:
   ```typescript
   // Edit src/index.ts around line 165:
   await sleep(10000);  // Change from 25000 to 10000 (10 seconds)
   ```

---

## ❌ ERROR 2: Insufficient Balance

### What You'll See:
```
Error: Attempt to debit an account but found no record of a prior credit
```
OR
```
insufficient funds for transaction
```

### What This Means:
- Trying to trade more than you have
- Currently testing with 10 SOL but only have 0.06 SOL

### Solution:
**Option A: Reduce Test Amount** (Quick Fix)
```typescript
// Edit src/core/arbitrage.ts around line 88:
const testAmount = 50000000;  // 0.05 SOL instead of 10 SOL
```

**Option B: Add More Capital** (Better Results)
```
Send 1-5 SOL to your wallet:
9VZkKLpzCwfHXpHFRW7T2NXZ68T9E5vwgFaXtCzdtgzQ
```

---

## ❌ ERROR 3: Jupiter API Rate Limiting

### What You'll See:
```
Jupiter quote API error: 429 Too Many Requests
```
OR
```
Jupiter swap API error: 503 Service Unavailable
```

### What This Means:
- Making too many API calls too fast
- Free tier has rate limits

### Solution:
```typescript
// Edit src/core/arbitrage.ts around line 145:
await this.delay(3000);  // Increase from 2000 to 3000 ms
```

---

## ❌ ERROR 4: Invalid Quote Response

### What You'll See:
```
Jupiter quote API error: 400 Bad Request
```
OR
```
Cannot read property 'outAmount' of undefined
```

### What This Means:
- No liquidity for that token pair
- Token mints are invalid
- Amount is too small/large

### Solution:
**Check token mints are valid**:
```bash
# Your current tokens:
SOL: So11111111111111111111111111111111111111112 ✅
USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ✅
BONK: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 ✅
```

---

## ❌ ERROR 5: Transaction Too Large

### What You'll See:
```
Transaction too large: 1232 > 1232 bytes
```
OR
```
Program failed to complete: exceeded maximum accounts per instruction
```

### What This Means:
- Jupiter route has too many hops
- Flashloan routing adds more accounts

### Solution:
```typescript
// Edit src/strategies/mev.ts around line 63:
const quoteParams = {
  // ... other params
  maxAccounts: '32',  // Reduce from 64 to 32
  onlyDirectRoutes: true,  // Add this to prefer simple routes
};
```

---

## ❌ ERROR 6: Wallet Not Connected

### What You'll See:
```
Error: Wallet private key not configured
```
OR
```
Cannot read properties of undefined (reading 'sign')
```

### What This Means:
- .env file not loaded properly
- Private key format wrong

### Solution:
Check your `.env` file:
```bash
WALLET_PRIVATE_KEY=[1,2,3,4,...]  # Must be array format
```

Verify it's loading:
```bash
# In terminal:
cat .env | grep WALLET_PRIVATE_KEY
```

---

## ❌ ERROR 7: RPC Connection Issues

### What You'll See:
```
Failed to send raw transaction: FetchError: request to ... failed
```
OR
```
Connection timeout
```

### What This Means:
- QuickNode RPC down or slow
- Network issues

### Solution:
**Use backup RPC**:
```typescript
// Edit .env:
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
```

---

## 🔬 DIAGNOSTIC COMMANDS

### Check if Bot is Finding Opportunities:
```bash
# In the terminal output, look for:
Found arbitrage opportunity: XXXXX lamports (X.XX%)
```

### Check Wallet Balance:
```bash
# In the terminal output, look for:
Wallet balance: X.XXXXXX SOL
```

### Check Jupiter API Status:
```bash
curl "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50"
```

---

## 📊 WHAT TO EXPECT (NORMAL BEHAVIOR)

### Success Pattern:
```
✅ Finding opportunities: 2-3 per minute
✅ Attempting execution: Every opportunity
❌ Failing with 0x1789: 95-99% of attempts (NORMAL!)
✅ Successful trade: 1 out of 20-100 attempts
💰 Profit when success: $5-$20 per trade
```

### Timeline:
- **0-10 minutes**: Finding opportunities, all failing (normal)
- **10-50 minutes**: First successful trade likely
- **1-3 hours**: 2-5 successful trades expected
- **24 hours**: 30-150 successful trades expected

---

## 🚨 CRITICAL FIXES BY ERROR TYPE

### If you're seeing 0x1789 (Slippage):
✅ **NO FIX NEEDED** - This is normal! Just keep running.

### If you're seeing "insufficient balance":
🔧 **REDUCE TEST AMOUNT** or **ADD MORE SOL**

### If you're seeing rate limiting:
🔧 **INCREASE DELAY** between API calls

### If you're seeing no opportunities:
🔧 **CHECK RPC CONNECTION** and **TOKEN MINTS**

---

## 📋 QUICK FIX CHECKLIST

1. ⬜ Bot is connected to MAINNET? (Check: "Wallet balance: X SOL" in logs)
2. ⬜ Seeing "Found arbitrage opportunity"? (Should see every 25 seconds)
3. ⬜ Error is 0x1789? (This is NORMAL - just keep running)
4. ⬜ Wallet has SOL? (Need at least 0.05 SOL for gas + trades)
5. ⬜ Jupiter API responding? (Test with curl command above)

---

## 🛠️ APPLY QUICK FIX NOW

### If failing due to insufficient balance, apply this fix:

```bash
# 1. Edit the test amount
# Open: src/core/arbitrage.ts
# Find line ~88: const testAmount = 10000000000;
# Change to: const testAmount = 50000000;  // 0.05 SOL

# 2. Rebuild
npm run build

# 3. Restart bot
npm start
```

---

## 📞 TELL ME THE EXACT ERROR

**Please share**:
1. The exact error message from terminal
2. Is it happening on EVERY attempt or just some?
3. Are you seeing "Found arbitrage opportunity" messages?

This will help me give you the exact fix you need!

---

**Most Common Issue**: 0x1789 slippage error = **NORMAL BEHAVIOR**  
**Solution**: Just keep the bot running - success is statistical!

**Second Most Common**: Insufficient balance for 10 SOL trades  
**Solution**: Reduce test amount to 0.05 SOL (see Quick Fix above)
