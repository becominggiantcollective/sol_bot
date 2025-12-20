#!/usr/bin/env node
/**
 * 📊 LIVE MEMECOIN MONITOR - Paper Mode
 * Shows real-time token opportunities without trading
 */
import fetch from 'node-fetch';

let scanCount = 0;

async function monitor() {
  scanCount++;
  
  console.log('\x1Bc'); // Clear screen
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  📊 LIVE MEMECOIN MONITOR - PAPER MODE (No Real Trades)          ║');
  console.log(`║  Scan #${scanCount} | ${new Date().toLocaleTimeString()}                                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    // Get latest boosted tokens
    const tokensRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const tokens = await tokensRes.json();
    const solTokens = tokens.filter(t => t.chainId === 'solana').slice(0, 12);
    
    console.log('┌────────────────┬────────────┬────────────┬─────────┬─────────┬──────────┬─────────────┐');
    console.log('│ Token          │ Liquidity  │ Volume 24h │ 5min    │ 1hr     │ 24hr     │ $5 Potential│');
    console.log('├────────────────┼────────────┼────────────┼─────────┼─────────┼──────────┼─────────────┤');
    
    for (const token of solTokens) {
      try {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
        const pairData = await pairRes.json();
        const pair = pairData.pairs && pairData.pairs[0];
        
        if (!pair) continue;
        
        const symbol = (pair.baseToken?.symbol || 'UNK').substring(0, 14).padEnd(14);
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const p5m = pair.priceChange?.m5 || 0;
        const p1h = pair.priceChange?.h1 || 0;
        const p24h = pair.priceChange?.h24 || 0;
        
        const liqStr = (liq >= 1000 ? '$' + (liq/1000).toFixed(0) + 'K' : '$' + liq.toFixed(0)).padStart(10);
        const volStr = (vol >= 1000 ? '$' + (vol/1000).toFixed(0) + 'K' : '$' + vol.toFixed(0)).padStart(10);
        
        const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
        const p5mStr = fmt(p5m).padStart(7);
        const p1hStr = fmt(p1h).padStart(7);
        const p24hStr = fmt(p24h).padStart(8);
        
        const potential = 5 * (p5m / 100);
        const potStr = (potential >= 0 ? '+$' : '-$') + Math.abs(potential).toFixed(2);
        const potColor = potential > 0.1 ? '🟢' : potential < -0.1 ? '🔴' : '⚪';
        
        // Hot indicator
        let hot = ' ';
        if (p5m > 10 && liq > 5000) hot = '🔥';
        else if (p5m > 5 && liq > 10000) hot = '⬆️';
        else if (p5m < -10) hot = '📉';
        
        console.log(`│ ${symbol} │${liqStr} │${volStr} │${p5mStr} │${p1hStr} │${p24hStr} │ ${potColor}${potStr.padStart(7)}  │${hot}`);
        
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {}
    }
    
    console.log('└────────────────┴────────────┴────────────┴─────────┴─────────┴──────────┴─────────────┘');
    console.log('');
    console.log('🟢 = Profit potential  🔴 = Loss potential  🔥 = HOT (>10% in 5min)  ⬆️ = Rising  📉 = Dumping');
    console.log('');
    console.log('Your balance: ~$5 | Gas per trade: ~$0.40 | Min profit needed: ~$0.80 (16%)');
    console.log('');
    console.log('Refreshing every 10 seconds... Press Ctrl+C to stop');
    
  } catch (e) {
    console.log('Error fetching data:', e.message);
  }
}

async function run() {
  while (true) {
    await monitor();
    await new Promise(r => setTimeout(r, 10000));
  }
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Monitor stopped');
  process.exit(0);
});

run();
