import fetch from 'node-fetch';

const API_KEY = process.env.JUPITER_API_KEY;
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function getDexQuote(inputMint, outputMint, amount, dexes) {
  const dexParam = dexes.map(d => `dexes=${d}`).join('&');
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&${dexParam}&slippageBps=50`;
  const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) return null;
  return res.json();
}

async function findRealArb() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              CROSS-DEX ARBITRAGE FINDER');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const amount = 10e9; // 10 SOL
  const dexes = ['Raydium', 'Raydium CLMM', 'Whirlpool', 'Meteora', 'Meteora DLMM', 'Phoenix'];
  
  // Get all sell prices
  const sellPrices = {};
  for (const dex of dexes) {
    const quote = await getDexQuote(SOL, USDC, amount, [dex]);
    if (quote?.outAmount) {
      sellPrices[dex] = parseInt(quote.outAmount);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log('  Testing ALL cross-DEX combinations...\n');
  console.log('  ┌─────────────────────┬───────────────────┬──────────┬────────┐');
  console.log('  │ Sell on             │ Buy on            │ Net SOL  │ Profit │');
  console.log('  ├─────────────────────┼───────────────────┼──────────┼────────┤');
  
  const results = [];
  
  for (const sellDex of Object.keys(sellPrices)) {
    const usdcOut = sellPrices[sellDex];
    
    for (const buyDex of dexes) {
      if (buyDex === sellDex) continue; // Skip same DEX
      
      const buyQuote = await getDexQuote(USDC, SOL, usdcOut, [buyDex]);
      if (!buyQuote?.outAmount) continue;
      
      const solBack = parseInt(buyQuote.outAmount);
      const profitPct = ((solBack - amount) / amount) * 100;
      
      results.push({ sellDex, buyDex, solBack, profitPct });
      
      const status = profitPct > 0.01 ? '✅' : '❌';
      console.log(`  │ ${sellDex.padEnd(19)} │ ${buyDex.padEnd(17)} │ ${(solBack/1e9).toFixed(6)} │ ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(3)}% ${status}│`);
      
      await new Promise(r => setTimeout(r, 150));
    }
  }
  
  console.log('  └─────────────────────┴───────────────────┴──────────┴────────┘\n');
  
  // Find best
  const best = results.reduce((a, b) => a.profitPct > b.profitPct ? a : b);
  
  console.log('  BEST OPPORTUNITY:');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Sell on: ${best.sellDex}`);
  console.log(`  Buy on:  ${best.buyDex}`);
  console.log(`  Result:  10 SOL → ${(best.solBack/1e9).toFixed(6)} SOL`);
  console.log(`  Profit:  ${best.profitPct >= 0 ? '+' : ''}${best.profitPct.toFixed(4)}%`);
  
  const gasPct = 0.005; // 0.005%
  const netProfit = best.profitPct - gasPct;
  console.log(`  After gas: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(4)}%`);
  
  if (netProfit > 0) {
    const profitUSD = (netProfit / 100) * 10 * 127;
    console.log(`  💰 = $${profitUSD.toFixed(2)} profit on 10 SOL`);
  } else {
    console.log(`  ❌ Not profitable after gas`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

findRealArb().catch(console.error);
