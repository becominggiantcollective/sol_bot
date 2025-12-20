#!/usr/bin/env node
/**
 * MEME COIN SNIPER TEST
 * 
 * Simulates what the sniper bot would find RIGHT NOW
 * without executing any trades
 */

import axios from 'axios';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

console.log('');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('                    🎯 MEME COIN SNIPER TEST 🎯');
console.log('                    ' + new Date().toLocaleString());
console.log('═══════════════════════════════════════════════════════════════════════════');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Score a token (same logic as sniper.ts)
function scoreToken(token) {
  let score = 50;
  
  // Age bonus - newer is better
  const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
  if (ageMinutes < 5) score += 25;
  else if (ageMinutes < 15) score += 15;
  else if (ageMinutes < 30) score += 5;
  else if (ageMinutes < 60) score -= 5;
  else score -= 15;
  
  // Price movement
  if (token.priceChange > 200) score += 20;
  else if (token.priceChange > 100) score += 15;
  else if (token.priceChange > 50) score += 10;
  else if (token.priceChange > 20) score += 5;
  else if (token.priceChange < -20) score -= 10;
  
  // Volume/liquidity ratio (activity)
  const turnover = token.volume / token.liquidity;
  if (turnover > 2) score += 10;
  else if (turnover > 0.5) score += 5;
  
  // Liquidity sweet spot
  if (token.liquidity >= 5000 && token.liquidity <= 50000) score += 10;
  else if (token.liquidity > 100000) score -= 5;
  
  // DEX preference
  if (token.dex === 'raydium' || token.dex === 'meteora-damm-v2') score += 5;
  if (token.dex === 'pump-fun') score += 10;
  
  return Math.min(100, Math.max(0, score));
}

