import fetch from 'node-fetch';

async function analyzeMarket() {
  try {
    console.log('🔍 Fetching top Solana pairs by volume...\n');
    
    // Get pairs sorted by volume
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const text = await res.text();
    
    if (!text.startsWith('{') && !text.startsWith('[')) {
      console.log('⚠️  Got HTML response, API may be rate limited\n');
      console.log('Using example data based on typical market patterns...\n');
      provideRecommendations();
      return;
    }
    
    const data = JSON.parse(text);
    console.log(`📊 Found ${data.pairs?.length || 0} SOL pairs\n`);
    
    const pairs = (data.pairs || [])
      .filter(p => p.chainId === 'solana')
      .sort((a, b) => parseFloat(b.volume?.h24 || 0) - parseFloat(a.volume?.h24 || 0));
    
    analyzePairs(pairs.slice(0, 30));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    provideRecommendations();
  }
}

function provideRecommendations() {
  console.log('=== MARKET INSIGHTS (Based on typical Solana pump patterns) ===\n');
  console.log('Successful early-stage pumps typically have:');
  console.log('  • Liquidity: $2,000 - $20,000 (early phase)');
  console.log('  • 24h Volume: $5,000 - $50,000 (initial momentum)');
  console.log('  • Age: < 12 hours (fresh launches)');
  console.log('  • 1h Price Change: +30% to +200%');
  console.log('  • Volume/Liquidity Ratio: 2-10x (high activity)');
  console.log('\n=== RECOMMENDED BOT SETTINGS ===');
  console.log('For EARLY MOMENTUM capture:');
  console.log('  MIN_LIQUIDITY: $2,000 (was $10,000)');
  console.log('  MIN_VOLUME_24H: $3,000 (was $8,000)');
  console.log('  MIN_VOL_LIQ_RATIO: 1.5x (new - ensures activity)');
  console.log('  MAX_TOKEN_AGE: 12 hours (new - catch early pumps)');
  console.log('  MOMENTUM_THRESHOLD: +25% in 1h (new - ride the hype)');
  console.log('\nEXIT STRATEGY:');
  console.log('  • Sell when price drops 15% from peak');
  console.log('  • Sell when volume drops 70% from 5m peak');
  console.log('  • Auto-sell after 30 minutes if not hitting targets');
  console.log('  • Take 50% profit at 2x, let rest ride');
}

function analyzePairs(pairs) {
  console.log(`=== ANALYZING ${pairs.length} SOLANA PAIRS ===\n`);
  
  // Filter for recently created tokens with activity
  const recentTokens = pairs.filter(p => {
    const age = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / (1000 * 60 * 60) : 999;
    return age < 48; // Less than 48 hours old
  });
  
  console.log('📊 RECENT TOKENS (< 48h old):\n');
  
  const stats = [];
  
  recentTokens.forEach((pair, i) => {
    const liq = parseFloat(pair.liquidity?.usd || 0);
    const vol = parseFloat(pair.volume?.h24 || 0);
    const vol5m = parseFloat(pair.volume?.m5 || 0);
    const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);
    const priceChange6h = parseFloat(pair.priceChange?.h6 || 0);
    const priceChange24h = parseFloat(pair.priceChange?.h24 || 0);
    const age = pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)) : 0;
    const volLiqRatio = liq > 0 ? vol / liq : 0;
    
    stats.push({ liq, vol, volLiqRatio, priceChange24h, age });
    
    if (i < 10) {
      console.log(`${i+1}. ${pair.baseToken?.symbol || 'Unknown'}`);
      console.log(`   Liquidity: $${liq.toLocaleString()}`);
      console.log(`   24h Volume: $${vol.toLocaleString()}`);
      console.log(`   5m Volume: $${vol5m.toLocaleString()}`);
      console.log(`   Price Change: 1h=${priceChange1h > 0 ? '+' : ''}${priceChange1h.toFixed(1)}% | 6h=${priceChange6h > 0 ? '+' : ''}${priceChange6h.toFixed(1)}% | 24h=${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(1)}%`);
      console.log(`   Age: ${age}h`);
      console.log(`   Vol/Liq Ratio: ${volLiqRatio.toFixed(2)}x`);
      console.log(`   DEX: ${pair.dexId}`);
      console.log(`   Mint: ${pair.baseToken?.address}`);
      console.log('');
    }
  });
  
  // Calculate statistics
  if (stats.length > 0) {
    const avgLiq = stats.reduce((sum, s) => sum + s.liq, 0) / stats.length;
    const avgVol = stats.reduce((sum, s) => sum + s.vol, 0) / stats.length;
    const avgRatio = stats.reduce((sum, s) => sum + s.volLiqRatio, 0) / stats.length;
    
    const minLiq = Math.min(...stats.map(s => s.liq));
    const maxLiq = Math.max(...stats.map(s => s.liq));
    const minVol = Math.min(...stats.map(s => s.vol));
    const maxVol = Math.max(...stats.map(s => s.vol));
    
    // Find tokens with positive momentum
    const pumping = stats.filter(s => s.priceChange24h > 50);
    
    console.log('\n=== STATISTICS ===');
    console.log(`Total Recent Tokens: ${stats.length}`);
    console.log(`Tokens Pumping >50%: ${pumping.length}`);
    console.log('');
    console.log('LIQUIDITY:');
    console.log(`  Average: $${avgLiq.toLocaleString()}`);
    console.log(`  Min: $${minLiq.toLocaleString()}`);
    console.log(`  Max: $${maxLiq.toLocaleString()}`);
    console.log('');
    console.log('24H VOLUME:');
    console.log(`  Average: $${avgVol.toLocaleString()}`);
    console.log(`  Min: $${minVol.toLocaleString()}`);
    console.log(`  Max: $${maxVol.toLocaleString()}`);
    console.log('');
    console.log(`Average Vol/Liq Ratio: ${avgRatio.toFixed(2)}x`);
    
    console.log('\n=== RECOMMENDED SETTINGS ===');
    console.log('Based on market data, here are optimal thresholds:');
    console.log('');
    console.log(`MIN_LIQUIDITY: $${Math.floor(minLiq * 0.8).toLocaleString()} (current: $10,000)`);
    console.log(`  → Many successful tokens start with $${Math.floor(minLiq).toLocaleString()} liquidity`);
    console.log('');
    console.log(`MIN_VOLUME_24H: $${Math.floor(minVol * 0.5).toLocaleString()} (current: $8,000)`);
    console.log(`  → Early tokens may have lower volume initially`);
    console.log('');
    console.log(`MIN_VOL_LIQ_RATIO: ${Math.max(0.1, avgRatio * 0.3).toFixed(2)} (consider adding this)`);
    console.log(`  → High ratio indicates strong trading activity`);
    console.log('');
    console.log('MOMENTUM INDICATORS:');
    console.log('  → Monitor 1h price change > +20% for early entry');
    console.log('  → Exit when 5m volume drops below 10% of peak');
    console.log('  → Consider age: tokens < 6h old have most momentum');
  }
  
  console.log('\n=== ALL PAIRS (ANY AGE) ===\n');
  pairs.slice(0, 5).forEach((pair, i) => {
    const liq = parseFloat(pair.liquidity?.usd || 0);
    const vol = parseFloat(pair.volume?.h24 || 0);
    const age = pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)) : 0;
    
    console.log(`${i+1}. ${pair.baseToken?.symbol} - Liq: $${liq.toLocaleString()}, Vol: $${vol.toLocaleString()}, Age: ${age}h`);
  });
}

analyzeMarket();
