#!/usr/bin/env python3
"""
2legit2quit - Trading Agent for Solana Bot
A Claude Agent SDK application specialized for trading analysis and strategy evaluation.
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
    ToolUseBlock,
    ResultMessage,
    tool,
    create_sdk_mcp_server,
)

# Load environment variables from .env file
load_dotenv()


# ============================================================================
# Custom Trading Tools
# ============================================================================

@tool(
    name="analyze_profitability",
    description="Calculate profit/loss metrics from trading data including ROI, win rate, and risk-reward ratio",
    input_schema={
        "entry_price": float,
        "exit_price": float,
        "position_size": float,
        "fees": float,
    }
)
async def analyze_profitability(args: dict[str, Any]) -> dict[str, Any]:
    """Analyze profitability of a trade."""
    try:
        entry_price = args["entry_price"]
        exit_price = args["exit_price"]
        position_size = args["position_size"]
        fees = args["fees"]

        # Calculate profit/loss
        gross_profit = (exit_price - entry_price) * position_size
        net_profit = gross_profit - fees
        roi = (net_profit / (entry_price * position_size)) * 100

        result = {
            "gross_profit": round(gross_profit, 6),
            "net_profit": round(net_profit, 6),
            "roi_percent": round(roi, 2),
            "fees": round(fees, 6),
            "break_even_price": round(entry_price + (fees / position_size), 6),
        }

        return {
            "content": [{
                "type": "text",
                "text": f"📊 Profitability Analysis:\n"
                        f"Gross Profit: ${result['gross_profit']:.6f}\n"
                        f"Net Profit: ${result['net_profit']:.6f}\n"
                        f"ROI: {result['roi_percent']:.2f}%\n"
                        f"Fees: ${result['fees']:.6f}\n"
                        f"Break-even Price: ${result['break_even_price']:.6f}"
            }]
        }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"Error calculating profitability: {str(e)}"
            }],
            "is_error": True
        }


@tool(
    name="calculate_risk_metrics",
    description="Calculate risk metrics including position sizing, stop-loss levels, and risk-reward ratios",
    input_schema={
        "account_balance": float,
        "risk_percentage": float,
        "entry_price": float,
        "stop_loss_price": float,
        "take_profit_price": float,
    }
)
async def calculate_risk_metrics(args: dict[str, Any]) -> dict[str, Any]:
    """Calculate position sizing and risk metrics."""
    try:
        account_balance = args["account_balance"]
        risk_percentage = args["risk_percentage"]
        entry_price = args["entry_price"]
        stop_loss_price = args["stop_loss_price"]
        take_profit_price = args["take_profit_price"]

        # Calculate position size
        risk_amount = account_balance * (risk_percentage / 100)
        price_risk = abs(entry_price - stop_loss_price)
        position_size = risk_amount / price_risk if price_risk > 0 else 0

        # Calculate risk-reward ratio
        potential_loss = abs(entry_price - stop_loss_price)
        potential_profit = abs(take_profit_price - entry_price)
        risk_reward_ratio = potential_profit / potential_loss if potential_loss > 0 else 0

        result = {
            "position_size": round(position_size, 4),
            "risk_amount": round(risk_amount, 2),
            "potential_profit": round(potential_profit * position_size, 2),
            "potential_loss": round(potential_loss * position_size, 2),
            "risk_reward_ratio": round(risk_reward_ratio, 2),
        }

        return {
            "content": [{
                "type": "text",
                "text": f"⚖️ Risk Metrics:\n"
                        f"Position Size: {result['position_size']:.4f} units\n"
                        f"Risk Amount: ${result['risk_amount']:.2f}\n"
                        f"Potential Profit: ${result['potential_profit']:.2f}\n"
                        f"Potential Loss: ${result['potential_loss']:.2f}\n"
                        f"Risk-Reward Ratio: 1:{result['risk_reward_ratio']:.2f}"
            }]
        }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"Error calculating risk metrics: {str(e)}"
            }],
            "is_error": True
        }


@tool(
    name="evaluate_strategy_performance",
    description="Evaluate trading strategy performance from backtest results including Sharpe ratio and max drawdown",
    input_schema={
        "total_trades": int,
        "winning_trades": int,
        "total_profit": float,
        "total_loss": float,
        "max_drawdown": float,
    }
)
async def evaluate_strategy_performance(args: dict[str, Any]) -> dict[str, Any]:
    """Evaluate overall strategy performance."""
    try:
        total_trades = args["total_trades"]
        winning_trades = args["winning_trades"]
        total_profit = args["total_profit"]
        total_loss = args["total_loss"]
        max_drawdown = args["max_drawdown"]

        # Calculate metrics
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        net_profit = total_profit - total_loss
        profit_factor = total_profit / total_loss if total_loss > 0 else float('inf')

        return {
            "content": [{
                "type": "text",
                "text": f"📈 Strategy Performance:\n"
                        f"Total Trades: {total_trades}\n"
                        f"Win Rate: {win_rate:.2f}%\n"
                        f"Net Profit: ${net_profit:.2f}\n"
                        f"Profit Factor: {profit_factor:.2f}\n"
                        f"Max Drawdown: {max_drawdown:.2f}%\n"
                        f"Assessment: {'PROFITABLE' if net_profit > 0 else 'UNPROFITABLE'}"
            }]
        }
    except Exception as e:
        return {
            "content": [{
                "type": "text",
                "text": f"Error evaluating strategy: {str(e)}"
            }],
            "is_error": True
        }


# ============================================================================
# Trading Agent Configuration
# ============================================================================

def create_trading_agent_options() -> ClaudeAgentOptions:
    """Create configuration for the trading agent."""

    # Create MCP server with custom trading tools
    trading_tools_server = create_sdk_mcp_server(
        name="trading_tools",
        version="1.0.0",
        tools=[
            analyze_profitability,
            calculate_risk_metrics,
            evaluate_strategy_performance,
        ]
    )

    # Get the parent directory (sol_bot) to access trading bot files
    sol_bot_dir = Path(__file__).parent.parent.absolute()

    return ClaudeAgentOptions(
        # System prompt optimized for trading analysis
        system_prompt="""You are an expert trading agent specialized in analyzing Solana trading strategies,
