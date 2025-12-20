#!/usr/bin/env node
/**
 * SNIPER BOT STRATEGY & SENTIMENT TEST
 * 
 * Shows our complete buy/sell strategy and tests if sentiment analysis works
 */

import axios from 'axios';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const SENTIMENT_URL = 'http://127.0.0.1:8000';

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║           📊 SNIPER BOT STRATEGY & SENTIMENT TEST 📊                    ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝');
console.log('');

// ═══════════════════════════════════════════════════════════════════════════
// OUR BUY/SELL STRATEGY
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('                         BUY STRATEGY');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('');
console.log('  📌 WHAT WE BUY:');
console.log('  ─────────────────────────────────────────────────────────────────────────');
console.log('  1. NEW TOKENS ONLY');
console.log('     • Must be < 5 minutes old (catches launch pumps)');
console.log('     • Preferably from pump.fun or pumpswap DEXes');
console.log('');
console.log('  2. POSITIVE MOMENTUM');
console.log('     • Price change must be >= +5% (going UP)');
console.log('     • Higher change = higher score');
console.log('');
console.log('  3. LIQUIDITY SWEET SPOT');
console.log('     • Minimum: $1,000 (avoid micro-caps)');
console.log('     • Maximum: $100,000 (avoid established tokens)');
console.log('     • Sweet spot: $5,000 - $50,000');
console.log('');
console.log('  4. SCORE >= 70/100');
console.log('     • Combined score from age, momentum, liquidity, DEX');
console.log('     • Sentiment boost can add +20 points');
console.log('');

console.log('  📊 SCORING BREAKDOWN:');
console.log('  ─────────────────────────────────────────────────────────────────────────');
console.log('  Base Score:                    50 points');
console.log('  ');
console.log('  AGE BONUSES:');
console.log('    < 5 minutes old:            +25 points  🔥');
console.log('    < 15 minutes old:           +15 points');
console.log('    < 30 minutes old:           +5 points');
console.log('    > 1 hour old:               -15 points');
console.log('  ');
console.log('  MOMENTUM BONUSES:');
console.log('    Price change > 200%:        +20 points  🚀');
console.log('    Price change > 100%:        +15 points');
console.log('    Price change > 50%:         +10 points');
console.log('    Price change > 20%:         +5 points');
console.log('    Price change < -20%:        -10 points');
console.log('  ');
console.log('  ACTIVITY BONUSES:');
console.log('    Volume/Liquidity > 2x:      +10 points');
console.log('    Volume/Liquidity > 0.5x:    +5 points');
console.log('  ');
console.log('  LIQUIDITY BONUSES:');
console.log('    $5k - $50k liquidity:       +10 points');
console.log('    > $100k liquidity:          -5 points');
console.log('  ');
console.log('  DEX BONUSES:');
console.log('    pump.fun / pumpswap:        +10 points');
console.log('    Raydium / Meteora:          +5 points');
console.log('  ');
console.log('  SENTIMENT BONUSES (if service running):');
console.log('    Very positive (>0.6):       +20 points  💚');
console.log('    Positive (>0.25):           +10 points');
console.log('    Negative (<-0.5):           -15 points  ❌');
console.log('');

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('                         SELL STRATEGY');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('');
console.log('  📌 WHEN WE SELL:');
console.log('  ─────────────────────────────────────────────────────────────────────────');
console.log('');
console.log('  🎉 TAKE PROFIT:  +30%');
console.log('     → Automatically sells when profit reaches +30%');
console.log('     → Example: Buy at $0.001, sell at $0.0013');
console.log('');
console.log('  🛑 STOP LOSS:    -30%');
console.log('     → Automatically sells when loss reaches -30%');
console.log('     → Example: Buy at $0.001, sell at $0.0007');
console.log('');
console.log('  ⚠️  RUG PROTECTION:');
console.log('     → If no sell route available (liquidity pulled)');
console.log('     → Token is marked as RUGGED');
console.log('     → Cannot be sold - loss is locked in');
console.log('');
console.log('  📊 POSITION LIMITS:');
console.log('     → Max 3 positions at once');
console.log('     → Trade size: 0.005 SOL (~$0.64) each');
console.log('     → Checks positions every 15 seconds');
console.log('');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SENTIMENT SERVICE
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('                    SENTIMENT SERVICE TEST');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('');

