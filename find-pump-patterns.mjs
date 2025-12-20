#!/usr/bin/env node
/**
 * Analyze recent pump.fun / new token launches to find optimal entry points
 */

import fetch from 'node-fetch';

async function analyzePumpPatterns() {
  console.log('🔥 ANALYZING PUMP PATTERNS\n');
  
  try {
    // Get new pairs from DexScreener (Raydium primarily hosts new launches)
    const res = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana/latest');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const text = await res.text();
    if (!text.startsWith('{')) {
      console.log('Rate limited. Using known patterns...\n');
      showTypicalPatterns();
      return;
    }
    
    const data = JSON.parse(text);
    const pairs = data.pairs || [];
    
    console.log(`Found ${pairs.length} recent pairs\n`);
    
    // Filter for very new tokens
    const newTokens = pairs.filter(p => {
      const age = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / (1000 * 60) : 999;
      return age < 720; // Less than 12 hours
    });
    
    console.log(`${newTokens.length} tokens < 12h old\n`);
    
    // Analyze patterns
    const successful = [];
    const failed = [];
    
    newTokens.forEach(p => {
      const liq = parseFloat(p.liquidity?.usd || 0);
      const vol24h = parseFloat(p.volume?.h24 || 0);
      const vol5m = parseFloat(p.volume?.m5 || 0);
      const price1h = parseFloat(p.priceChange?.h1 || 0);
      const price24h = parseFloat(p.priceChange?.h24 || 0);
      const age = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / (1000 * 60) : 0;
      
      const token = {
        symbol: p.baseToken?.symbol,
        mint: p.baseToken?.address,
        liq,
        vol24h,
        vol5m,
        price1h,
        price24h,
        age: Math.floor(age),
        volLiqRatio: liq > 0 ? vol24h / liq : 0,
        dex: p.dexId,
      };
      
      // Consider "successful" if pumping > 30% in 24h
      if (price24h > 30 && liq > 1000) {
        successful.push(token);
      } else if (liq > 1000) {
        failed.push(token);
      }
    });
    
    console.log(`✅ SUCCESSFUL PUMPS (${successful.length}):\n`);
    successful.slice(0, 10).forEach((t, i) => {
      console.log(`${i+1}. ${t.symbol}`);
      console.log(`   Liquidity: $${t.liq.toLocaleString()}`);
      console.log(`   24h Volume: $${t.vol24h.toLocaleString()}`);
      console.log(`   5m Volume: $${t.vol5m.toLocaleString()}`);
      console.log(`   Price: 1h=${t.price1h > 0 ? '+' : ''}${t.price1h.toFixed(1)}% | 24h=${t.price24h > 0 ? '+' : ''}${t.price24h.toFixed(1)}%`);
      console.log(`   Age: ${t.age}m`);
      console.log(`   Vol/Liq: ${t.volLiqRatio.toFixed(2)}x`);
      console.log(`   DEX: ${t.dex}`);
      console.log('');
    });
    
    if (successful.length > 0) {
      const avgSuccessLiq = successful.reduce((sum, t) => sum + t.liq, 0) / successful.length;
      const avgSuccessVol = successful.reduce((sum, t) => sum + t.vol24h, 0) / successful.length;
      const avgSuccessRatio = successful.reduce((sum, t) => sum + t.volLiqRatio, 0) / successful.length;
      const minSuccessLiq = Math.min(...successful.map(t => t.liq));
      const minSuccessVol = Math.min(...successful.map(t => t.vol24h));
      
      console.log('\n=== SUCCESSFUL TOKEN PATTERNS ===');
      console.log(`Avg Liquidity: $${avgSuccessLiq.toLocaleString()}`);
      console.log(`Min Liquidity: $${minSuccessLiq.toLocaleString()}`);
      console.log(`Avg 24h Volume: $${avgSuccessVol.toLocaleString()}`);
      console.log(`Min 24h Volume: $${minSuccessVol.toLocaleString()}`);
      console.log(`Avg Vol/Liq Ratio: ${avgSuccessRatio.toFixed(2)}x`);
    }
    
    console.log(`\n❌ FAILED/FLAT TOKENS (${failed.length}):\n`);
    failed.slice(0, 5).forEach((t, i) => {
      console.log(`${i+1}. ${t.symbol} - Liq: $${t.liq.toLocaleString()}, 24h Change: ${t.price24h > 0 ? '+' : ''}${t.price24h.toFixed(1)}%`);
    });
    
    showTypicalPatterns();
    
  } catch (err) {
    console.error('Error:', err.message);
    showTypicalPatterns();
  }
}

