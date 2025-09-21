# Solana Arbitrage & MEV Bot

A sophisticated Solana trading bot that executes flashloan arbitrage and MEV (Maximal Extractable Value) strategies across multiple DEXes.

## Features

- **Flashloan Arbitrage**: Executes arbitrage opportunities using flashloans from Solend and Mango Markets
- **MEV Strategies**: Implements sandwich attacks and liquidation strategies
- **Aggressive Liquidation Bot**: Fast liquidation execution using flash loans with priority fee optimization
- **Multi-Protocol Support**: Monitors Solend, Mango Markets, and Port Finance for liquidation opportunities
- **Multi-DEX Support**: Monitors Jupiter, Orca, and Raydium for arbitrage opportunities
- **Real-time Monitoring**: Continuously scans for profitable trading and liquidation opportunities
- **Risk Management**: Built-in slippage protection and gas fee limits
- **Speed Optimization**: Priority fees, parallel execution, and optimized transaction construction
- **Configurable**: Easily customizable trading and liquidation parameters

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
# Solana Network
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Wallet (Use a dedicated trading wallet)
WALLET_PRIVATE_KEY=[your_private_key_array]
WALLET_PUBLIC_KEY=your_public_key

# Trading Parameters
MAX_SLIPPAGE=0.01                # 1% maximum slippage
MAX_GAS_FEE=0.01                # 0.01 SOL maximum gas fee
MIN_PROFIT_THRESHOLD=0.001      # 0.1% minimum profit threshold
MAX_POSITION_SIZE=1000          # $1000 maximum position size

# Flashloan Settings
MAX_FLASHLOAN_AMOUNT=100000     # $100k maximum flashloan amount

# Liquidation Settings
MAX_CONCURRENT_LIQUIDATIONS=3   # Maximum parallel liquidations
LIQUIDATION_MIN_PROFIT=0.02     # 2% minimum profit threshold
PRIORITY_FEE_MULTIPLIER=2.0     # Multiplier for priority fees
```

## Usage

### Quick Start
```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your wallet configuration

# 2. Test bot setup
npm run example

# 3. Start monitoring dashboard
npm run monitor

# 4. Start the bot (in production)
npm start
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

## Risk Management

- **Slippage Protection**: Configurable maximum slippage tolerance
- **Gas Fee Limits**: Prevents execution if gas fees are too high
- **Profit Thresholds**: Only executes trades above minimum profit threshold
- **Position Sizing**: Limits maximum trade size to manage risk

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
