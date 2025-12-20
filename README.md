# Solana Arbitrage & MEV Bot

A sophisticated Solana trading bot that executes flashloan arbitrage and MEV (Maximal Extractable Value) strategies across multiple DEXes.

## ⚠️ Production Status & Assessment

**Before deploying to production, please read:**
- 📋 [**Assessment Summary**](ASSESSMENT_SUMMARY.md) - Quick reference guide (5 min read)
- 📊 [**Pre-Go-Live Assessment**](PRE_GO_LIVE_ASSESSMENT.md) - Comprehensive readiness evaluation (30 min read)
- 🚀 [**Production Deployment Guide**](PRODUCTION_DEPLOYMENT_GUIDE.md) - Step-by-step deployment instructions
- ✅ Run `npm run pre-deploy-check` before any production deployment

**Current Status:** Functional with identified areas for optimization. See assessment for details.

## Features

- **Flashloan Arbitrage**: Executes arbitrage opportunities using flashloans from Solend and Mango Markets
- **MEV Strategies**: Implements sandwich attacks and liquidation strategies
- **Aggressive Liquidation Bot**: Fast liquidation execution using flash loans with priority fee optimization
- **Multi-Protocol Support**: Monitors Solend, Mango Markets, and Port Finance for liquidation opportunities
- **Multi-DEX Support**: Monitors Jupiter, Orca, and Raydium for arbitrage opportunities
- **Real-time Monitoring**: Continuously scans for profitable trading and liquidation opportunities
- **Enhanced Profitability Tracking**: Built-in metrics dashboard with ROI, win rate, and hourly profit tracking
- **Comprehensive Backtesting**: Test strategies with historical data simulation and Sharpe ratio analysis
- **Risk Management**: Built-in slippage protection and gas fee limits
- **Speed Optimization**: Priority fees, parallel execution, and optimized transaction construction
- **Production-Ready**: Deployment scripts, monitoring dashboard, and comprehensive documentation
- **Configurable**: Easily customizable trading and liquidation parameters

## Sentiment-based signals (prototype)

This project includes a prototype sentiment microservice (Hugging Face) and a Node client to optionally boost strategy scores based on social signals (X/Twitter and Telegram). See docs/SENTIMENT_INTEGRATION.md for usage and how to run the prototype locally.

## Architecture

```
src/
├── config/          # Configuration management
├── core/            # Core bot functionality
│   ├── connection.ts    # Solana connection handling
│   ├── arbitrage.ts     # Arbitrage detection logic
│   └── flashloan.ts     # Flashloan provider integration
├── strategies/      # MEV and trading strategies
│   └── mev.ts          # MEV strategy implementations
├── types/           # TypeScript type definitions
├── utils/           # Utility functions and helpers
└── index.ts         # Main bot entry point
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/becominggiantcollective/sol_bot.git
cd sol_bot
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Configuration

Create a `.env` file with the following variables:

```env
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Wallet (Use a dedicated trading wallet)
WALLET_PRIVATE_KEY=[your_private_key_array]
WALLET_PUBLIC_KEY=your_public_key

# Trading Parameters - Optimized for Production
MAX_SLIPPAGE=0.005                # 0.5% maximum slippage (tighter for better execution)
MAX_GAS_FEE=0.02                 # 0.02 SOL maximum gas fee (higher for priority)
MIN_PROFIT_THRESHOLD=0.002       # 0.2% minimum profit threshold
MAX_POSITION_SIZE=5000           # $5000 maximum position size

# Flashloan Settings
MAX_FLASHLOAN_AMOUNT=500000      # $500k maximum flashloan amount

# Liquidation Settings - Aggressive for Maximum Profit
MAX_CONCURRENT_LIQUIDATIONS=5    # Maximum parallel liquidations
LIQUIDATION_MIN_PROFIT=0.015     # 1.5% minimum profit threshold
PRIORITY_FEE_MULTIPLIER=3.0      # 3x multiplier for priority fees

# Environment
NODE_ENV=production
LOG_LEVEL=info
```

## Usage

### Pre-Deployment Check
**ALWAYS run before production deployment:**
```bash
npm run pre-deploy-check
```

This automated checker verifies:
- ✅ Environment setup and dependencies
- ✅ Security vulnerabilities
- ✅ Build status and tests
- ✅ Configuration completeness
- ⚠️ Potential deployment issues

### Quick Start
```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your wallet configuration

# 2. Run deployment script (recommended)
./deploy.sh

# OR manually:

# 3. Test bot setup
npm run example

# 4. Run backtesting to verify profitability
npm run backtest

# 5. Test liquidation bot
npm run liquidation-example

# 6. Start monitoring dashboard
npm run monitor

# 4. Run pre-deployment checks
npm run pre-deploy-check

