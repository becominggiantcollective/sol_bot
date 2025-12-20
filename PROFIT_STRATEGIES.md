# 🚀 Flash Loan Sniper - Multi-Strategy Profit System

## 🎯 **NEW: Configurable Flash Loan Amounts & Multi-Level Profit Taking**

The bot now supports **configurable flash loan amounts** and **3-tier profit strategies** for optimal risk-adjusted trading.

## ⚙️ **Configuration Options**

### Environment Variables

```bash
# Flash loan amounts (comma-separated, in SOL)
export FLASH_LOAN_AMOUNTS="0.5,1,2,3,5"

# Risk mode: conservative, moderate, aggressive
export RISK_MODE="moderate"
```

### Risk Modes

| Mode | Min Liquidity | Max Age | Size Multiplier | Best For |
|------|---------------|---------|-----------------|----------|
| **Conservative** | $5,000 | 2 hours | 0.5x | New tokens, low risk |
| **Moderate** | $2,000 | 6 hours | 1.0x | Balanced approach |
| **Aggressive** | $1,000 | 24 hours | 1.5x | High-conviction trades |

## 📈 **Profit Strategies**

### Small Gains Strategy (Quick Flips)
- **Target**: +5% profit
- **Stop Loss**: -3%
- **Max Hold**: 5 minutes
- **Best for**: Very new tokens (< 1 hour) or high-risk tokens

### Medium Gains Strategy (Balanced)
- **Target**: +15% profit
- **Stop Loss**: -8%
- **Max Hold**: 15 minutes
- **Best for**: Moderately aged tokens (1-12 hours)

### Large Gains Strategy (Swing Trades)
- **Target**: +25% profit
- **Stop Loss**: -12%
- **Max Hold**: 30 minutes
- **Best for**: Established tokens (> 12 hours, high liquidity)

## 🧮 **Dynamic Sizing Logic**

Trade size is calculated based on:
1. **Token Age**: Newer tokens get smaller sizes
2. **Liquidity**: Lower liquidity = smaller trades
3. **Risk Score**: Higher risk = smaller trades
4. **Risk Mode**: Multiplier applied to base size

### Examples

```javascript
// Very new token (0.5h, $1K liquidity, 80 risk)
calculateTradeSize(0.5, 1000, 80) // → 0.5 SOL (conservative)

// Established token (8h, $15K liquidity, 20 risk)
calculateTradeSize(8, 15000, 20)  // → 3.0 SOL (moderate)
```

## 🚀 **Usage Examples**

### Conservative Small Gains
```bash
FLASH_LOAN_AMOUNTS="0.5,1,2" RISK_MODE="conservative" node sniper-flashloan.mjs
```

### Moderate Balanced Trading
```bash
FLASH_LOAN_AMOUNTS="1,2,3,5" RISK_MODE="moderate" node sniper-flashloan.mjs
```

### Aggressive High-Risk
```bash
FLASH_LOAN_AMOUNTS="2,5,10" RISK_MODE="aggressive" node sniper-flashloan.mjs
```

## 📊 **Strategy Selection Logic**

```javascript
if (tokenAge < 1 hour || riskScore > 70 || liquidity < $2000) {
  return SMALL_GAINS_STRATEGY;  // Quick 5% flips
} else if (tokenAge < 12 hours || liquidity < $10000) {
  return MEDIUM_GAINS_STRATEGY; // 15% targets
} else {
  return LARGE_GAINS_STRATEGY;   // 25% swings
}
```

## 🎛️ **Testing Configurations**

Run the configuration tester:
```bash
node test-config.mjs
```

This shows how different token characteristics map to trade sizes and strategies across all risk modes.

## 💡 **Profit Optimization Tips**

1. **Start Conservative**: Use small amounts (0.5-2 SOL) for new tokens
2. **Scale Up**: Increase amounts as tokens mature and prove themselves
3. **Risk Adjust**: Lower amounts for high-risk tokens, higher for established ones
4. **Time-Based Exits**: All strategies have maximum hold times to prevent stagnation
5. **Dynamic Fees**: Priority fees adjust automatically based on network conditions

## 🔍 **Monitoring**

The bot now shows strategy selection in logs:
```
🔥 FLASH LOAN TRADE [MODERATE]
   Token: NEWTOKEN
   Age: 0.5h | Liquidity: $1,000
   Risk Score: 80/100
   Strategy: SMALL GAINS
   Flash Loan: 0.5000 SOL
   Target: +5% (Stop: -3%)
   Max Hold: 5 min
```

## ⚠️ **Risk Management**

- **Gas Safety**: Only your gas money is at risk (flash loans are free if trades fail)
- **Stop Losses**: Automatic exit at strategy-specific loss levels
- **Time Limits**: No position held longer than strategy allows
- **Liquidity Filters**: Minimum liquidity requirements prevent illiquid trades</content>
<parameter name="filePath">/home/technocalypse/sol_bot/PROFIT_STRATEGIES.md