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
    console.log('🎛️  Starting Bot Monitor Dashboard...\n');
    
    try {
      // Display initial bot status
      await this.displayStatus();
      
      // Set up monitoring interval
      setInterval(async () => {
        await this.displayStatus();
      }, 10000); // Update every 10 seconds
      
    } catch (error) {
      console.error('Monitor error:', error);
    }
  }

  private async displayStatus(): Promise<void> {
    console.clear();
    console.log('═'.repeat(80));
    console.log('🤖  SOLANA ARBITRAGE BOT MONITOR DASHBOARD');
    console.log('═'.repeat(80));
    
    try {
      // Bot status
      const isActive = this.bot.isActive();
      const walletAddress = await this.bot.getWalletAddress();
      const balance = await this.bot.getWalletBalance();
      
      console.log(`\n📊 BOT STATUS`);
      console.log(`├─ Status: ${isActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
      console.log(`├─ Wallet: ${walletAddress}`);
      console.log(`└─ Balance: ${balance.toFixed(4)} SOL\n`);
      
      // Trading statistics
      const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      
      console.log(`📈 TRADING STATISTICS`);
      console.log(`├─ Uptime: ${hours}h ${minutes}m ${seconds}s`);
      console.log(`├─ Total Trades: ${this.stats.totalTrades}`);
      console.log(`├─ Successful: ${this.stats.successfulTrades}`);
      console.log(`├─ Success Rate: ${this.stats.totalTrades > 0 ? ((this.stats.successfulTrades / this.stats.totalTrades) * 100).toFixed(1) : 0}%`);
      console.log(`├─ Total Profit: ${this.stats.totalProfit.toFixed(4)} SOL`);
      console.log(`└─ Avg Profit: ${this.stats.avgProfit.toFixed(4)} SOL\n`);
      
      // Market information
      console.log(`🏪 MARKET STATUS`);
      console.log(`├─ Monitoring: Jupiter, Orca, Raydium`);
      console.log(`├─ Flashloan Providers: Solend, Mango`);
      console.log(`├─ Token Pairs: SOL/USDC, USDC/USDT, SOL/BONK, etc.`);
      console.log(`└─ Last Scan: ${new Date().toLocaleTimeString()}\n`);
      
      // Warnings
      if (balance < 0.1) {
        console.log(`⚠️  WARNING: Low SOL balance (${balance.toFixed(4)}). Add funds for gas fees.`);
      }
      
      if (!isActive) {
        console.log(`💡 TIP: Call bot.start() to begin arbitrage hunting`);
      }
      
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🔄 Next update in 10 seconds... Press Ctrl+C to exit`);
      
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
  const monitor = new BotMonitor();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down monitor...');
    process.exit(0);
  });
  
  await monitor.startMonitoring();
}

if (require.main === module) {
  main().catch(console.error);
}

export default BotMonitor;