function showTypicalPatterns() {
  console.log('\n\n=== TYPICAL PUMP.FUN / NEW TOKEN PATTERNS ===\n');
  
  console.log('🎯 EARLY ENTRY WINDOW (0-30 min after launch):');
  console.log('   • Liquidity: $1,500 - $5,000');
  console.log('   • Volume: Low initially, ramping up');
  console.log('   • Price: High volatility, can 10-100x');
  console.log('   • Risk: VERY HIGH - many rugs here');
  console.log('');
  
  console.log('📈 MOMENTUM PHASE (30min - 6h):');
  console.log('   • Liquidity: $3,000 - $15,000');
  console.log('   • 24h Volume: $5,000 - $100,000');
  console.log('   • Price Change: +50% to +500%');
  console.log('   • Vol/Liq Ratio: 2-10x (very active)');
  console.log('   • Best Entry: Catch this phase!');
  console.log('');
  
  console.log('🎢 ESTABLISHED HYPE (6h - 24h):');
  console.log('   • Liquidity: $8,000 - $50,000');
  console.log('   • 24h Volume: $20,000 - $500,000');
  console.log('   • Price: May still pump or consolidate');
  console.log('   • Risk: MEDIUM - can still rug');
  console.log('');
  
  console.log('💤 DEAD CAT (24h+):');
  console.log('   • Most pumps are done by 24h');
  console.log('   • Avoid unless strong fundamentals');
  console.log('');
  
  console.log('=== RECOMMENDED BOT SETTINGS FOR MOMENTUM TRADING ===\n');
  console.log('CONSERVATIVE (safer, fewer trades):');
  console.log('  MIN_LIQUIDITY: $5,000');
  console.log('  MIN_VOLUME_24H: $8,000');
  console.log('  MIN_VOL_LIQ_RATIO: 2.0');
  console.log('  MIN_TOKEN_AGE: 30 minutes');
  console.log('  MAX_TOKEN_AGE: 8 hours');
  console.log('  MIN_PRICE_CHANGE_1H: +20%');
  console.log('');
  
  console.log('AGGRESSIVE (more trades, higher risk):');
  console.log('  MIN_LIQUIDITY: $2,500');
  console.log('  MIN_VOLUME_24H: $3,000');
  console.log('  MIN_VOL_LIQ_RATIO: 1.5');
  console.log('  MIN_TOKEN_AGE: 10 minutes');
  console.log('  MAX_TOKEN_AGE: 12 hours');
  console.log('  MIN_PRICE_CHANGE_1H: +15%');
  console.log('');
  
  console.log('BALANCED (recommended):');
  console.log('  MIN_LIQUIDITY: $3,500');
  console.log('  MIN_VOLUME_24H: $5,000');
  console.log('  MIN_VOL_LIQ_RATIO: 1.8');
  console.log('  MIN_TOKEN_AGE: 20 minutes');
  console.log('  MAX_TOKEN_AGE: 10 hours');
  console.log('  MIN_PRICE_CHANGE_1H: +18%');
  console.log('');
  
  console.log('=== EXIT STRATEGY ===');
  console.log('MOMENTUM RIDING:');
  console.log('  • Take 30% profit at 1.5x');
  console.log('  • Take 30% profit at 2x');
  console.log('  • Let 40% ride with 20% trailing stop');
  console.log('  • Hard exit at -12% stop loss');
  console.log('  • Auto-exit after 45 minutes if < 1.2x');
  console.log('  • Monitor 5m volume - exit if drops 60%');
  console.log('');
  
  console.log('SAFETY CHECKS (ALWAYS):');
  console.log('  ✅ Pre-buy sell simulation (Jupiter)');
  console.log('  ✅ No freeze authority');
  console.log('  ✅ No mint authority');
  console.log('  ✅ Liquidity locked/burned preferred');
  console.log('  ✅ Check top holder < 30%');
}

analyzePumpPatterns();
