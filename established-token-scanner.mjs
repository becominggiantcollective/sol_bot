#!/usr/bin/env node

/**
 * ESTABLISHED TOKEN SCANNER
 * 
 * Strategy: Instead of scanning new/trending tokens (90% honeypots),
 * focus on established tokens with:
 * - Age > 24 hours (survived initial pump/dump)
 * - Real liquidity > $10K (not fake)
 * - Verified on major DEXes (Raydium, Orca, Jupiter)
 * - Active trading volume (real users, not bots)
 */

import fetch from 'node-fetch';

const CONFIG = {
  MIN_AGE_HOURS: 24,
  MIN_LIQUIDITY: 10000,
  MIN_VOLUME_24H: 5000,
  MAX_TOKENS_TO_TEST: 20,
};

async function fetchEstablishedTokens() {
  console.log('🔍 Scanning for ESTABLISHED tokens (>24h old, >$10K liquidity)...\n');
  
  const tokens = [];
  
  try {
    // Get tokens from DexScreener with volume filter
    const response = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112'
    );
    
    const data = await response.json();
    
    if (data?.pairs) {
      console.log(`📊 Found ${data.pairs.length} SOL pairs on DexScreener\n`);
      
      for (const pair of data.pairs.slice(0, CONFIG.MAX_TOKENS_TO_TEST)) {
        const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 0;
        const liquidity = pair.liquidity?.usd || 0;
        const volume24h = pair.volume?.h24 || 0;
        
        if (
          age >= CONFIG.MIN_AGE_HOURS &&
          liquidity >= CONFIG.MIN_LIQUIDITY &&
          volume24h >= CONFIG.MIN_VOLUME_24H
        ) {
          tokens.push({
            mint: pair.baseToken.address,
            symbol: pair.baseToken.symbol,
            name: pair.baseToken.name,
            liquidity,
            volume24h,
            ageHours: Math.floor(age),
            dex: pair.dexId,
            priceUsd: parseFloat(pair.priceUsd || 0),
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Error fetching DexScreener:', error.message);
  }
  
  // Try Jupiter verified tokens
  try {
    const response = await fetch('https://token.jup.ag/strict');
    const data = await response.json();
    
    console.log(`📊 Found ${data.length} verified tokens on Jupiter\n`);
    
    // Sample a few for testing
    for (const token of data.slice(0, 10)) {
      if (!tokens.find(t => t.mint === token.address)) {
        tokens.push({
          mint: token.address,
          symbol: token.symbol,
          name: token.name,
          verified: true,
          source: 'Jupiter',
        });
      }
    }
  } catch (error) {
    console.error('❌ Error fetching Jupiter tokens:', error.message);
  }
  
  return tokens;
}

async function testWithRugShield(token) {
  console.log(`\n🛡️ Testing ${token.symbol} (${token.mint.slice(0, 8)}...)...`);
  console.log(`   Age: ${token.ageHours || 'unknown'}h | Liquidity: $${token.liquidity?.toLocaleString() || 'unknown'}`);
  
  try {
    // Test sell capability using Jupiter
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${token.mint}&outputMint=So11111111111111111111111111111111111111112&amount=1000000`;
    
    const response = await fetch(quoteUrl);
    const data = await response.json();
    
    if (data.error || !data.outAmount) {
      console.log(`   ❌ HONEYPOT - Cannot get sell quote`);
      return { passed: false, reason: 'honeypot' };
    }
    
    console.log(`   ✅ PASSES - Can sell (quote: ${data.outAmount} lamports)`);
    return { passed: true, token, sellQuote: data.outAmount };
    
  } catch (error) {
    console.log(`   ⚠️ Error testing: ${error.message}`);
    return { passed: false, reason: 'error' };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🏛️ ESTABLISHED TOKEN SCANNER');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const tokens = await fetchEstablishedTokens();
  
  console.log(`\n✅ Found ${tokens.length} established tokens\n`);
  console.log('────────────────────────────────────────────────────────────');
  console.log('TESTING WITH RUG SHIELD');
  console.log('────────────────────────────────────────────────────────────\n');
  
  const results = {
    total: 0,
    passed: 0,
    honeypots: 0,
    errors: 0,
    passedTokens: [],
  };
  
  for (const token of tokens.slice(0, CONFIG.MAX_TOKENS_TO_TEST)) {
    results.total++;
    
    const result = await testWithRugShield(token);
    
    if (result.passed) {
      results.passed++;
      results.passedTokens.push(result.token);
    } else if (result.reason === 'honeypot') {
      results.honeypots++;
    } else {
      results.errors++;
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('📊 RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log(`Total Tested:    ${results.total}`);
  console.log(`✅ Passed:       ${results.passed} (${((results.passed / results.total) * 100).toFixed(1)}%)`);
  console.log(`❌ Honeypots:    ${results.honeypots} (${((results.honeypots / results.total) * 100).toFixed(1)}%)`);
  console.log(`⚠️ Errors:       ${results.errors} (${((results.errors / results.total) * 100).toFixed(1)}%)`);
  
  if (results.passedTokens.length > 0) {
    console.log('\n\n✅ TRADEABLE TOKENS FOUND:');
    console.log('────────────────────────────────────────────────────────────\n');
    
    for (const token of results.passedTokens) {
      console.log(`${token.symbol.padEnd(10)} | ${token.mint.slice(0, 8)}... | $${token.liquidity?.toLocaleString() || 'N/A'} liq | ${token.ageHours || 'verified'}h old`);
    }
    
    console.log('\n💡 These tokens can be used with live-trader.mjs!');
  } else {
    console.log('\n\n⚠️ NO TRADEABLE TOKENS FOUND');
    console.log('   Even established tokens are honeypots on Solana');
    console.log('   This suggests the market is EXTREMELY risky right now');
  }
}

main().catch(console.error);
