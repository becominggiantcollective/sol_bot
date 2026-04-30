import fetch from 'node-fetch';

const API_KEY = process.env.JUPITER_API_KEY;

async function analyzeMarket() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('                    SOLANA MARKET ANALYSIS');
  console.log('                    ' + new Date().toLocaleString());
  console.log('═══════════════════════════════════════════════════════════════════════════');
  
  // 1. SOL Price & 24h change
  console.log('\n  📈 SOL PRICE & MARKET DATA');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&community_data=false&developer_data=false');
    const solData = await cgRes.json();
    
    const price = solData.market_data.current_price.usd;
    const change24h = solData.market_data.price_change_percentage_24h;
    const change7d = solData.market_data.price_change_percentage_7d;
    const volume24h = solData.market_data.total_volume.usd;
    const marketCap = solData.market_data.market_cap.usd;
    const high24h = solData.market_data.high_24h.usd;
    const low24h = solData.market_data.low_24h.usd;
    
    console.log(`  Price:        $${price.toFixed(2)}`);
    console.log(`  24h Change:   ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
    console.log(`  7d Change:    ${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%`);
    console.log(`  24h High/Low: $${high24h.toFixed(2)} / $${low24h.toFixed(2)}`);
    console.log(`  24h Volume:   $${(volume24h/1e9).toFixed(2)}B`);
    console.log(`  Market Cap:   $${(marketCap/1e9).toFixed(2)}B`);
    
    // Volatility indicator
    const dayRange = ((high24h - low24h) / low24h) * 100;
    console.log(`  Day Range:    ${dayRange.toFixed(2)}% ${dayRange > 5 ? '🔥 HIGH VOLATILITY' : dayRange > 2 ? '�� Medium' : '😴 Low'}`);
  } catch (e) {
    console.log('  Error fetching SOL data:', e.message);
  }
  
  // 2. Top Gainers & Losers (DexScreener)
  console.log('\n  🚀 TOP GAINERS (Last 24h)');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  try {
    const dexRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const boosts = await dexRes.json();
    
    const solanaBoosts = boosts.filter(t => t.chainId === 'solana').slice(0, 5);
    
    if (solanaBoosts.length > 0) {
      for (const token of solanaBoosts) {
        console.log(`  ${token.tokenAddress.slice(0,8)}... | Boost: ${token.amount || 'N/A'}`);
      }
    } else {
      console.log('  No boosted Solana tokens found');
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // 3. New Token Launches
  console.log('\n  🆕 NEW TOKEN LAUNCHES (Last 6 hours)');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  try {
    const newTokensRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const newTokens = await newTokensRes.json();
    
    const recentSolana = newTokens
      .filter(t => t.chainId === 'solana')
      .slice(0, 10);
    
    console.log(`  Found ${recentSolana.length} recent Solana tokens:`);
    for (const token of recentSolana) {
      console.log(`  • ${token.tokenAddress?.slice(0,12) || 'Unknown'}...`);
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // 4. Trending Tokens
  console.log('\n  🔥 TRENDING SOLANA TOKENS');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  try {
    const searchRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana');
    const searchData = await searchRes.json();
    
    if (searchData.pairs) {
      const sorted = searchData.pairs
        .filter(p => p.chainId === 'solana' && p.volume?.h24 > 100000)
        .sort((a, b) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0))
        .slice(0, 8);
      
      console.log('  Symbol      │ Price        │ 24h Change │ Volume    │ Liquidity');
      console.log('  ────────────┼──────────────┼────────────┼───────────┼──────────');
      
      for (const pair of sorted) {
        const symbol = (pair.baseToken?.symbol || '???').padEnd(10);
        const price = `$${parseFloat(pair.priceUsd || 0).toFixed(6)}`.padEnd(12);
        const change = `${(pair.priceChange?.h24 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.h24 || 0).toFixed(1)}%`.padEnd(10);
        const vol = `$${((pair.volume?.h24 || 0)/1000).toFixed(0)}k`.padEnd(9);
        const liq = `$${((pair.liquidity?.usd || 0)/1000).toFixed(0)}k`;
        console.log(`  ${symbol} │ ${price} │ ${change} │ ${vol} │ ${liq}`);
      }
    }
  } catch (e) {
    console.log('  Error:', e.message);
  }
  
  // 5. Check specific volatile tokens
  console.log('\n  📊 MEME COIN VOLATILITY CHECK');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  const memeTokens = [
    { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { symbol: 'WIF', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
    { symbol: 'POPCAT', address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
    { symbol: 'MEW', address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
    { symbol: 'GOAT', address: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump' },
  ];
  
  console.log('  Symbol │ Price       │ 5m     │ 1h     │ 24h    │ Volume');
  console.log('  ───────┼─────────────┼────────┼────────┼────────┼─────────');
  
  for (const token of memeTokens) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
      const data = await res.json();
      
      if (data.pairs && data.pairs[0]) {
        const pair = data.pairs[0];
        const price = `$${parseFloat(pair.priceUsd || 0).toPrecision(4)}`.padEnd(11);
        const m5 = `${(pair.priceChange?.m5 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.m5 || 0).toFixed(1)}%`.padEnd(6);
        const h1 = `${(pair.priceChange?.h1 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.h1 || 0).toFixed(1)}%`.padEnd(6);
        const h24 = `${(pair.priceChange?.h24 || 0) >= 0 ? '+' : ''}${(pair.priceChange?.h24 || 0).toFixed(1)}%`.padEnd(6);
        const vol = `$${((pair.volume?.h24 || 0)/1e6).toFixed(1)}M`;
        
        const volatileFlag = Math.abs(pair.priceChange?.m5 || 0) > 2 ? ' 🔥' : '';
        console.log(`  ${token.symbol.padEnd(6)} │ ${price} │ ${m5} │ ${h1} │ ${h24} │ ${vol}${volatileFlag}`);
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.log(`  ${token.symbol.padEnd(6)} │ Error fetching data`);
    }
  }
  
  // 6. Arbitrage opportunity summary
  console.log('\n  💰 ARBITRAGE OPPORTUNITY ASSESSMENT');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  // Check cross-DEX for a volatile token
  try {
    const SOL = 'So11111111111111111111111111111111111111112';
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const amount = 100e9; // 100 SOL
    
    const dexes = ['Raydium CLMM', 'Whirlpool', 'Meteora DLMM', 'Phoenix'];
    const prices = [];
    
    for (const dex of dexes) {
      const url = `https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${amount}&dexes=${dex}&slippageBps=50`;
      const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
      if (res.ok) {
        const data = await res.json();
        if (data.outAmount) {
          prices.push({ dex, usdc: parseInt(data.outAmount) / 1e6 });
        }
      }
      await new Promise(r => setTimeout(r, 150));
    }
    
    if (prices.length >= 2) {
      const best = prices.reduce((a, b) => a.usdc > b.usdc ? a : b);
      const worst = prices.reduce((a, b) => a.usdc < b.usdc ? a : b);
      const spread = ((best.usdc - worst.usdc) / worst.usdc) * 100;
      
      console.log(`  100 SOL cross-DEX spread: ${spread.toFixed(4)}%`);
      console.log(`  Best:  ${best.dex} ($${best.usdc.toFixed(2)})`);
      console.log(`  Worst: ${worst.dex} ($${worst.usdc.toFixed(2)})`);
      console.log(`  Status: ${spread > 0.1 ? '✅ Potential opportunity!' : '❌ No significant spread'}`);
    }
  } catch (e) {
    console.log('  Error checking spreads:', e.message);
  }
  
  // 7. Summary & Recommendations
  console.log('\n  📋 MARKET SUMMARY & RECOMMENDATIONS');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  
  console.log('  Current conditions:');
  console.log('  • Established pairs (SOL/USDC): Spreads ~0% (too efficient)');
  console.log('  • Meme coins: Check 5m column for volatility spikes');
  console.log('  • New launches: Best opportunity for arbitrage');
  console.log('');
  console.log('  Recommended strategy:');
  console.log('  1. Monitor meme coins for >2% 5-minute moves (🔥 flag)');
  console.log('  2. Watch DexScreener for new token launches');
  console.log('  3. During high volatility, cross-DEX spreads increase');
  console.log('  4. Focus on tokens with $50k-$500k liquidity (less efficient)');
  
  console.log('\n═══════════════════════════════════════════════════════════════════════════\n');
}

analyzeMarket().catch(console.error);
