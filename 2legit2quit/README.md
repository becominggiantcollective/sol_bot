# 2legit2quit - Solana Trading Agent

An AI trading agent built with the Claude Agent SDK, specialized for analyzing Solana trading strategies, evaluating profitability, and optimizing MEV/arbitrage operations.

## Features

🤖 **AI-Powered Trading Analysis**
- Analyzes trading strategies and backtests
- Calculates profitability metrics (ROI, fees, break-even)
- Evaluates risk metrics (position sizing, stop-loss levels)
- Reviews code and configuration files
- Optimizes thresholds and parameters

📊 **Custom Trading Tools**
- `analyze_profitability`: Calculate profit/loss, ROI, and break-even prices
- `calculate_risk_metrics`: Determine position sizing and risk-reward ratios
- `evaluate_strategy_performance`: Assess win rate, profit factor, and drawdown

🔧 **Integration with Solana Bot**
- Direct access to your trading bot files
- Can read strategies, configs, and backtest results
- Provides actionable insights for optimization

## Setup

### 1. Install Dependencies

```bash
# Activate virtual environment
source venv/bin/activate

# Install dependencies (already done during setup)
pip install -r requirements.txt
```

### 2. Set Your API Key

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_actual_api_key_here
   ```

3. Get your API key from: https://console.anthropic.com/

### 3. Run the Agent

```bash
# Make sure virtual environment is activated
source venv/bin/activate

# Run the trading agent
python main.py
```

## Usage Examples

### Interactive Mode

```python
python main.py
```

Then ask questions like:
- "Analyze the flashloan-arb.ts strategy and calculate realistic profit expectations"
- "What are the current profitability thresholds in the arbitrage module?"
- "Review the backtest results and identify areas for improvement"
- "Calculate position sizing for a $1000 account with 2% risk"

### Programmatic Usage

```python
from main import analyze_strategy_example
import asyncio

# Run automated analysis
result = asyncio.run(analyze_strategy_example())
print(result)
```

### Using Custom Trading Tools

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from main import create_trading_agent_options

async def quick_analysis():
    options = create_trading_agent_options()

    async with ClaudeSDKClient(options=options) as client:
        await client.query(
            "Calculate profitability for a trade: entry $100, exit $105, "
            "position size 10, fees $0.50"
        )

        async for message in client.receive_response():
            print(message)
```

## Custom Tools Reference

### analyze_profitability
Calculate profit/loss metrics from trading data.

**Parameters:**
- `entry_price` (float): Entry price of the position
- `exit_price` (float): Exit price of the position
- `position_size` (float): Size of the position
- `fees` (float): Total transaction fees

**Returns:** Gross profit, net profit, ROI%, fees, break-even price

### calculate_risk_metrics
Calculate position sizing and risk management metrics.

**Parameters:**
- `account_balance` (float): Total account balance
- `risk_percentage` (float): Percentage of account to risk (e.g., 2.0)
- `entry_price` (float): Planned entry price
- `stop_loss_price` (float): Stop-loss price
- `take_profit_price` (float): Take-profit target

**Returns:** Position size, risk amount, potential profit/loss, risk-reward ratio

### evaluate_strategy_performance
Evaluate overall trading strategy performance from backtest results.

**Parameters:**
- `total_trades` (int): Total number of trades
- `winning_trades` (int): Number of winning trades
- `total_profit` (float): Sum of all profits
- `total_loss` (float): Sum of all losses
- `max_drawdown` (float): Maximum drawdown percentage

**Returns:** Win rate, net profit, profit factor, max drawdown, assessment

## Project Structure

```
2legit2quit/
├── main.py              # Main trading agent application
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variables template
├── .env                # Your actual API key (gitignored)
├── venv/               # Python virtual environment
└── README.md           # This file
```

## SDK Information

- **SDK Version:** claude-agent-sdk 0.1.17
- **Python Required:** >= 3.10
- **Documentation:** https://docs.claude.com/en/api/agent-sdk/python

## Next Steps

1. ✅ Set your API key in `.env`
2. ✅ Run `python main.py` to start the agent
3. Ask the agent to analyze your trading strategies
4. Use insights to optimize your Solana bot
5. Add more custom tools as needed

## Advanced Features

### Adding New Trading Tools

Define new tools in `main.py`:

```python
@tool(
    name="your_tool_name",
    description="What your tool does",
    input_schema={"param1": float, "param2": str}
)
async def your_tool(args: dict[str, Any]) -> dict[str, Any]:
    # Your logic here
    return {
        "content": [{
            "type": "text",
            "text": "Result"
        }]
    }
```

Then add it to the MCP server in `create_trading_agent_options()`.

### Continuous Conversation

The agent maintains context across multiple questions in the same session:

```
You: "What's the current profit threshold in arbitrage.ts?"
Agent: "The minimum profit threshold is 0.1%"
You: "Is that realistic for Solana?"  # Agent remembers context
Agent: "For Solana's current fee structure..."
```

## Troubleshooting

**Error: ANTHROPIC_API_KEY not found**
- Make sure you copied `.env.example` to `.env`
- Add your actual API key to the `.env` file

**Import errors**
- Activate the virtual environment: `source venv/bin/activate`
- Reinstall dependencies: `pip install -r requirements.txt`

**Agent can't read trading files**
- The agent's working directory is set to the parent `sol_bot` folder
- It can read all files in your Solana bot project

## License

This trading agent is part of your Solana bot project.
