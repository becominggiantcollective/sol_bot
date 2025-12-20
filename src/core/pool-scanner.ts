import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

/**
 * NEW POOL SCANNER
 * 
 * Monitors for newly created pools on Solana DEXes where arbitrage 
 * opportunities are most likely to exist due to:
 * - Price inefficiency (new pools haven't been arbitraged yet)
 * - Low liquidity (easier to move price)
 * - Multiple pools for same token across DEXes
 * 
 * Data sources:
 * - GeckoTerminal API (new_pools, trending_pools)
 * - Jupiter API (token list with new tokens)
 */

export interface NewPool {
  name: string;
  address: string;
  dex: string;
  baseToken: string;
  quoteToken: string;
  volume24h: number;
  liquidity: number;
  createdAt: Date;
  priceChangePercent: number;
}

export interface TrendingToken {
  symbol: string;
  address: string;
  volume24h: number;
  priceChange24h: number;
  pools: string[];  // DEXes this token is on
}

export class PoolScanner {
  private readonly GECKO_API = 'https://api.geckoterminal.com/api/v2';
  private readonly MIN_LIQUIDITY = 5000;  // $5k minimum for safe trading
  private readonly MIN_VOLUME = 1000;     // $1k minimum 24h volume
  
  private cachedNewPools: NewPool[] = [];
  private lastFetch = 0;
  private readonly CACHE_TTL = 30000; // 30 second cache
  
  /**
   * Fetch newly created pools on Solana
   * These have the highest arbitrage potential due to price inefficiency
   */
  async getNewPools(): Promise<NewPool[]> {
    const now = Date.now();
    if (now - this.lastFetch < this.CACHE_TTL && this.cachedNewPools.length > 0) {
      return this.cachedNewPools;
    }
    
    try {
      const response = await axios.get(`${this.GECKO_API}/networks/solana/new_pools`, {
        params: { page: 1 },
        timeout: 10000,
      });
      
      const pools = response.data?.data || [];
      this.cachedNewPools = pools
        .map((p: any) => this.parsePool(p))
        .filter((pool: NewPool) => 
          pool.liquidity >= this.MIN_LIQUIDITY && 
          pool.volume24h >= this.MIN_VOLUME
        )
        .sort((a: NewPool, b: NewPool) => b.volume24h - a.volume24h);
      
      this.lastFetch = now;
      return this.cachedNewPools;
    } catch (error) {
      console.error('Error fetching new pools:', error);
      return this.cachedNewPools;
    }
  }
  
  /**
   * Fetch trending pools (high volume, active trading)
   * Good for finding tokens with arbitrage potential
   */
  async getTrendingPools(): Promise<NewPool[]> {
    try {
      const response = await axios.get(`${this.GECKO_API}/networks/solana/trending_pools`, {
        params: { page: 1 },
        timeout: 10000,
      });
      
      const pools = response.data?.data || [];
      return pools
        .map((p: any) => this.parsePool(p))
        .filter((pool: NewPool) => pool.liquidity >= this.MIN_LIQUIDITY)
        .slice(0, 20);
    } catch (error) {
      console.error('Error fetching trending pools:', error);
      return [];
    }
  }
  
  /**
   * Find tokens that exist on multiple DEXes
   * These are prime candidates for cross-DEX arbitrage
   */
  async findCrossDexTokens(): Promise<TrendingToken[]> {
    try {
      const [newPools, trendingPools] = await Promise.all([
        this.getNewPools(),
        this.getTrendingPools(),
      ]);
      
      const allPools = [...newPools, ...trendingPools];
      
      // Group pools by base token
      const tokenMap = new Map<string, { pools: NewPool[], dexes: Set<string> }>();
      
      for (const pool of allPools) {
        const existing = tokenMap.get(pool.baseToken) || { pools: [], dexes: new Set() };
        existing.pools.push(pool);
        existing.dexes.add(pool.dex);
        tokenMap.set(pool.baseToken, existing);
      }
      
      // Find tokens on multiple DEXes
      const crossDexTokens: TrendingToken[] = [];
      
      for (const [token, data] of tokenMap) {
        if (data.dexes.size >= 2) {
          const totalVolume = data.pools.reduce((sum, p) => sum + p.volume24h, 0);
          const avgPriceChange = data.pools.reduce((sum, p) => sum + p.priceChangePercent, 0) / data.pools.length;
          
          crossDexTokens.push({
            symbol: data.pools[0].name.split('/')[0],
            address: token,
            volume24h: totalVolume,
            priceChange24h: avgPriceChange,
            pools: Array.from(data.dexes),
          });
        }
      }
      
      return crossDexTokens.sort((a, b) => b.volume24h - a.volume24h);
    } catch (error) {
      console.error('Error finding cross-DEX tokens:', error);
      return [];
    }
  }
  
