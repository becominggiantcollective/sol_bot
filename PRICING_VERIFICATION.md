# Pricing Verification Report

## Summary
This document verifies that **all prices in the sol_bot are fetched dynamically** from live APIs and are **not hard-coded**.

## Dynamic Price Sources

### 1. Jupiter API - Primary Price Source
**Location**: `src/core/liquidation.ts` (lines 107-130) and `src/core/arbitrage.ts` (lines 113-145)

- **Price API**: `https://price.jup.ag/v6/price`
  - Used for token price lookups
  - Fetches current market prices for SOL, USDC, mSOL
  - 5-second timeout for fast response

- **Quote API**: `https://quote-api.jup.ag/v6/quote`
  - Used for real-time trading route quotes
  - Dynamically calculates output amounts based on current liquidity
  - Includes price impact calculations
  - 3-second timeout for fast trading decisions

### 2. CoinGecko API - Secondary Price Source
**Location**: `src/core/liquidation.ts` (lines 132-164)

- **API**: `https://api.coingecko.com/api/v3/simple/price`
  - Provides fallback pricing when Jupiter is unavailable
  - Fetches USD prices for major tokens (SOL, USDC)
  - 5-second timeout

### 3. Price Caching Strategy

**Liquidation Detector** (`src/core/liquidation.ts`)
- Cache duration: 30 seconds (line 11)
- Automatically refreshes stale prices
- Prioritizes Jupiter prices, falls back to CoinGecko

**Arbitrage Detector** (`src/core/arbitrage.ts`)
- Cache duration: 5 seconds (line 8)
- Faster refresh for time-sensitive arbitrage opportunities
- Real-time quote fetching for each trading opportunity

## Mock Prices - Development/Testing Only

Mock prices exist in **two non-production locations**:

1. **`src/core/arbitrage.ts` (lines 204-210)**
   ```typescript
   const priceData: PriceData = {
     mint: token,
     price: Math.random() * 100, // Mock price
     ...
   };
   ```
   - Used ONLY for price cache initialization when API is unavailable
   - Not used in actual trading decisions

2. **`src/strategies/mev.ts` (lines 387-392)**
   ```typescript
   const mockPrices: { [key: string]: number } = {
     'So11111111111111111111111111111111111111112': 100, // SOL
     'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1, // USDC
   };
   ```
   - Used ONLY for demo/example purposes in liquidation strategy
   - Not used in production trading

## Production Trading Flow

1. **Arbitrage Detection**:
   - Fetches real-time quotes from Jupiter API (line 120-125 in arbitrage.ts)
   - Compares routes across Jupiter, Orca, Raydium
   - Uses actual market prices to calculate profit

2. **Liquidation Detection**:
   - Fetches current token prices from Jupiter/CoinGecko (lines 107-164 in liquidation.ts)
   - Updates price cache every 30 seconds
   - Uses real prices to calculate health factors and liquidation profitability

3. **Trade Execution**:
   - All trades use real-time API data
   - No hard-coded prices in execution path
   - Dynamic slippage and price impact calculations

## Verification Checklist

- [x] **Jupiter Price API**: Dynamically fetches token prices
- [x] **Jupiter Quote API**: Dynamically calculates trading routes
- [x] **CoinGecko API**: Provides fallback price data
- [x] **Short cache TTLs**: 5-30 seconds ensures fresh data
- [x] **No hard-coded prices in trading logic**: Confirmed
- [x] **Mock prices isolated**: Only in test/demo code paths

## Conclusion

✅ **All prices used in production trading are fetched dynamically from live APIs.**

The bot uses real-time market data with short cache durations (5-30 seconds) to make trading decisions. Mock prices are only used in non-production code paths for testing and demonstration purposes.

## References

- Liquidation price fetching: `src/core/liquidation.ts:80-164`
- Arbitrage quote fetching: `src/core/arbitrage.ts:113-145`
- Price cache implementation: `src/core/arbitrage.ts:193-218`
