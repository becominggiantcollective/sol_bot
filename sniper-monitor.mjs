#!/usr/bin/env node
/**
 * LIVE SNIPER MONITOR
 * 
 * Watches for new tokens and shows what the sniper would do
 * Can execute trades if LIVE_MODE=true
 */

import axios from 'axios';
import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// CONFIG
const LIVE_MODE = false; // Set to true to execute real trades
const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const RPC_URL = process.env.HELIUS_RPC_URL;

// WALLET (only used if LIVE_MODE)
const WALLET_PRIVATE_KEY = '4F6kxQH1rDhqrFXY2JNmYzZNJE2MLJWRyNoYCYVBMgfVmCVHtGXThHJHtGdLJT6vWdrkQvSC1oPjCkPVXJBCjYFk';

// Watchlist - specific tokens to monitor
const WATCHLIST = [
  { name: 'HOUSEMAID', address: 'FnCWC6TQKxYEJCyFXnD568so7VezR4yizVyxiQdthqiU' },
  { name: 'DickButtMa', address: '4c6NsjaJSf7H5HcDYzC8ErDaG8m2gm8tbUR7Tz4qNwQG' },
  { name: '67', address: '9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump' },
];

// Track prices
const priceHistory = new Map();
const seenTokens = new Set();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║                    🎯 LIVE SNIPER MONITOR 🎯                             ║');
console.log('║                                                                          ║');
console.log(`║  Mode: ${LIVE_MODE ? '🔴 LIVE TRADING' : '👀 MONITOR ONLY'}                                         ║`);
console.log('║  Watching for: New tokens + Watchlist                                    ║');
console.log('║  Press Ctrl+C to stop                                                    ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Score a token
function scoreToken(token) {
  let score = 50;
  
  const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
  if (ageMinutes < 5) score += 25;
  else if (ageMinutes < 15) score += 15;
  else if (ageMinutes < 30) score += 5;
  else if (ageMinutes < 60) score -= 5;
  else score -= 15;
  
  if (token.priceChange > 200) score += 20;
  else if (token.priceChange > 100) score += 15;
  else if (token.priceChange > 50) score += 10;
  else if (token.priceChange > 20) score += 5;
  else if (token.priceChange < -20) score -= 10;
  
  const turnover = token.volume / token.liquidity;
  if (turnover > 2) score += 10;
  else if (turnover > 0.5) score += 5;
  
  if (token.liquidity >= 5000 && token.liquidity <= 50000) score += 10;
  else if (token.liquidity > 100000) score -= 5;
  
  if (token.dex === 'raydium' || token.dex === 'meteora-damm-v2') score += 5;
  if (token.dex === 'pump-fun' || token.dex === 'pumpswap') score += 10;
  
  return Math.min(100, Math.max(0, score));
}

// Get token price
async function getTokenPrice(address) {
  try {
    const response = await axios.get(`${GECKO_API}/networks/solana/tokens/${address}`, {
      timeout: 5000,
    });
    return {
      price: parseFloat(response.data?.data?.attributes?.price_usd || '0'),
      change24h: parseFloat(response.data?.data?.attributes?.price_change_percentage?.h24 || '0'),
      volume: parseFloat(response.data?.data?.attributes?.volume_usd?.h24 || '0'),
    };
  } catch (err) {
    return null;
  }
}

// Scan for new tokens
async function scanNewTokens() {
  try {
    const response = await axios.get(`${GECKO_API}/networks/solana/new_pools`, {
      params: { page: 1 },
      timeout: 10000,
    });
    
    const pools = response.data?.data || [];
    const tokens = [];
    
    for (const pool of pools) {
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
      
      if (liquidity < 500) continue;
      
      const tokenAddress = rels.base_token?.data?.id?.replace('solana_', '') || '';
      if (!tokenAddress) continue;
      
      tokens.push({
        address: tokenAddress,
        name: attrs.name?.split('/')[0] || 'Unknown',
        symbol: attrs.name?.split('/')[0]?.slice(0, 12) || '?',
        createdAt: attrs.pool_created_at || new Date().toISOString(),
        currentPrice: parseFloat(attrs.base_token_price_usd || '0'),
        priceChange,
        volume,
        liquidity,
        dex: rels.dex?.data?.id || 'unknown',
      });
    }
    
    return tokens;
  } catch (error) {
    return [];
  }
}

// Monitor watchlist
async function checkWatchlist() {
  console.log('\n  📋 WATCHLIST STATUS:');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  for (const token of WATCHLIST) {
    const info = await getTokenPrice(token.address);
    if (!info) {
      console.log(`  ⚠️  ${token.name.padEnd(12)} - Failed to fetch`);
      continue;
    }
    
    // Track price history
    const prevPrice = priceHistory.get(token.address);
    priceHistory.set(token.address, info.price);
    
    let changeStr = '';
    if (prevPrice) {
      const pctChange = ((info.price - prevPrice) / prevPrice) * 100;
      if (pctChange > 0.5) changeStr = ` 📈 +${pctChange.toFixed(2)}% since last check`;
      else if (pctChange < -0.5) changeStr = ` 📉 ${pctChange.toFixed(2)}% since last check`;
    }
    
    const priceStr = info.price < 0.0001 ? info.price.toExponential(4) : info.price.toFixed(6);
    const change24Str = info.change24h > 0 ? `+${info.change24h.toFixed(1)}%` : `${info.change24h.toFixed(1)}%`;
    
    console.log(`  ${token.name.padEnd(12)} | $${priceStr.padEnd(14)} | 24h: ${change24Str.padEnd(8)} | Vol: $${info.volume.toLocaleString()}${changeStr}`);
    
    await new Promise(r => setTimeout(r, 200));
  }
}

// Main monitor loop
async function monitor() {
  let iteration = 0;
  
  while (true) {
    iteration++;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`\n═══════════════════════════════════════════════════════════════════════════`);
    console.log(`  SCAN #${iteration} @ ${timestamp}`);
    console.log(`═══════════════════════════════════════════════════════════════════════════`);
    
    // 1. Check watchlist
    await checkWatchlist();
    
    // 2. Scan for new tokens
    console.log('\n  🆕 NEW TOKEN SCAN:');
    console.log('  ─────────────────────────────────────────────────────────────────────────');
    
    const newTokens = await scanNewTokens();
    
    let newOpportunities = 0;
    for (const token of newTokens) {
      const isNew = !seenTokens.has(token.address);
      const score = scoreToken(token);
      
      if (isNew && score >= 50) {
        newOpportunities++;
        seenTokens.add(token.address);
        
        const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
        const ageStr = ageMinutes < 60 ? `${ageMinutes.toFixed(0)}m` : `${(ageMinutes/60).toFixed(1)}h`;
        const changeStr = token.priceChange > 0 ? `+${token.priceChange.toFixed(0)}%` : `${token.priceChange.toFixed(0)}%`;
        
        console.log(`\n  🚨 NEW OPPORTUNITY FOUND!`);
        console.log(`     Token:     ${token.name} (${token.symbol})`);
        console.log(`     Score:     ${score}/100 ${score >= 70 ? '🔥' : '✅'}`);
        console.log(`     Age:       ${ageStr}`);
        console.log(`     Change:    ${changeStr}`);
        console.log(`     Liquidity: $${token.liquidity.toLocaleString()}`);
        console.log(`     DEX:       ${token.dex}`);
        console.log(`     Address:   ${token.address}`);
        
        if (LIVE_MODE && score >= 70) {
          console.log(`     🔴 WOULD EXECUTE TRADE (LIVE MODE)`);
          // Add trade execution here
        } else {
          console.log(`     👀 Monitor mode - no trade executed`);
        }
      }
    }
    
    if (newOpportunities === 0) {
      const totalTokens = newTokens.length;
      const goodOnes = newTokens.filter(t => scoreToken(t) >= 50).length;
      console.log(`  📊 ${totalTokens} tokens found, ${goodOnes} meet criteria (all previously seen)`);
    }
    
    // 3. Show top movers from new tokens
    const scored = newTokens
      .map(t => ({ ...t, score: scoreToken(t) }))
      .sort((a, b) => b.priceChange - a.priceChange);
    
    const topMovers = scored.slice(0, 3);
    if (topMovers.length > 0) {
      console.log('\n  🚀 TOP MOVERS RIGHT NOW:');
      for (const t of topMovers) {
        const changeStr = t.priceChange > 0 ? `+${t.priceChange.toFixed(0)}%` : `${t.priceChange.toFixed(0)}%`;
        console.log(`     ${t.symbol.padEnd(12)} | ${changeStr.padEnd(8)} | Score: ${t.score} | $${t.liquidity.toFixed(0)} liq`);
      }
    }
    
    // Wait before next scan
    console.log(`\n  ⏳ Next scan in 30 seconds...`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

// Start monitoring
monitor().catch(console.error);
