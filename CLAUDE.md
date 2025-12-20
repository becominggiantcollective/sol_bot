# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a production-ready Solana MEV (Maximal Extractable Value) trading bot that executes:
- **Triangular cross-DEX arbitrage** (A→B→C→A across multiple DEXes)
- **Flash loan arbitrage** (zero-capital trading via Solend/Mango)
- **Liquidation hunting** (Solend, Mango Markets, Port Finance)
- **Direct swap strategies** (Jupiter-based execution)

The bot is built with a hybrid TypeScript/Rust architecture for maximum performance.

## Architecture Overview

### Dual Runtime Design
- **TypeScript**: Main bot logic, API integration, strategy orchestration
- **Rust**: Performance-critical hot paths (arbitrage engine, flash loan execution, low-fee routing)
  - Compiled to Node.js native modules via `napi`
  - 10-100x faster than pure JS for computational tasks

### Core Components

**src/index.ts**: Main bot entry point
- `SolanaArbitrageBot` class orchestrates all strategies
- Trading loop runs every 10 seconds
- Graceful shutdown handlers (SIGINT/SIGTERM)

**src/core/**:
- `arbitrage.ts`: Triangular cross-DEX arbitrage detection engine
  - Scans 11+ predefined triangular paths (SOL→USDC→BONK→SOL, etc.)
  - Uses Jupiter API for real quotes with proper decimal handling
  - Validates quote freshness (<10s), price impact (<1%), and profitability (>0.15%)
  - **Critical**: All calculations use human-readable units with explicit conversion via `toRaw()`/`toHuman()`
- `flashloan.ts`: Flash loan provider management
  - Solend integration (0% fee verified on-chain)
  - Mango Markets support (partial implementation)
  - Creates borrow→arbitrage→repay instruction bundles
- `liquidation.ts`: Liquidation opportunity detector
  - Monitors lending protocols for underwater positions (health factor < 1.0)
  - Fetches prices from Jupiter + CoinGecko with 30s cache
  - Prioritizes by urgency (critical/high/medium/low) and profit %
- `connection.ts`: Solana RPC connection wrapper with retry logic

**src/strategies/**:
- `mev.ts`: MEV strategy implementations
  - `FlashloanArbitrageStrategy`: Execute arb with flash loans
  - `SandwichAttackStrategy`: Front/back-run large trades
  - `LiquidationStrategy`: Parallel liquidation execution with priority fees
- `direct-swap.ts`: Jupiter direct swap execution (most reliable)

**src/utils/**:
- `profitability.ts`: Profit tracking, metrics, ROI calculation
- `backtester.ts`: Historical simulation with Sharpe ratio analysis
- `logger.ts`: Winston-based structured logging
- `alchemyPoolMonitor.ts`: Real-time pool change detection (200ms early warning)
- `mlRouteSelector.ts`: ML-based route optimization (learns from historical data)
- `dynamicFees.ts`: Dynamic priority fee calculation via Helius API
- `sentimentPoolHunter.ts`: Sentiment-based token discovery

**src/ml/**:
- `sentimentClient.ts`: Client for sentiment analysis service
- `sentiment_service/`: Python FastAPI service for social sentiment (port 8000)

**src/config/index.ts**: Single source of truth for configuration
- Loads from `.env` with fallback defaults
- Supports multiple environments (devnet/mainnet)
- Profit threshold: 0.2% (verified: flash loan ~0%, DEX ~0.05%, gas ~0.05%)

### Rust Components (src/*.rs)

**src/lib.rs**: Rust module exports for Node.js FFI
**src/arb_engine.rs**: High-performance arbitrage route calculation
**src/flashloan_executor.rs**: Optimized flash loan transaction building
**src/lowfee_router.rs**: Smart routing to minimize DEX fees

### Standalone Trading Bots (*.mjs)

The project includes standalone ES module scripts for different trading strategies:

**Primary Sniper Bot:**
- `sniper-flashloan.mjs`: Main production sniper with ML predictions and honeypot detection
  - Conservative settings: $5 max trade, 15% target, 8% stop loss, 5 min max hold
  - Integrates `honeypot-detector.mjs` and `ml-predictor.mjs`
  - State saved to `positions-fl.json`
  - Run: `node sniper-flashloan.mjs`

**Safety Modules:**
- `honeypot-detector.mjs`: 6-check honeypot detection (mint auth, freeze auth, sell sim, liquidity, holders, age)
- `ml-predictor.mjs`: ML model for trade scoring (liquidity, volume, age, price velocity, holder concentration)
- `safety-checker-v2.mjs`: Enhanced safety with whale activity tracking

**Smart Money Tracking:**
- `smart-money-tracker.mjs`: Track top-performing wallets via Helius API
- `wave-rider.mjs`: Backrun arbitrage (trade after whale buys)

**Utility Scripts:**
- `preflight-check.mjs`: Pre-trade validation
- `check-balance.mjs` / `check-wallet.mjs`: Wallet balance checks
- `emergency-sell.mjs`: Force-sell stuck positions
- `consolidate-to-sol.mjs`: Convert all tokens to SOL

**Analysis Tools:**
- `market-analysis.mjs`: Market condition analysis
- `real-market-backtest.mjs`: Historical simulation with real data
- `capital-scaling-analysis.mjs`: Optimal position sizing

### State Files

- `positions-fl.json`: Active/closed trades with entry/exit data, P&L
- `ml-model.json`: Trained ML model weights
- `ml-training-data.json`: Historical trade outcomes for ML training
- `timing-analytics.json`: Trade timing performance data
- `rug-patterns.json`: Known rug pull signatures

## Development Workflow

### Building the Project

```bash
# TypeScript only
npm run build

# Rust only (requires Cargo)
npm run build:rust

# Both (full build)
npm run build:all
```

### Running Tests

```bash
# All tests
npm test

# Single test file
npm test -- src/__tests__/backtester.test.ts

# Watch mode
npm test -- --watch
```

### Linting and Formatting

```bash
npm run lint          # Check code quality
npm run format        # Auto-format with Prettier
```

### Running the Bot

```bash
# Development mode (hot reload)
npm run dev

# Production mode
npm run build && npm start

# Monitoring dashboard
npm run monitor

# Backtesting (30-day simulation)
npm run backtest

# Liquidation demo
npm run liquidation-example

# ===== STANDALONE SNIPER BOT =====
# Main production sniper (recommended)
node sniper-flashloan.mjs

# With custom settings
MAX_TRADE_USD=10 PROFIT_TARGET=20 node sniper-flashloan.mjs

# Start sentiment analysis service (optional, improves ML)
npm run sentiment:service
# or: uvicorn ml.sentiment_service.app:app --reload --port 8000
```

### Pre-Deployment

**ALWAYS run before production deployment:**
```bash
npm run pre-deploy-check
```

This verifies environment setup, security, tests, and configuration.

## Critical Configuration Notes

### Environment Variables (.env)

**Wallet Configuration:**
- `WALLET_PRIVATE_KEY`: Array format `[1,2,3,...,64]` (never commit!)
- `WALLET_PUBLIC_KEY`: Public key string
- Use dedicated trading wallet with limited funds

**Trading Thresholds (Optimized):**
- `MIN_PROFIT_THRESHOLD=0.002` (0.2% - accounts for gas + DEX fees)
- `MAX_SLIPPAGE=0.005` (0.5% - tighter for better execution)
- `MAX_GAS_FEE=0.02` (0.02 SOL max)
- `MAX_POSITION_SIZE=5000` ($5000 max per trade)

**Flash Loan Settings:**
- `MAX_FLASHLOAN_AMOUNT=500000` ($500k max)
- `FLASHLOAN_ENABLED=true` (enable by default)

**Liquidation Settings:**
- `MAX_CONCURRENT_LIQUIDATIONS=5`
- `LIQUIDATION_MIN_PROFIT=0.015` (1.5%)
- `PRIORITY_FEE_MULTIPLIER=3.0` (3x for competitive liquidations)

### RPC Endpoints

The bot performance heavily depends on RPC quality:
- **Free RPC** (api.mainnet-beta.solana.com): High latency, rate limits
- **Helius/Alchemy/QuickNode**: Recommended for production (200-500ms faster)
- **Alchemy Supernode**: Best for pool monitoring (early change detection)

Set via:
- `SOLANA_RPC_URL` / `SOLANA_WS_URL`
- `HELIUS_RPC_URL` / `HELIUS_WS_URL`
- `ALCHEMY_RPC_URL` / `ALCHEMY_WS_URL`

### Sniper Bot Environment Variables

The sniper bot (`sniper-flashloan.mjs`) can be configured via environment:
```bash
MAX_TRADE_USD=5          # Max $ per trade (default: 5)
PROFIT_TARGET=15         # Target profit % (default: 15)
STOP_LOSS=8              # Stop loss % (default: 8)
MAX_HOLD_MIN=5           # Max hold time in minutes (default: 5)
HELIUS_API_KEY=xxx       # Required for RPC and wallet tracking
```

## Token Registry and Decimal Handling

**Critical**: Each token has different decimals (src/core/arbitrage.ts lines 194-261):
- SOL: 9 decimals (1 SOL = 1,000,000,000 lamports)
- USDC/USDT: 6 decimals
- BONK: 5 decimals
- RAY/JUP/ORCA/WIF: 6 decimals
- mSOL/jitoSOL/POPCAT: 9 decimals

**Always use conversion helpers:**
- `toRaw(amount, symbol)`: Convert human → raw (e.g., 1.5 SOL → 1500000000n)
- `toHuman(rawAmount, symbol)`: Convert raw → human
- `formatAmount(amount, symbol)`: Pretty print with proper decimals

**Never** do manual decimal math or you'll get catastrophic errors (off by 10^3 to 10^6).

## Profit Calculation Logic

The profit calculation (src/core/arbitrage.ts:653-733) follows this structure:

1. **Gross Profit**: `finalAmount - inputAmount` (same token)
2. **Gas Cost**: Convert SOL fees to input token (uses dynamic SOL price)
3. **Flash Loan Fee**: 0% for Solend (verified on-chain)
4. **Net Profit**: `grossProfit - gasCost - flashLoanFee`
5. **Threshold Check**: Net profit % must exceed `MIN_PROFIT_THRESHOLD`

**Important**: Gas is always paid in SOL, so conversion to input token is required using current SOL/USD price.

## Strategy Execution Order

Strategies are tried in this order (src/index.ts:34-38):
1. **DirectSwapStrategy** (most reliable, actually works)
2. **FlashloanArbitrageStrategy** (zero-capital)
3. **SandwichAttackStrategy** (MEV, use ethically)

Liquidation runs in parallel with arbitrage detection for maximum efficiency.

## Honeypot Detection (Safety)

The sniper bot uses a 3-layer protection system:

### Layer 1: Honeypot Detector (`honeypot-detector.mjs`)
Six checks before any trade:
1. **Mint Authority**: Rejects if creator can mint unlimited tokens
2. **Freeze Authority**: Rejects if creator can freeze wallets
3. **Sell Simulation**: Simulates sell via Jupiter - rejects if fails
4. **Liquidity Check**: Minimum $5,000 required (configurable)
5. **Holder Distribution**: Rejects if top 10 wallets hold >80%
6. **Token Age**: Flags tokens <1 hour old as high risk

Risk score 0-100 returned. Threshold is 60 (conservative) or 85 (aggressive).

### Layer 2: ML Predictor (`ml-predictor.mjs`)
Feature-based scoring:
- Liquidity depth, 24h volume, token age
- Price velocity (rate of change)
- Volume spike detection
- Holder concentration patterns

Returns confidence score 0-100% and action: `BUY_QUICK_SELL`, `AVOID`, `HOLD`.

### Layer 3: Sentiment Analysis (optional)
If sentiment service is running (port 8000):
- Analyzes Twitter/Telegram/Discord mentions
- Returns score -1 (bearish) to +1 (bullish)
- Filters tokens with sentiment < -0.2

## Common Pitfalls and Solutions

### 1. Stale Quotes
**Problem**: Jupiter quotes expire in 10 seconds
**Solution**: The bot validates quote freshness and rejects stale quotes

### 2. Price Impact
**Problem**: Large trades cause slippage
**Solution**: Max price impact set to 1%, larger trades rejected

### 3. Decimal Errors
**Problem**: Mixing raw and human amounts causes catastrophic errors
**Solution**: Always use `toRaw()`/`toHuman()` helpers, never manual conversion

### 4. Flash Loan Repayment
**Problem**: Instruction order matters (borrow → arb → repay)
**Solution**: `createFlashloanInstructions()` builds correct sequence automatically

### 5. Rate Limiting
**Problem**: Jupiter API has strict rate limits (30 req/sec)
**Solution**: Built-in `RateLimiter` class with exponential backoff

## Testing Strategies

### Backtesting
The backtester (src/utils/backtester.ts) simulates 30 days of trading:
- Uses real Jupiter quotes from current market
- Projects profit based on current opportunities
- Calculates Sharpe ratio, profit factor, max drawdown
- Provides optimization recommendations

Run: `npm run backtest`

### Paper Trading
For testing without risk:
1. Set `DRY_RUN=true` in `.env`
2. Bot will detect opportunities but not execute
3. Monitor logs for profitability metrics

### Devnet Testing
Use `.env.devnet` configuration:
```bash
cp .env.devnet .env
npm run dev
```

## Performance Optimization

### ML Route Selection (NEW)
`MLRouteSelector` learns optimal DEX routes from historical data:
- Scores routes by fee efficiency, slippage, success rate
- Adapts to market conditions (volatility, time of day)
- Falls back to heuristics when data is sparse

### Dynamic Priority Fees (NEW)
`DynamicPriorityFeeManager` adjusts fees based on network congestion:
- Queries Helius API for real-time fee estimates
- Scales by urgency (normal/high/critical)
- Prevents overpaying during low congestion

### Rust Acceleration
For performance-critical paths, use Rust modules:
```typescript
import { LowFeeRouter } from './utils/rust-bindings.js';

const router = new LowFeeRouter(connection);
const bestRoute = await router.findOptimalRoute(inputMint, outputMint, amount);
```

## Monitoring and Observability

### Built-in Metrics
Access via `bot.getProfitMetrics()`:
- Total profit/loss
- Win rate %
- ROI %
- Hourly/daily profit projections
- Trade history

### Logging
Winston logger with levels:
- `error`: Critical failures
- `warn`: Performance issues, low balance
- `info`: Trade execution, opportunities found
- `debug`: Detailed quote data, validation

Set via `LOG_LEVEL` env var.

### Telegram Notifications (Optional)
Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for alerts on:
- Successful trades
- Liquidation executions
- Critical errors

## Security Considerations

1. **Never commit private keys** - Use `.env` (gitignored)
2. **Use dedicated trading wallet** - Isolate risk
3. **Test on devnet first** - Verify before mainnet
4. **Monitor bot performance** - Set circuit breakers
5. **Keep dependencies updated** - `npm audit` regularly
6. **Rotate secrets periodically** - Especially after testing

## Deployment

### VPS Deployment (Recommended)
See `deploy-to-vps.sh` for automated deployment to cloud servers.

Requirements:
- Ubuntu 20.04+ or similar
- Node.js 18+
- Rust 1.70+ (for Rust modules)
- PM2 for process management

### Docker (Alternative)
```bash
docker build -t sol_bot .
docker run -d --env-file .env sol_bot
```

## API Dependencies

### Required
- **Jupiter API**: Swap quotes and execution (set `JUPITER_API_KEY`)
- **Solana RPC**: Blockchain interaction (free tier works, premium better)

### Optional (Improve Performance)
- **Helius API**: Priority fee estimates, transaction parsing
- **Alchemy API**: Pool monitoring, early change detection
- **CoinGecko API**: Fallback price data

## When Making Changes

### Adding New Tokens
1. Add to `TOKENS` registry in `src/core/arbitrage.ts` with correct decimals
2. Add to triangular paths if appropriate
3. Test with small amounts first

### Adding New DEXes
1. Implement swap instruction builder in strategy
2. Add to `TRIANGULAR_PATHS` with DEX name
3. Update Jupiter API filtering if needed

### Modifying Profit Thresholds
1. Update in `src/config/index.ts` (single source of truth)
2. Verify flash loan fees haven't changed (check Solend docs)
3. Re-run backtesting to validate profitability

### Adding New Strategies
1. Implement `MEVStrategy` interface in `src/strategies/`
2. Add to strategies array in `src/index.ts`
3. Test viability check and execution separately

## Troubleshooting

### "Quote failed" errors
- Check RPC endpoint is responding
- Verify token exists and has liquidity
- Check Jupiter API rate limits

### "No viable strategy" warnings
- Normal during simulation - bot detects but doesn't execute
- In production, indicates insufficient profit after fees

### "Wallet not loaded" errors
- Verify `WALLET_PRIVATE_KEY` format is correct array `[1,2,...]`
- Check key has 64 bytes

### Flash loan failures
- Ensure wallet has SOL for gas (0.1 SOL minimum)
- Check Solend reserve has sufficient liquidity
- Verify instruction sequence is correct

### Sniper bot "Trade failed: Simulation failed 0x1771"
- Price moved between quote and execution (slippage)
- Bot will automatically retry with next opportunity
- Increase `maxSlippage` if persistent (default 0.5%)

### Stuck positions / Zero liquidity
- Check `positions-fl.json` for `status: "ACTIVE"` trades
- Use DexScreener API to check current liquidity
- If liquidity is 0, mark as `CLOSED` with `exitReason: "LIQUIDITY_DRAINED"`
- Run `node emergency-sell.mjs` to force-close stuck positions

### ML predictor not learning
- Check `ml-model.json` exists and has `tradesLearned > 0`
- Ensure `recordTradeOutcome()` is called on exits
- Model needs 10+ trades for reasonable predictions

## Resources

- Solend SDK: https://github.com/solendprotocol/solend-sdk
- Jupiter API: https://station.jup.ag/docs/apis/swap-api
- Solana Web3.js: https://solana-labs.github.io/solana-web3.js/
- Anchor Framework: https://www.anchor-lang.com/
