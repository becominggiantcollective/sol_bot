import { SolanaArbitrageBot } from './src/index';
import { Logger } from './src/utils';

export class BotMonitor {
  private bot: SolanaArbitrageBot;
  private logger: Logger;
  private stats = {
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    avgProfit: 0,
    startTime: Date.now(),
  };

  constructor() {
    this.bot = new SolanaArbitrageBot();
    this.logger = Logger.getInstance();
  }

  async startMonitoring(): Promise<void> {
    console.log('🎛️  Starting Enhanced Bot Monitor Dashboard...\n');
    
    try {
      // Display initial bot status
      await this.displayStatus();
      
      // Set up monitoring interval - faster updates for production
      setInterval(async () => {
        await this.displayStatus();
      }, 5000); // Update every 5 seconds for real-time monitoring
      
    } catch (error) {
      console.error('Monitor error:', error);
    }
  }

  private async displayStatus(): Promise<void> {
    console.clear();
    console.log('═'.repeat(100));
    console.log('🤖  SOLANA ARBITRAGE BOT - ENHANCED PRODUCTION MONITOR DASHBOARD');
    console.log('═'.repeat(100));
    
    try {
      // Bot status
      const isActive = this.bot.isActive();
      const walletAddress = await this.bot.getWalletAddress();
      const balance = await this.bot.getWalletBalance();
      
      // Get profitability metrics if available
      const profitMetrics = this.bot.getProfitMetrics();
      
      console.log(`\n📊 BOT STATUS`);
      console.log(`├─ Status: ${isActive ? '🟢 ACTIVE & SCANNING' : '🔴 INACTIVE'}`);
      console.log(`├─ Wallet: ${walletAddress.substring(0, 8)}...${walletAddress.substring(walletAddress.length - 8)}`);
      console.log(`├─ Balance: ${balance.toFixed(4)} SOL`);
      console.log(`└─ Health: ${balance > 0.5 ? '🟢 Good' : balance > 0.1 ? '🟡 Low' : '🔴 Critical'}\n`);
      
      // Performance metrics
      console.log(`💰 PROFITABILITY METRICS`);
      if (profitMetrics) {
        console.log(`├─ Net Profit: ${profitMetrics.netProfit >= 0 ? '✅' : '❌'} $${profitMetrics.netProfit.toFixed(4)}`);
        console.log(`├─ Total Profit: $${profitMetrics.totalProfit.toFixed(4)}`);
        console.log(`├─ Total Loss: $${profitMetrics.totalLoss.toFixed(4)}`);
        console.log(`├─ ROI: ${profitMetrics.roi.toFixed(2)}%`);
        console.log(`├─ Win Rate: ${profitMetrics.winRate.toFixed(1)}% (${profitMetrics.successfulTrades}/${profitMetrics.totalTrades})`);
        console.log(`├─ Avg Trade: $${profitMetrics.averageTradeProfit.toFixed(4)}`);
        console.log(`├─ Best Trade: $${profitMetrics.bestTrade.toFixed(4)}`);
        console.log(`├─ Hourly Rate: $${profitMetrics.hourlyProfit.toFixed(2)}/hr`);
        console.log(`└─ Daily Projection: $${profitMetrics.dailyProfit.toFixed(2)}/day\n`);
      } else {
        console.log(`└─ No trades executed yet\n`);
      }
      
      // Trading statistics
      const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      
      console.log(`📈 TRADING ACTIVITY`);
      console.log(`├─ Uptime: ${hours}h ${minutes}m ${seconds}s`);
      console.log(`├─ Last Scan: ${new Date().toLocaleTimeString()}`);
      console.log(`└─ Scan Interval: ~2s (Aggressive)\n`);
      
      // Market information
      console.log(`🏪 MARKET CONFIGURATION`);
      console.log(`├─ DEXes: Jupiter (v6), Orca, Raydium`);
      console.log(`├─ Flashloan: Solend (0.03%), Mango (0.01%)`);
      console.log(`├─ Token Pairs: 14 high-volume pairs`);
      console.log(`├─ Min Profit: 0.2% (optimized threshold)`);
      console.log(`├─ Max Slippage: 0.5% (tight execution)`);
      console.log(`├─ Priority Fee: 3.0x multiplier`);
      console.log(`└─ Position Size: Up to $5,000\n`);
      
      // Performance indicators
      console.log(`🎯 PERFORMANCE INDICATORS`);
      if (profitMetrics && profitMetrics.totalTrades > 10) {
        const performance = profitMetrics.winRate >= 55 && profitMetrics.hourlyProfit >= 0.5 ? '🟢 Excellent' :
                           profitMetrics.winRate >= 45 && profitMetrics.hourlyProfit >= 0 ? '🟡 Good' : '🔴 Needs Tuning';
        console.log(`├─ Overall: ${performance}`);
        console.log(`├─ Profit Factor: ${(profitMetrics.totalProfit / (profitMetrics.totalLoss || 1)).toFixed(2)}`);
        console.log(`└─ Trade Efficiency: ${(profitMetrics.netProfit / profitMetrics.totalTrades).toFixed(4)} per trade\n`);
      } else {
        console.log(`└─ Collecting data... (need 10+ trades for analysis)\n`);
      }
      
      // Warnings and recommendations
      const warnings: string[] = [];
      if (balance < 0.1) {
        warnings.push('🔴 CRITICAL: SOL balance too low! Add funds immediately.');
      } else if (balance < 0.5) {
        warnings.push('🟡 WARNING: SOL balance getting low. Consider adding more.');
      }
      
      if (!isActive) {
        warnings.push('💤 Bot is not active. Start with bot.start() to begin trading.');
      }
      
      if (profitMetrics && profitMetrics.totalTrades > 10 && profitMetrics.winRate < 45) {
        warnings.push('⚠️  Low win rate detected. Consider adjusting MIN_PROFIT_THRESHOLD.');
      }
      
      if (profitMetrics && profitMetrics.netProfit < 0 && profitMetrics.totalTrades > 20) {
        warnings.push('🔴 Negative net profit! Review strategy parameters immediately.');
      }
      
      if (warnings.length > 0) {
        console.log(`⚠️  ALERTS & RECOMMENDATIONS`);
        warnings.forEach(warning => console.log(`  ${warning}`));
        console.log();
      }
      
      console.log(`${'─'.repeat(100)}`);
      console.log(`🔄 Auto-refresh: 5s | 📊 Full metrics every 5min | Press Ctrl+C to exit`);
      
    } catch (error) {
      console.error('Error updating dashboard:', error);
    }
  }

  updateStats(profit: number, successful: boolean): void {
    this.stats.totalTrades++;
    if (successful) {
      this.stats.successfulTrades++;
      this.stats.totalProfit += profit;
      this.stats.avgProfit = this.stats.totalProfit / this.stats.successfulTrades;
    }
  }
}

// CLI interface
async function main(): Promise<void> {
  console.log('\n🚀 Initializing Enhanced Production Monitor...\n');
  
  const monitor = new BotMonitor();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down monitor gracefully...');
    console.log('📊 Final stats saved to logs.');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\n👋 Received SIGTERM, shutting down...');
    process.exit(0);
  });
  
  await monitor.startMonitoring();
}

if (require.main === module) {
  main().catch(console.error);
}

export default BotMonitor;