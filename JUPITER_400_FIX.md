# Jupiter 400 Error Fix

## Problem
The bot was receiving HTTP 400 errors from the Jupiter API when querying for quotes on certain token pairs. This happens when:

1. **Invalid Token Pairs** - Token pair doesn't exist on Jupiter
2. **No Liquidity** - No trading routes available between the two tokens
3. **Pair Not Supported** - Jupiter doesn't route through certain token combinations
4. **Low Amount** - Sometimes amounts below minimum liquidity threshold are rejected

## Root Causes Identified

### 1. Over-Aggressive Pair Configuration
The original `TRADING_PAIRS` array included many low-liquidity and experimental tokens:
- BONK/SOL
- WIF/SOL  
- POPCAT/SOL
- COPE/SOL
- ORCA/USDC
- RAY/USDC
- JUP/USDC
- PYTH/USDC

While these tokens exist on Solana, **not all have consistent liquidity on Jupiter**, causing 400 errors.

### 2. No Pair Validation Before Querying
The bot attempted to fetch quotes immediately without first checking if a route exists, leading to cascading 400 errors.

### 3. Poor Error Handling
The generic error handling didn't distinguish between different error types, making debugging difficult.

## Solutions Implemented

### 1. ✅ Pair Validation Function
Added `validateTokenPair()` method that:
- Performs a micro-amount test swap before attempting full quotes
- Uses only 1,000 lamports (SOL) or 100 units (other tokens)
- Returns `true` only if route exists and produces non-zero output
- Safely handles 400/404 errors (missing route)
- Skips pairs with no liquidity automatically

```typescript
private async validateTokenPair(pair: TradingPair): Promise<boolean> {
  try {
    const microAmount = pair.baseMint === SOL_MINT ? 1000 : 100;
    const url = `https://public.jupiterapi.com/quote?inputMint=${pair.baseMint}&outputMint=${pair.quoteMint}&amount=${microAmount}&slippageBps=50`;
    
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data?.outAmount && response.data.outAmount !== '0') {
      return true;
    }
    return false;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 400 || status === 404) {
      return false;  // No route exists
    }
    return false;  // Assume invalid to avoid spam
  }
}
```

### 2. ✅ Enhanced Error Handling in Quote Fetching
Improved `getJupiterQuote()` to categorize errors:

```typescript
private async getJupiterQuote(input: string, output: string, amount: number) {
  try {
    // Query logic...
  } catch (err: any) {
    const status = err?.response?.status;
    
    if (status === 400) {
      console.log(`❌ Jupiter [400]: Invalid token pair or no liquidity`);
    } else if (status === 429) {
      console.log(`⏱️  Jupiter [429]: Rate limited - backing off`);
    } else if (status === 500 || status === 502 || status === 503) {
      console.log(`❌ Jupiter [${status}]: Service error`);
    } else {
      console.log(`❌ Jupiter [${status}]: ${msg}`);
    }
    
    return null;
  }
}
```

### 3. ✅ Reduced to High-Liquidity Pairs Only
Replaced aggressive pair list with only **verified liquid pairs**:

- **SOL/USDC** - Ultra-liquid, always has quotes
- **mSOL/SOL** - Liquid staking token, high volume
- **USDT/USDC** - Stablecoin pair, tight spreads

These three pairs are:
- ✅ Always available on Jupiter
- ✅ Have consistent liquidity
- ✅ Supported by MarginFi (where applicable)
- ✅ Produce reliable quotes

### 4. ✅ Improved Pair Checking Flow
Updated `checkPair()` method to validate before querying:

```typescript
private async checkPair(pair: TradingPair) {
  // Validate pair has liquidity FIRST
  const isValid = await this.validateTokenPair(pair);
  if (!isValid) {
    console.log(`⚠️  ${pair.name}: No liquidity or invalid pair - skipping`);
    return;
  }
  
  // Only query quotes if pair is valid
  const quote1 = await this.getJupiterQuote(...);
  // ... rest of logic
}
```

## Benefits

| Issue | Before | After |
|-------|--------|-------|
| 400 Errors | Frequent | Rare - pairs validated first |
| Wasted API Calls | Many failed requests | Only valid pairs queried |
| Error Messages | Generic | Categorized by type |
| Configuration | Experimental tokens | Proven liquid pairs only |
| Scan Efficiency | Fails often | Skips invalid pairs cleanly |

## Testing & Verification

To verify the fix works:

1. **Run the bot** and observe the initial scan
   ```bash
   npm run dev
   ```

2. **Expected output** - no more 400 errors:
   ```
   ✅ SOL/USDC: Valid pair, querying...
   ⚠️  OLD_TOKEN/SOL: No liquidity or invalid pair - skipping
   ✅ mSOL/SOL: Quote obtained...
   ```

3. **Check logs** for improved error categorization

## How to Add More Pairs Safely

If you want to add new trading pairs:

1. **Verify liquidity manually** by visiting:
   - https://jupiterapi.com/quote?inputMint=TOKEN_A&outputMint=TOKEN_B&amount=1000

2. **Add only if** the API returns a non-zero `outAmount`

3. **Test locally** first:
   ```typescript
   // In src/bots/jupiter-arbitrage-bot.ts
   const newPair: TradingPair = {
     name: 'TEST/SOL',
     baseMint: 'YOUR_TOKEN_MINT',
     quoteMint: SOL_MINT,
     // ... rest of config
   };
   TRADING_PAIRS.push(newPair);
   ```

4. **Run bot** and confirm validation passes

## Configuration Notes

### Why These Three Pairs?

**SOL/USDC:**
- Most liquid Solana pair
- Main arbitrage pair on Jupiter
- Highest trading volume
- Widest spread opportunities

**mSOL/SOL:**
- Liquid staking derivative
- Deep liquidity pools
- Good spread volatility
- Marinade has strong incentives

**USDT/USDC:**
- Both stablecoins
- Tight spreads mean low fees
- Consistent 1:1 pricing
- Good for testing execution

### Spread Configuration

Each pair has `minSpread` setting:

```typescript
minSpread: -0.1  // 10% profit needed to trigger
minSpread: -0.01 // 1% profit needed (stablecoins)
minSpread: 0.001 // 0.1% profit (very aggressive)
```

Negative values = profit threshold. Bot only executes when spread exceeds this.

## Future Improvements

1. **Dynamic Pair Discovery** - Auto-detect liquid pairs from Jupiter
2. **Liquidity Monitoring** - Track volume changes to add/remove pairs
3. **Rate Limit Handling** - Exponential backoff on 429 errors
4. **Batch Quote API** - Query multiple pairs in single request
5. **Token Metadata Cache** - Cache token decimals to reduce API calls

## References

- Jupiter API Docs: https://docs.jup.ag/api-v4/get-quote
- Quote endpoint: `GET https://public.jupiterapi.com/quote`
- Status codes: 400 (invalid), 404 (not found), 429 (rate limited)
- Solana token list: https://token.metaplex.com/