  /**
   * Get hot new meme coins with pump.fun migrations to Raydium
   * These often have arbitrage windows during migration
   */
  async getPumpFunMigrations(): Promise<NewPool[]> {
    try {
      const newPools = await this.getNewPools();
      
      // Look for tokens that:
      // 1. Started on pump.fun
      // 2. Now have Raydium/Meteora pools (graduated)
      // 3. High volume indicates active trading
      
      return newPools.filter(pool => 
        pool.dex !== 'pump-fun' && 
        pool.baseToken.endsWith('pump') &&  // pump.fun token addresses end in 'pump'
        pool.volume24h > 5000
      );
    } catch (error) {
      return [];
    }
  }
  
  private parsePool(p: any): NewPool {
    const attrs = p.attributes || {};
    const rels = p.relationships || {};
    
    return {
      name: attrs.name || 'Unknown',
      address: attrs.address || '',
      dex: rels.dex?.data?.id || 'unknown',
      baseToken: rels.base_token?.data?.id?.replace('solana_', '') || '',
      quoteToken: rels.quote_token?.data?.id?.replace('solana_', '') || '',
      volume24h: parseFloat(attrs.volume_usd?.h24 || '0'),
      liquidity: parseFloat(attrs.reserve_in_usd || '0'),
      createdAt: new Date(attrs.pool_created_at || Date.now()),
      priceChangePercent: parseFloat(attrs.price_change_percentage?.h24 || '0'),
    };
  }
  
  /**
   * Display pool info for monitoring
   */
  formatPoolInfo(pools: NewPool[]): string {
    if (pools.length === 0) return 'No pools found meeting criteria';
    
    const lines = ['=== Pool Scanner Results ===', ''];
    
    for (const pool of pools.slice(0, 10)) {
      lines.push(`${pool.name} (${pool.dex})`);
      lines.push(`  Token: ${pool.baseToken.slice(0, 12)}...`);
      lines.push(`  24h Vol: $${pool.volume24h.toLocaleString()} | Liq: $${pool.liquidity.toLocaleString()}`);
      lines.push(`  Price Δ: ${pool.priceChangePercent > 0 ? '+' : ''}${pool.priceChangePercent.toFixed(2)}%`);
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

// Export singleton for easy use
export const poolScanner = new PoolScanner();

// Quick test function
export async function scanForOpportunities(): Promise<void> {
  console.log('🔍 Scanning for new pool opportunities...\n');
  
  const scanner = new PoolScanner();
  
  // Get cross-DEX tokens (best arbitrage potential)
  const crossDex = await scanner.findCrossDexTokens();
  if (crossDex.length > 0) {
    console.log('🎯 CROSS-DEX TOKENS (Arbitrage Potential):');
    for (const token of crossDex.slice(0, 5)) {
      console.log(`  ${token.symbol}: on ${token.pools.join(', ')}`);
      console.log(`    24h Vol: $${token.volume24h.toLocaleString()}`);
    }
    console.log();
  }
  
  // Get pump.fun migrations
  const migrations = await scanner.getPumpFunMigrations();
  if (migrations.length > 0) {
    console.log('🚀 PUMP.FUN MIGRATIONS (Price Inefficiency):');
    console.log(scanner.formatPoolInfo(migrations));
  }
  
  // Get trending pools
  const trending = await scanner.getTrendingPools();
  if (trending.length > 0) {
    console.log('🔥 TRENDING POOLS:');
    console.log(scanner.formatPoolInfo(trending.slice(0, 5)));
  }
}
