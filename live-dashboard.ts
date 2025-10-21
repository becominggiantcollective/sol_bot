import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { COMMON_TOKENS } from './src/utils';

interface PriceData {
  token: string;
  address: string;
  priceUSD: number;
  change24h: number;
  volume24h: number;
  lastUpdate: Date;
}

interface ArbitrageRoute {
  from: string;
  to: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  profitable: boolean;
}

class LivePriceDashboard {
  private prices: Map<string, PriceData> = new Map();
  private routes: ArbitrageRoute[] = [];
  private updateCount = 0;
  private startTime = Date.now();
  private readonly TOKENS = [COMMON_TOKENS.SOL, COMMON_TOKENS.USDC, COMMON_TOKENS.BONK];

  private readonly TOKEN_NAMES: { [key: string]: string } = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  };

  async start() {
    console.clear();
    console.log('🚀 Starting Live Price Feed Dashboard...\n');

    // Start the update loop
    this.updateLoop();
  }

  private async updateLoop() {
    while (true) {
      try {
        await this.fetchAllPrices();
        await this.calculateArbitrageRoutes();
        this.renderDashboard();
        await this.delay(5000); // Update every 5 seconds
      } catch (error) {
        console.error('Error in update loop:', error);
        await this.delay(10000);
      }
    }
  }

  private async fetchAllPrices() {
    const promises = this.TOKENS.map((token: PublicKey) => this.fetchTokenPrice(token));
    await Promise.allSettled(promises);
    this.updateCount++;
  }

  private async fetchTokenPrice(tokenMint: PublicKey) {
    try {
      const tokenAddress = tokenMint.toString();
      const tokenName = this.TOKEN_NAMES[tokenAddress] || 'UNKNOWN';

      // Fetch price from Jupiter Price API v2
      const response = await axios.get(
        `https://api.jup.ag/price/v2?ids=${tokenAddress}`,
        { timeout: 3000 }
      );

      if (response.data?.data?.[tokenAddress]) {
        const data = response.data.data[tokenAddress];
        
        this.prices.set(tokenName, {
          token: tokenName,
          address: tokenAddress,
          priceUSD: data.price || 0,
          change24h: data.change24h || 0,
          volume24h: data.volume24h || 0,
          lastUpdate: new Date(),
        });
      }
    } catch (error) {
      // Silent fail - will try again next cycle
    }
  }

  private async calculateArbitrageRoutes() {
    this.routes = [];
    const tokenNames = Array.from(this.prices.keys());

    for (let i = 0; i < tokenNames.length; i++) {
      for (let j = i + 1; j < tokenNames.length; j++) {
        const tokenA = tokenNames[i];
        const tokenB = tokenNames[j];
        
        const priceA = this.prices.get(tokenA);
        const priceB = this.prices.get(tokenB);
        
        if (!priceA || !priceB) continue;

        // Simulate checking both directions
        const route = await this.checkRoute(tokenA, tokenB, priceA, priceB);
        if (route) {
          this.routes.push(route);
        }
      }
    }

    // Sort by spread (most profitable first)
    this.routes.sort((a, b) => b.spread - a.spread);
  }

  private async checkRoute(
    tokenA: string,
    tokenB: string,
    priceA: PriceData,
    priceB: PriceData
  ): Promise<ArbitrageRoute | null> {
    try {
      const addressA = priceA.address;
      const addressB = priceB.address;

      // Use 1000 USDC worth as test amount
      const amount = tokenA === 'USDC' ? 1000000000 : // 1000 USDC (6 decimals)
                     tokenB === 'USDC' ? 1000000000 :
                     tokenA === 'SOL' ? Math.floor(1000 / priceA.priceUSD * 1e9) :
                     Math.floor(1000 / priceA.priceUSD * 1e9); // Assume 9 decimals

      // Get quote from Jupiter
      const jupiterUrl = process.env.JUPITER_API_URL || 'https://public.jupiterapi.com';
      let quoteUrl: string;
      if (jupiterUrl.includes('quote-api')) {
        quoteUrl = `${jupiterUrl}/v6/quote?inputMint=${addressA}&outputMint=${addressB}&amount=${amount}&slippageBps=50`;
      } else {
        quoteUrl = `${jupiterUrl}/quote?inputMint=${addressA}&outputMint=${addressB}&amount=${amount}&slippageBps=50`;
      }
      
      const response = await axios.get(quoteUrl, { timeout: 3000 });

      if (response.data?.outAmount) {
        const inputAmount = amount / 1e9; // Normalize to readable units
        const outputAmount = parseInt(response.data.outAmount) / 1e9;
        
        // Calculate effective price
        const effectivePrice = outputAmount / inputAmount;
        const theoreticalPrice = priceB.priceUSD / priceA.priceUSD;
        const spread = ((effectivePrice - theoreticalPrice) / theoreticalPrice) * 100;

        return {
          from: tokenA,
          to: tokenB,
          buyPrice: 1 / effectivePrice,
          sellPrice: effectivePrice,
          spread: spread,
          profitable: spread > 0.2, // 0.2% threshold
        };
      }
    } catch (error) {
      // Silent fail
    }

    return null;
  }

  private renderDashboard() {
    console.clear();
    
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;

    // Header
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    🚀 SOLANA ARBITRAGE BOT - LIVE FEED                    ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log(`📊 Updates: ${this.updateCount} | ⏱️  Uptime: ${minutes}m ${seconds}s | 🔄 Refresh: 5s\n`);

    // Price Table
    console.log('┌─────────────────────────────── LIVE PRICES ───────────────────────────────┐');
    console.log('│ Token      Price (USD)      24h Change      24h Volume      Last Update   │');
    console.log('├───────────────────────────────────────────────────────────────────────────┤');

    this.prices.forEach((data) => {
      const price = data.priceUSD.toFixed(data.priceUSD < 0.01 ? 8 : 4);
      const change = data.change24h.toFixed(2);
      const changeColor = data.change24h >= 0 ? '🟢' : '🔴';
      const volume = this.formatVolume(data.volume24h);
      const timeAgo = this.getTimeAgo(data.lastUpdate);
      
      console.log(
        `│ ${this.padRight(data.token, 8)} ` +
        `$${this.padLeft(price, 12)} ` +
        `${changeColor} ${this.padLeft(change + '%', 10)} ` +
        `$${this.padLeft(volume, 10)} ` +
        `${this.padLeft(timeAgo, 10)} │`
      );
    });

    console.log('└───────────────────────────────────────────────────────────────────────────┘\n');

    // Arbitrage Opportunities
    console.log('┌────────────────────────── ARBITRAGE OPPORTUNITIES ────────────────────────┐');
    console.log('│ Route           Buy Price       Sell Price      Spread      Status        │');
    console.log('├───────────────────────────────────────────────────────────────────────────┤');

    if (this.routes.length === 0) {
      console.log('│                        No opportunities detected                          │');
    } else {
      const topRoutes = this.routes.slice(0, 10); // Show top 10
      topRoutes.forEach((route) => {
        const routeName = `${route.from}→${route.to}`;
        const buyPrice = route.buyPrice.toFixed(6);
        const sellPrice = route.sellPrice.toFixed(6);
        const spread = route.spread.toFixed(3) + '%';
        const status = route.profitable ? '✅ PROFIT' : '❌ NO PROFIT';
        const statusColor = route.profitable ? '\x1b[32m' : '\x1b[31m';
        const resetColor = '\x1b[0m';
        
        console.log(
          `│ ${this.padRight(routeName, 13)} ` +
          `${this.padLeft(buyPrice, 13)} ` +
          `${this.padLeft(sellPrice, 13)} ` +
          `${this.padLeft(spread, 9)} ` +
          `${statusColor}${this.padRight(status, 13)}${resetColor} │`
        );
      });
    }

    console.log('└───────────────────────────────────────────────────────────────────────────┘\n');

    // Statistics
    const profitableRoutes = this.routes.filter(r => r.profitable).length;
    const avgSpread = this.routes.length > 0 
      ? (this.routes.reduce((sum, r) => sum + r.spread, 0) / this.routes.length).toFixed(3)
      : '0.000';

    console.log('┌──────────────────────────────── STATISTICS ───────────────────────────────┐');
    console.log(`│ Total Routes: ${this.padLeft(this.routes.length.toString(), 3)} | ` +
                `Profitable: ${this.padLeft(profitableRoutes.toString(), 3)} | ` +
                `Avg Spread: ${this.padLeft(avgSpread + '%', 8)}               │`);
    console.log('└───────────────────────────────────────────────────────────────────────────┘\n');

    // Status Messages
    if (profitableRoutes > 0) {
      console.log('🎯 \x1b[32mProfitable opportunities detected! Bot should be executing trades.\x1b[0m');
    } else {
      console.log('⏳ \x1b[33mNo profitable opportunities at the moment. Waiting for price movements...\x1b[0m');
    }

    console.log('\n💡 Tip: This dashboard shows LIVE data. Your bot uses the same Jupiter API.');
    console.log('Press Ctrl+C to exit\n');
  }

  private formatVolume(volume: number): string {
    if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
    if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
    if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
    return volume.toFixed(2);
  }

  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  private padRight(str: string, length: number): string {
    return str.length >= length ? str.substring(0, length) : str + ' '.repeat(length - str.length);
  }

  private padLeft(str: string, length: number): string {
    return str.length >= length ? str.substring(0, length) : ' '.repeat(length - str.length) + str;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the dashboard
const dashboard = new LivePriceDashboard();
dashboard.start().catch(console.error);