# 5. Start the bot (in production)
npm start
```

### Production Deployment

For production deployment, use the included deployment script:

```bash
./deploy.sh
```

This script will:
- ✅ Validate your environment and dependencies
- ✅ Check wallet configuration
- ✅ Run tests and build the project
- ✅ Offer deployment options (PM2, nohup, or manual)
- ✅ Provide performance recommendations

See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for the complete pre-launch checklist.

### Backtesting
Before deploying with real funds, run comprehensive backtests:

```bash
npm run backtest
```

This will:
- 🔍 Detect current arbitrage opportunities
- 📊 Simulate 30 days of trading
- 💰 Calculate expected profitability metrics
- 📈 Provide performance analysis (Sharpe ratio, profit factor, win rate)
- 💡 Offer optimization recommendations

Example output:
```
Net Profit: $1,234.56 (12.35% ROI over 30 days)
Win Rate: 65.5%
Profit Factor: 2.34
Sharpe Ratio: 1.87
```

### Liquidation Bot Demo
To see the aggressive liquidation strategies in action:
```bash
npm run liquidation-example
```

This demonstrates:
- ⚡ Real-time liquidation opportunity detection across Solend, Mango, and Port Finance
- 💰 Flash loan-based execution for zero-capital liquidations  
- 🚀 Priority fee optimization to outcompete other liquidators
- 📊 Parallel execution with performance metrics
- 🎯 Health factor monitoring and urgency classification
```

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Testing
```bash
npm test
```

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start the bot in production mode
- `npm run dev` - Run in development mode with hot reload
- `npm run example` - Test bot initialization and wallet setup
- `npm run backtest` - Run comprehensive backtesting simulation
- `npm run liquidation-example` - Demo aggressive liquidation strategies
- `npm run monitor` - Launch real-time monitoring dashboard
- `npm test` - Run all unit tests
- `npm run lint` - Check code quality
- `npm run format` - Format code with Prettier
- `./deploy.sh` - Production deployment script

### Linting
```bash
npm run lint
npm run format
```

### Environment Configurations

The bot supports multiple environment configurations:

- **Development**: `.env` (default)
- **Devnet Testing**: `.env.devnet`
- **Mainnet Production**: `.env.mainnet`

Copy the appropriate configuration:
```bash
# For devnet testing
cp .env.devnet .env

# For mainnet production
cp .env.mainnet .env
```

## Strategies

### 1. Flashloan Arbitrage
- Detects price differences across DEXes
- Uses flashloans to execute arbitrage without initial capital
- Automatically repays loan with profit

### 2. Sandwich Attacks
- Monitors for large transactions
- Front-runs and back-runs profitable trades
- **Note**: Use ethically and in compliance with platform terms

### 3. Aggressive Liquidation Bot
- Monitors lending protocols (Solend, Mango, Port) for undercollateralized positions
- Uses flash loans for capital-efficient liquidations
- Implements high-priority fees to outcompete other liquidators
- Parallel execution for maximum speed
- Real-time health factor monitoring
- Automatic profit optimization and collateral swapping

## Performance Optimization

### Production-Tuned Parameters

The bot comes pre-configured with optimized parameters for maximum profitability:

- **Tighter Slippage**: 0.5% (down from 1%) for better execution
- **Higher Priority Fees**: 3.0x multiplier (up from 2.0x) for winning liquidation races
- **Larger Positions**: $5,000 max (up from $1,000) for better profit potential
- **More Tokens**: 14 high-volume pairs (up from 7) for more opportunities
- **Parallel Processing**: Concurrent opportunity detection across all DEXes
- **Aggressive Thresholds**: 0.2% profit minimum with 1.5% liquidation threshold

### Profitability Tracking

Built-in comprehensive metrics tracking:

- 💰 Real-time profit/loss monitoring
- 📊 Win rate and success metrics
- ⏱️ Hourly and daily profit projections
- 🎯 ROI and performance indicators
- 📈 Trade history and analysis
- ⚡ Performance warnings and recommendations

Access metrics via:
```typescript
const metrics = bot.getProfitMetrics();
console.log(`ROI: ${metrics.roi}%`);
console.log(`Win Rate: ${metrics.winRate}%`);
console.log(`Hourly Profit: $${metrics.hourlyProfit}`);
```

## Risk Management

- **Slippage Protection**: Configurable maximum slippage tolerance (0.5% default)
- **Gas Fee Limits**: Prevents execution if gas fees are too high (0.02 SOL max)
- **Profit Thresholds**: Only executes trades above minimum profit threshold (0.2% default)
- **Position Sizing**: Limits maximum trade size to manage risk ($5,000 default)
- **Circuit Breakers**: Automatic shutdown on excessive losses
- **Performance Monitoring**: Real-time alerts for low win rates or negative ROI

## Performance Expectations

Based on optimized parameters and current market conditions:

**Conservative Estimates** (Well-tuned parameters):
- Win Rate: 50-60%
- Hourly Profit: $0.50 - $2.00
- Daily Profit: $12 - $48
- Monthly Profit: $360 - $1,440

**Optimistic Estimates** (Ideal conditions):
- Win Rate: 65-75%
- Hourly Profit: $2.00 - $5.00
- Daily Profit: $48 - $120
- Monthly Profit: $1,440 - $3,600

**Important Notes**:
- Results vary based on market volatility and liquidity
- Higher capital enables larger positions and better profits
- Premium RPC endpoints significantly improve win rate
- Competition from other bots affects profitability
- Past performance does not guarantee future results

See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for detailed performance targets.

## Security

⚠️ **Important Security Notes:**

1. **Never commit private keys** to version control
2. Use a **dedicated trading wallet** with limited funds
3. **Test thoroughly** on devnet before mainnet deployment
4. **Monitor bot performance** and set appropriate limits
5. **Keep dependencies updated** for security patches

## Legal and Ethical Considerations

- Ensure compliance with local regulations
- Some MEV strategies may violate DEX terms of service
- Use responsibly and consider impact on other users
- This software is for educational purposes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Disclaimer

This software is provided "as is" without warranty. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this bot.

**Use at your own risk and never invest more than you can afford to lose.**