async function testSentiment() {
  console.log('  🔍 Checking if sentiment service is running...');
  console.log('');
  
  try {
    // Check health
    const health = await axios.get(`${SENTIMENT_URL}/health`, { timeout: 5000 });
    console.log('  ✅ Sentiment service is RUNNING!');
    console.log(`     Status: ${health.data?.status}`);
    console.log(`     Model: ${health.data?.model || 'twitter-roberta-base-sentiment'}`);
    console.log('');
    
    // Test with sample messages about meme coins
    const testMessages = [
      { id: '1', text: 'This new token is pumping hard! 🚀 To the moon!', source: 'test' },
      { id: '2', text: 'SCAM! Developer is going to rug this coin!', source: 'test' },
      { id: '3', text: 'Just launched, seems like a normal project', source: 'test' },
      { id: '4', text: 'Buying the dip! This is going to 10x easy', source: 'test' },
      { id: '5', text: 'This token is dead, liquidity pulled', source: 'test' },
    ];
    
    console.log('  📝 Testing sentiment analysis with sample messages:');
    console.log('  ─────────────────────────────────────────────────────────────────────────');
    
    const response = await axios.post(`${SENTIMENT_URL}/analyze/messages`, {
      messages: testMessages
    }, { timeout: 30000 });
    
    const results = response.data?.results || [];
    
    for (const result of results) {
      const score = result.score?.toFixed(3) || 'N/A';
      let emoji = '⚪';
      let label = 'Neutral';
      
      if (result.score > 0.5) { emoji = '💚'; label = 'Very Positive'; }
      else if (result.score > 0.2) { emoji = '🟢'; label = 'Positive'; }
      else if (result.score < -0.5) { emoji = '🔴'; label = 'Very Negative'; }
      else if (result.score < -0.2) { emoji = '🟠'; label = 'Negative'; }
      
      console.log(`  ${emoji} Score: ${score.padStart(6)} | ${label.padEnd(14)} | "${result.text.slice(0, 45)}..."`);
    }
    
    console.log('');
    console.log('  ✅ Sentiment analysis is WORKING!');
    console.log('');
    
    // Show how it would affect scoring
    console.log('  📊 How sentiment affects token scoring:');
    console.log('  ─────────────────────────────────────────────────────────────────────────');
    console.log('');
    
    for (const result of results) {
      let bonus = 0;
      let effect = '';
      
      if (result.score >= 0.6) { bonus = 20; effect = '+20 points (Very Positive)'; }
      else if (result.score >= 0.25) { bonus = 10; effect = '+10 points (Positive)'; }
      else if (result.score <= -0.5) { bonus = -15; effect = '-15 points (Very Negative)'; }
      else { effect = '0 points (Neutral)'; }
      
      console.log(`  "${result.text.slice(0, 35)}..." → ${effect}`);
    }
    
    return true;
    
  } catch (err) {
    console.log('  ❌ Sentiment service is NOT running!');
    console.log(`     Error: ${err.message}`);
    console.log('');
    console.log('  📋 To start the sentiment service:');
    console.log('     cd ml/sentiment_service');
    console.log('     pip install -r requirements.txt');
    console.log('     python app.py');
    console.log('');
    console.log('  ⚠️  Without sentiment, the sniper will still work,');
    console.log('     but won\'t get the +/-20 point sentiment bonus.');
    console.log('');
    
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE TOKEN SCORING DEMO
// ═══════════════════════════════════════════════════════════════════════════

async function demoScoring() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('                    LIVE TOKEN SCORING DEMO');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Fetching real tokens and showing how they would be scored...');
  console.log('');
  
  try {
    const response = await axios.get(`${GECKO_API}/networks/solana/new_pools`, {
      params: { page: 1 },
      timeout: 10000,
    });
    
    const pools = response.data?.data || [];
    const tokens = [];
    
    for (const pool of pools.slice(0, 10)) {
      const attrs = pool.attributes || {};
      const rels = pool.relationships || {};
      
      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volume = parseFloat(attrs.volume_usd?.h24 || '0');
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
      
      if (liquidity < 500) continue;
      
      const token = {
        name: attrs.name?.split('/')[0] || 'Unknown',
        createdAt: new Date(attrs.pool_created_at || Date.now()),
        priceChange,
        volume,
        liquidity,
        dex: rels.dex?.data?.id || 'unknown',
      };
      
      // Calculate score
      let score = 50;
      let breakdown = [];
      
      const ageMinutes = (Date.now() - token.createdAt.getTime()) / 60000;
      if (ageMinutes < 5) { score += 25; breakdown.push('+25 (very new)'); }
      else if (ageMinutes < 15) { score += 15; breakdown.push('+15 (fresh)'); }
      else if (ageMinutes < 30) { score += 5; breakdown.push('+5 (recent)'); }
      else if (ageMinutes > 60) { score -= 15; breakdown.push('-15 (old)'); }
      
      if (priceChange > 200) { score += 20; breakdown.push('+20 (mooning)'); }
      else if (priceChange > 100) { score += 15; breakdown.push('+15 (pumping)'); }
      else if (priceChange > 50) { score += 10; breakdown.push('+10 (up 50%+)'); }
      else if (priceChange > 20) { score += 5; breakdown.push('+5 (up 20%+)'); }
      else if (priceChange < -20) { score -= 10; breakdown.push('-10 (dumping)'); }
      
      const turnover = volume / liquidity;
      if (turnover > 2) { score += 10; breakdown.push('+10 (high activity)'); }
      else if (turnover > 0.5) { score += 5; breakdown.push('+5 (active)'); }
      
      if (liquidity >= 5000 && liquidity <= 50000) { score += 10; breakdown.push('+10 (sweet liq)'); }
      else if (liquidity > 100000) { score -= 5; breakdown.push('-5 (too big)'); }
      
      if (token.dex === 'pump-fun' || token.dex === 'pumpswap') { score += 10; breakdown.push('+10 (pump.fun)'); }
      else if (token.dex === 'raydium' || token.dex === 'meteora-damm-v2') { score += 5; breakdown.push('+5 (good DEX)'); }
      
      score = Math.min(100, Math.max(0, score));
      
      const wouldBuy = score >= 70 && priceChange >= 5;
      const status = wouldBuy ? '🟢 BUY' : '⚪ SKIP';
      
      console.log(`  ${status} | ${token.name.slice(0, 12).padEnd(12)} | Score: ${score.toString().padStart(3)} | Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(0).padStart(5)}% | Liq: $${liquidity.toFixed(0).padStart(6)} | Age: ${ageMinutes.toFixed(0).padStart(3)}m`);
      console.log(`         └─ Breakdown: Base 50 ${breakdown.join(' ')}`);
      
      tokens.push({ ...token, score, wouldBuy });
    }
    
    const buyCount = tokens.filter(t => t.wouldBuy).length;
    console.log('');
    console.log(`  📊 Summary: ${buyCount} out of ${tokens.length} tokens would trigger a BUY`);
    
  } catch (err) {
    console.log(`  ❌ Error fetching tokens: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  await testSentiment();
  await demoScoring();
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Our sniper strategy:');
  console.log('  1. Find NEW tokens (< 5 min old) on pump.fun');
  console.log('  2. Only buy if going UP (+5% minimum)');
  console.log('  3. Score must be >= 70 (combines age, momentum, liquidity)');
  console.log('  4. Sentiment can boost score +20 points (if service running)');
  console.log('  5. Take profit at +30%, stop loss at -30%');
  console.log('');
  console.log('  ⚠️  RISKS:');
  console.log('  • Many tokens RUG (liquidity pulled, can\'t sell)');
  console.log('  • Even with sentiment, rugs are hard to detect');
  console.log('  • Small trade sizes ($0.64) minimize losses');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
