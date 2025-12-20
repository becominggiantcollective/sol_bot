#!/usr/bin/env npx ts-node
/**
 * Pool Scanner CLI
 * Run: npx ts-node scan-pools.ts
 */

import axios from 'axios';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';

interface Pool {
  name: string;
  dex: string;
  token: string;
  volume: number;
  liquidity: number;
  priceChange: number;
}

async function fetchNewPools(): Promise<Pool[]> {
  try {
    const res = await axios.get(`${GECKO_API}/networks/solana/new_pools`, {
      params: { page: 1 },
      timeout: 15000,
    });
    
    return (res.data?.data || []).map((p: any) => ({
      name: p.attributes?.name || '?',
      dex: p.relationships?.dex?.data?.id || '?',
      token: p.relationships?.base_token?.data?.id?.replace('solana_', '') || '',
      volume: parseFloat(p.attributes?.volume_usd?.h24 || '0'),
      liquidity: parseFloat(p.attributes?.reserve_in_usd || '0'),
      priceChange: parseFloat(p.attributes?.price_change_percentage?.h24 || '0'),
    }));
  } catch (e) {
    console.error('Error fetching new pools:', e);
    return [];
  }
}

async function fetchTrendingPools(): Promise<Pool[]> {
  try {
    const res = await axios.get(`${GECKO_API}/networks/solana/trending_pools`, {
      params: { page: 1 },
      timeout: 15000,
    });
    
    return (res.data?.data || []).map((p: any) => ({
      name: p.attributes?.name || '?',
      dex: p.relationships?.dex?.data?.id || '?',
      token: p.relationships?.base_token?.data?.id?.replace('solana_', '') || '',
      volume: parseFloat(p.attributes?.volume_usd?.h24 || '0'),
      liquidity: parseFloat(p.attributes?.reserve_in_usd || '0'),
      priceChange: parseFloat(p.attributes?.price_change_percentage?.h24 || '0'),
    }));
  } catch (e) {
    console.error('Error fetching trending pools:', e);
    return [];
  }
}

function formatUSD(n: number): string {
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function main() {
  console.log('🔍 Scanning Solana pools...\n');
  
  const [newPools, trendingPools] = await Promise.all([
    fetchNewPools(),
    fetchTrendingPools(),
  ]);
  
  // Filter for tradeable pools (>$5k liquidity)
  const tradeable = [...newPools, ...trendingPools]
    .filter(p => p.liquidity >= 5000)
    .sort((a, b) => b.volume - a.volume);
  
  console.log('=' .repeat(80));
  console.log('🆕 NEW POOLS WITH DECENT LIQUIDITY (>$5k)');
  console.log('=' .repeat(80));
  
  const uniqueNew = new Map<string, Pool>();
  for (const p of newPools.filter(p => p.liquidity >= 5000)) {
    if (!uniqueNew.has(p.token)) uniqueNew.set(p.token, p);
  }
  
  console.log(`${'Name'.padEnd(30)} ${'DEX'.padEnd(18)} ${'24h Vol'.padStart(12)} ${'Liquidity'.padStart(12)} ${'Δ%'.padStart(8)}`);
  console.log('-'.repeat(80));
  
  for (const [_, p] of [...uniqueNew].slice(0, 10)) {
    console.log(
      `${p.name.slice(0, 30).padEnd(30)} ` +
      `${p.dex.slice(0, 18).padEnd(18)} ` +
      `${formatUSD(p.volume).padStart(12)} ` +
      `${formatUSD(p.liquidity).padStart(12)} ` +
      `${(p.priceChange > 0 ? '+' : '') + p.priceChange.toFixed(1) + '%'.padStart(8)}`
    );
    console.log(`  └─ ${p.token}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔥 TRENDING POOLS (Highest Volume)');
  console.log('='.repeat(80));
  
  const uniqueTrending = new Map<string, Pool>();
  for (const p of trendingPools.filter(p => p.liquidity >= 10000)) {
    if (!uniqueTrending.has(p.token)) uniqueTrending.set(p.token, p);
  }
  
  console.log(`${'Name'.padEnd(30)} ${'DEX'.padEnd(18)} ${'24h Vol'.padStart(12)} ${'Liquidity'.padStart(12)} ${'Δ%'.padStart(8)}`);
  console.log('-'.repeat(80));
  
  for (const [_, p] of [...uniqueTrending].slice(0, 15)) {
    console.log(
      `${p.name.slice(0, 30).padEnd(30)} ` +
      `${p.dex.slice(0, 18).padEnd(18)} ` +
      `${formatUSD(p.volume).padStart(12)} ` +
      `${formatUSD(p.liquidity).padStart(12)} ` +
      `${(p.priceChange > 0 ? '+' : '') + p.priceChange.toFixed(1) + '%'.padStart(8)}`
    );
  }
  
  // Find cross-DEX opportunities
  console.log('\n' + '='.repeat(80));
  console.log('🎯 CROSS-DEX ARBITRAGE CANDIDATES');
  console.log('='.repeat(80));
  
  const allPools = [...newPools, ...trendingPools];
  const tokenDexMap = new Map<string, Set<string>>();
  
  for (const p of allPools) {
    if (p.liquidity < 5000) continue;
    const existing = tokenDexMap.get(p.token) || new Set();
    existing.add(p.dex);
    tokenDexMap.set(p.token, existing);
  }
  
  const crossDex = [...tokenDexMap]
    .filter(([_, dexes]) => dexes.size >= 2)
    .map(([token, dexes]) => {
      const pools = allPools.filter(p => p.token === token);
      return {
        token,
        name: pools[0]?.name.split('/')[0] || token.slice(0, 8),
        dexes: [...dexes],
        totalVolume: pools.reduce((s, p) => s + p.volume, 0),
        avgLiquidity: pools.reduce((s, p) => s + p.liquidity, 0) / pools.length,
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);
  
  if (crossDex.length > 0) {
    for (const t of crossDex.slice(0, 10)) {
      console.log(`${t.name}: on ${t.dexes.join(', ')}`);
      console.log(`  Total Vol: ${formatUSD(t.totalVolume)} | Avg Liq: ${formatUSD(t.avgLiquidity)}`);
      console.log(`  Token: ${t.token.slice(0, 20)}...`);
      console.log();
    }
  } else {
    console.log('No cross-DEX tokens found with sufficient liquidity');
  }
  
  console.log('\n💡 TIP: Cross-DEX tokens have the best arbitrage potential!');
  console.log('   Add these to your token list for monitoring.');
}

main().catch(console.error);
