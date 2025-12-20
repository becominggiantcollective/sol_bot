#!/usr/bin/env node
/**
 * Analyze specific tokens with ML scoring
 */

import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

// ML Predictor
function mlPredict(pair) {
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 24;
  const priceChange = pair.priceChange?.h1 || 0;
  const txns = pair.txns?.h1 || { buys: 0, sells: 0 };
  
  // Feature extraction
  const features = {
    liquidityScore: Math.min(1, liq / 100000),
    volumeScore: Math.min(1, vol / 50000),
    ageScore: age < 1 ? 0.9 : age < 6 ? 0.7 : age < 24 ? 0.5 : 0.3,
    priceStability: priceChange > 0 && priceChange < 50 ? 0.8 : 0.4,
    buyPressure: txns.buys > txns.sells ? 0.7 : 0.3,
    rugRisk: liq < 10000 ? 0.8 : liq < 30000 ? 0.5 : 0.2,
  };
  
  // Weighted score
  const weights = { liquidityScore: 0.2, volumeScore: 0.15, ageScore: 0.1, priceStability: 0.15, buyPressure: 0.1, rugRisk: -0.25 };
  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    score += (features[k] || 0) * w;
  }
  score = Math.max(0, Math.min(1, score + 0.5));
  
  return { score, features, recommendation: score > 0.65 ? 'BUY' : score > 0.45 ? 'HOLD' : 'SKIP' };
}

async function analyzeTokens() {
  const targets = [
    { name: '🎪 DiscoHamm (NEW!)', address: '52K5nyJueMm2kKRuAzQg53zu8GNJsoDxDHoL4FyQpump' },
    { name: '💫 Forever', address: '3mDAAQt1dpRqpHvs5QsaE6ocwxWvwfNzGZ2KGQ3vyGqf' },
    { name: '♾️ forever (older)', address: '9VBains4fvz6hoyZyuvBcVjA6syGmvVPEW5GGZ14pump' },
    { name: '🌟 Alone/Forever', address: '3ivVoCT5E2jE2FjDUmTYCaXnSGyxZVAf3zLX7Anupump' },
    { name: '🗑️ TRASHY (brand new)', address: 'F1i1zVVCMuykbV83iUwYh68D6HE6JhTv1KdXeMWxpump' },
  ];
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎯 ML ANALYSIS - YOUR TOKENS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const results = [];
  
  for (const target of targets) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${target.address}`;
      const resp = await fetch(url, { agent: httpsAgent });
      const data = await resp.json();
      const pair = data.pairs?.[0];
      
      if (!pair) {
        console.log(`❌ ${target.name} - No data found\n`);
        continue;
      }
      
      const ml = mlPredict(pair);
      const liq = pair.liquidity?.usd || 0;
      const vol = pair.volume?.h24 || 0;
      const age = pair.pairCreatedAt ? ((Date.now() - pair.pairCreatedAt) / 3600000).toFixed(1) : '?';
      const priceChange1h = pair.priceChange?.h1 || 0;
      const priceChange24h = pair.priceChange?.h24 || 0;
      const txns = pair.txns?.h24 || { buys: 0, sells: 0 };
      
      const icon = ml.recommendation === 'BUY' ? '🟢' : ml.recommendation === 'HOLD' ? '🟡' : '🔴';
      
      console.log(`${icon} ${target.name}`);
      console.log(`   Address: ${target.address.slice(0, 12)}...`);
      console.log('   ─────────────────────────────────────────────────');
      console.log(`   Price:      $${(parseFloat(pair.priceUsd) || 0).toFixed(8)}`);
      console.log(`   Liquidity:  $${liq.toLocaleString()}`);
      console.log(`   24h Volume: $${vol.toLocaleString()}`);
      console.log(`   Age:        ${age} hours`);
      console.log(`   1h Change:  ${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}%`);
      console.log(`   24h Change: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`);
      console.log(`   24h Txns:   ${txns.buys} buys / ${txns.sells} sells`);
      console.log('');
      console.log(`   ML SCORE:   ${(ml.score * 100).toFixed(1)}%`);
      console.log(`   SIGNAL:     ${ml.recommendation}`);
      console.log(`   Rug Risk:   ${(ml.features.rugRisk * 100).toFixed(0)}%`);
      console.log('');
      
      results.push({
        name: target.name,
        symbol: pair.baseToken?.symbol,
        address: target.address,
        price: parseFloat(pair.priceUsd),
        liq,
        vol,
        age: parseFloat(age),
        change1h: priceChange1h,
        change24h: priceChange24h,
        mlScore: ml.score,
        signal: ml.recommendation,
        rugRisk: ml.features.rugRisk,
      });
      
    } catch (e) {
      console.log(`❌ ${target.name} - Error: ${e.message}\n`);
    }
  }
  
  // Summary table
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('   Token          | ML Score | Signal | Liq      | 1h     | Risk');
  console.log('   ────────────────────────────────────────────────────────────');
  
  for (const r of results.sort((a, b) => b.mlScore - a.mlScore)) {
    const sigIcon = r.signal === 'BUY' ? '🟢' : r.signal === 'HOLD' ? '🟡' : '🔴';
    const name = (r.symbol || 'UNK').padEnd(12);
    const score = (r.mlScore * 100).toFixed(0).padStart(3) + '%';
    const liq = ('$' + (r.liq / 1000).toFixed(0) + 'K').padStart(8);
    const change = (r.change1h >= 0 ? '+' : '') + r.change1h.toFixed(0) + '%';
    const risk = r.rugRisk > 0.6 ? '⚠️ HIGH' : r.rugRisk > 0.3 ? '🔶 MED' : '✅ LOW';
    
    console.log(`   ${name} | ${score}    | ${sigIcon}     | ${liq} | ${change.padStart(6)} | ${risk}`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('💡 RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const buys = results.filter(r => r.signal === 'BUY');
  const holds = results.filter(r => r.signal === 'HOLD');
  
  if (buys.length > 0) {
    console.log('   🟢 POTENTIAL BUYS:');
    for (const b of buys) {
      console.log(`      • ${b.symbol}: ML ${(b.mlScore*100).toFixed(0)}%, $${(b.liq/1000).toFixed(0)}K liq, ${b.change1h > 0 ? '+' : ''}${b.change1h.toFixed(0)}% 1h`);
    }
    console.log('');
  }
  
  if (holds.length > 0) {
    console.log('   🟡 WATCH LIST:');
    for (const h of holds) {
      console.log(`      • ${h.symbol}: ML ${(h.mlScore*100).toFixed(0)}%, needs more volume/liquidity`);
    }
    console.log('');
  }
  
  // Risk warnings
  const highRisk = results.filter(r => r.rugRisk > 0.6);
  if (highRisk.length > 0) {
    console.log('   ⚠️ HIGH RISK TOKENS (low liquidity):');
    for (const h of highRisk) {
      console.log(`      • ${h.symbol}: Only $${h.liq.toLocaleString()} liquidity - use small positions`);
    }
    console.log('');
  }
  
  console.log('═══════════════════════════════════════════════════════════════\n');
}

analyzeTokens().catch(console.error);