evaluating profitability, managing risk, and optimizing trading performance.

Your expertise includes:
- MEV (Maximal Extractable Value) strategies
- Arbitrage opportunities across DEXes
- Flash loan strategies
- Liquidity analysis and pool monitoring
- Risk management and position sizing
- Backtest analysis and strategy optimization
- Market microstructure and timing optimization

When analyzing strategies:
1. Always consider transaction fees and slippage
2. Calculate realistic profit expectations
3. Assess risk-reward ratios
4. Identify potential vulnerabilities (frontrunning, sandwich attacks)
5. Recommend optimal parameters for thresholds and limits

Use the custom trading tools to perform detailed calculations.""",

        # MCP servers with custom trading tools
        mcp_servers={
            "trading": trading_tools_server,
        },

        # Allow both custom tools and file operations
        allowed_tools=[
            # Custom trading tools (prefixed with mcp__trading__)
            "mcp__trading__analyze_profitability",
            "mcp__trading__calculate_risk_metrics",
            "mcp__trading__evaluate_strategy_performance",
            # File operations to read strategy files
            "Read",
            "Glob",
            "Grep",
            # Optional: allow writing analysis results
            "Write",
        ],

        # Set working directory to sol_bot for accessing trading files
        cwd=str(sol_bot_dir),

        # Auto-accept file reads but ask for permission on writes
        permission_mode="default",
    )


# ============================================================================
# Main Trading Agent Interface
# ============================================================================

async def run_trading_agent():
    """Run the trading agent in interactive mode."""

    # Check for API key
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("❌ Error: ANTHROPIC_API_KEY not found in environment")
        print("Please set your API key in the .env file")
        print("Get your API key from: https://console.anthropic.com/")
        sys.exit(1)

    print("=" * 80)
    print("🤖 2legit2quit - Solana Trading Agent")
    print("=" * 80)
    print()
    print("Welcome! I'm your AI trading analyst for the Solana bot.")
    print()
    print("I can help you with:")
    print("  • Analyzing trading strategies and backtests")
    print("  • Calculating profitability and risk metrics")
    print("  • Reviewing code and configuration")
    print("  • Optimizing thresholds and parameters")
    print("  • Evaluating arbitrage and MEV opportunities")
    print()
    print("Commands:")
    print("  'exit' or 'quit' - End the session")
    print("  'help' - Show available capabilities")
    print()
    print("=" * 80)
    print()

    # Create client with trading agent configuration
    options = create_trading_agent_options()

    async with ClaudeSDKClient(options=options) as client:
        turn_count = 0

        while True:
            # Get user input
            try:
                user_input = input(f"\n[{turn_count + 1}] You: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n\nGoodbye! 👋")
                break

            # Check for exit commands
            if user_input.lower() in ['exit', 'quit', 'q']:
                print("Goodbye! 👋")
                break

            # Handle help command
            if user_input.lower() == 'help':
                print("\n📚 Available Capabilities:")
                print("  • Analyze profitability: Calculate ROI, fees, break-even")
                print("  • Risk metrics: Position sizing, stop-loss levels")
                print("  • Strategy performance: Win rate, profit factor, drawdown")
                print("  • File access: Read strategy configs, backtest results")
                print("  • Code review: Analyze trading logic and optimizations")
                continue

            # Skip empty inputs
            if not user_input:
                continue

            # Send query to Claude
            await client.query(user_input)
            turn_count += 1

            # Process and display response
            print(f"\n[{turn_count}] Agent: ", end="", flush=True)

            async for message in client.receive_response():
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            print(block.text, end="", flush=True)
                        elif isinstance(block, ToolUseBlock):
                            # Show which tool is being used
                            tool_name = block.name.replace("mcp__trading__", "")
                            print(f"\n[Using tool: {tool_name}]", flush=True)

                elif isinstance(message, ResultMessage):
                    # Show session stats
                    if message.total_cost_usd:
                        print(f"\n\n💰 Cost: ${message.total_cost_usd:.4f}", end="")
                    print()


# Example: Non-interactive usage
async def analyze_strategy_example():
    """Example: Programmatic strategy analysis."""

    options = create_trading_agent_options()

    async with ClaudeSDKClient(options=options) as client:
        # Ask agent to analyze a specific strategy
        await client.query(
            "Read the flashloan-arb.ts file and analyze the profitability "
            "thresholds. Are they realistic given current Solana gas fees?"
        )

        # Collect the response
        response_text = []
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        response_text.append(block.text)

        # Return the full analysis
        return "\n".join(response_text)


if __name__ == "__main__":
    # Run interactive trading agent
    asyncio.run(run_trading_agent())