// Get price quote for a token
async function getQuote(tokenAddress, amountSol = 0.01) {
  try {
    const amountLamports = Math.floor(amountSol * 1e9);
    const response = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint: SOL_MINT,
        outputMint: tokenAddress,
        amount: amountLamports,
        slippageBps: 1500,
      },
      headers: { 'x-api-key': JUPITER_API_KEY },
      timeout: 10000,
    });
    
    if (response.data?.outAmount) {
      return {
        outAmount: parseInt(response.data.outAmount),
        priceImpact: parseFloat(response.data.priceImpactPct || '0'),
        routeInfo: response.data.routePlan?.length || 0,
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Scan for new tokens
async function scanNewTokens() {
  console.log('\n  📡 SCANNING FOR NEW TOKENS...\n');
  
  try {
    // Get new pools from GeckoTerminal
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
      
      // Skip very low liquidity (rug risk too high)
      if (liquidity < 500) continue;
      
      const tokenAddress = rels.base_token?.data?.id?.replace('solana_', '') || '';
      if (!tokenAddress) continue;
      
      tokens.push({
        address: tokenAddress,
        name: attrs.name?.split('/')[0] || 'Unknown',
        symbol: attrs.name?.split('/')[0]?.slice(0, 10) || '?',
        createdAt: attrs.pool_created_at || new Date().toISOString(),
        currentPrice: parseFloat(attrs.base_token_price_usd || '0'),
        priceChange,
        volume,
        liquidity,
        dex: rels.dex?.data?.id || 'unknown',
        poolAddress: pool.id?.replace('solana_', '') || '',
      });
    }
    
    return tokens;
  } catch (error) {
    console.error('Error scanning tokens:', error.message);
    return [];
  }
}

// Main analysis
async function runAnalysis() {
  // 1. Scan for new tokens
  const tokens = await scanNewTokens();
  
  if (tokens.length === 0) {
    console.log('  ❌ No new tokens found!');
    return;
  }
  
  console.log(`  Found ${tokens.length} new pools in last 24h\n`);
  
  // 2. Score all tokens
  const scored = tokens.map(t => ({
    ...t,
    score: scoreToken(t),
    ageMinutes: (Date.now() - new Date(t.createdAt).getTime()) / 60000,
  }));
  
  // Sort by score
  scored.sort((a, b) => b.score - a.score);
  
  // 3. Display results
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  console.log('  TOP SNIPER CANDIDATES (Score >= 50 = Would Buy)');
  console.log('  ─────────────────────────────────────────────────────────────────────────\n');
  
  let wouldBuyCount = 0;
  
  for (let i = 0; i < Math.min(15, scored.length); i++) {
    const t = scored[i];
    const wouldBuy = t.score >= 50;
    if (wouldBuy) wouldBuyCount++;
    
    const ageStr = t.ageMinutes < 60 
      ? `${t.ageMinutes.toFixed(0)}m` 
      : `${(t.ageMinutes / 60).toFixed(1)}h`;
    
    const priceChangeStr = t.priceChange >= 0 
      ? `+${t.priceChange.toFixed(0)}%` 
      : `${t.priceChange.toFixed(0)}%`;
    
    const status = wouldBuy ? '🟢 BUY' : '⚪ SKIP';
    
    console.log(`  ${status} | ${t.symbol.padEnd(12)} | Score: ${t.score.toString().padStart(3)} | Age: ${ageStr.padStart(5)} | Change: ${priceChangeStr.padStart(7)} | Liq: $${t.liquidity.toFixed(0).padStart(7)} | DEX: ${t.dex}`);
    
    // If it's a buy candidate, check if we can actually trade it
    if (wouldBuy) {
      const quote = await getQuote(t.address, 0.01);
      if (quote) {
        console.log(`        └─ Quote OK: ${quote.outAmount.toLocaleString()} tokens for 0.01 SOL, Impact: ${quote.priceImpact.toFixed(2)}%`);
      } else {
        console.log(`        └─ ⚠️ No Jupiter route available!`);
      }
      await sleep(200);
    }
  }
  
  // 4. Summary
  console.log('\n  ─────────────────────────────────────────────────────────────────────────');
  console.log('  SUMMARY');
  console.log('  ─────────────────────────────────────────────────────────────────────────\n');
  
  console.log(`  Total new pools found:      ${tokens.length}`);
  console.log(`  Would buy (score >= 50):    ${wouldBuyCount}`);
  console.log(`  Average score:              ${(scored.reduce((a, b) => a + b.score, 0) / scored.length).toFixed(0)}`);
  
  // Age distribution
  const under5m = scored.filter(t => t.ageMinutes < 5).length;
  const under30m = scored.filter(t => t.ageMinutes < 30).length;
  const under1h = scored.filter(t => t.ageMinutes < 60).length;
  
  console.log(`\n  Age distribution:`);
  console.log(`    < 5 min:   ${under5m} tokens (🔥 best)`);
  console.log(`    < 30 min:  ${under30m} tokens`);
  console.log(`    < 1 hour:  ${under1h} tokens`);
  
  // Price movement distribution
  const pumping = scored.filter(t => t.priceChange > 50).length;
  const dumping = scored.filter(t => t.priceChange < -30).length;
  
  console.log(`\n  Price movement:`);
  console.log(`    Pumping (>50%):   ${pumping} tokens 🚀`);
  console.log(`    Dumping (<-30%):  ${dumping} tokens 📉`);
  
  // Best opportunity
  const best = scored[0];
  console.log(`\n  🎯 BEST OPPORTUNITY RIGHT NOW:`);
  console.log(`     Token:  ${best.name} (${best.symbol})`);
  console.log(`     Score:  ${best.score}/100`);
  console.log(`     Age:    ${best.ageMinutes < 60 ? best.ageMinutes.toFixed(0) + ' min' : (best.ageMinutes/60).toFixed(1) + ' hours'}`);
  console.log(`     Change: ${best.priceChange > 0 ? '+' : ''}${best.priceChange.toFixed(1)}%`);
  console.log(`     Liquidity: $${best.liquidity.toLocaleString()}`);
  console.log(`     DEX: ${best.dex}`);
  console.log(`     Address: ${best.address}`);
  
  // 5. Pump.fun specific check
  console.log('\n  ─────────────────────────────────────────────────────────────────────────');
  console.log('  PUMP.FUN SPECIFIC CHECK');
  console.log('  ─────────────────────────────────────────────────────────────────────────\n');
  
  try {
    const pumpResponse = await axios.get(`${GECKO_API}/networks/solana/dexes/pump-fun/pools`, {
      params: { page: 1 },
      timeout: 10000,
    });
    
    const pumpPools = pumpResponse.data?.data || [];
    console.log(`  pump.fun pools found: ${pumpPools.length}`);
    
    const recentPump = pumpPools.filter(p => {
      const createdAt = new Date(p.attributes?.pool_created_at || 0);
      return (Date.now() - createdAt.getTime()) < 3600000; // Last hour
    });
    
    console.log(`  Created in last hour: ${recentPump.length}`);
    
    if (recentPump.length > 0) {
      console.log('\n  Recent pump.fun launches:');
      for (const p of recentPump.slice(0, 5)) {
        const attrs = p.attributes || {};
        const name = attrs.name?.split('/')[0] || '?';
        const change = parseFloat(attrs.price_change_percentage?.h24 || '0');
        const liq = parseFloat(attrs.reserve_in_usd || '0');
        const age = (Date.now() - new Date(attrs.pool_created_at).getTime()) / 60000;
        console.log(`    • ${name.padEnd(15)} | Age: ${age.toFixed(0).padStart(3)}m | Change: ${change > 0 ? '+' : ''}${change.toFixed(0).padStart(5)}% | Liq: $${liq.toFixed(0)}`);
      }
    }
  } catch (err) {
    console.log('  ⚠️ Could not fetch pump.fun data');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('  CONCLUSION:');
  if (wouldBuyCount > 0) {
    console.log(`  ✅ ${wouldBuyCount} opportunities found that meet sniper criteria`);
    console.log('  ⚠️  Remember: Meme coins are HIGH RISK - rugs/dumps happen fast!');
  } else {
    console.log('  ⏳ No strong opportunities right now - market is quiet');
    console.log('  💡 Best times: New launches, high volatility periods');
  }
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

runAnalysis().catch(console.error);
