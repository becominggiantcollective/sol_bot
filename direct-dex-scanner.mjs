import fetch from 'node-fetch';

const API_KEY = process.env.JUPITER_API_KEY;

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Get quote but RESTRICT to specific DEX only
async function getDexQuote(inputMint, outputMint, amount, dexes) {
  const dexParam = dexes.map(d => `dexes=${d}`).join('&');
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&${dexParam}&slippageBps=50`;
  
  try {
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function scanDexPrices() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           DIRECT DEX PRICE COMPARISON (Bypassing Jupiter Router)');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const amount = 10e9; // 10 SOL
  
  // DEXes to compare
  const dexes = [
    { name: 'Raydium', id: 'Raydium' },
    { name: 'Raydium CLMM', id: 'Raydium CLMM' },
    { name: 'Orca', id: 'Orca' },
    { name: 'Orca Whirlpool', id: 'Whirlpool' },
    { name: 'Meteora', id: 'Meteora' },
    { name: 'Meteora DLMM', id: 'Meteora DLMM' },
    { name: 'Phoenix', id: 'Phoenix' },
  ];
  
  console.log('  Fetching SOL → USDC prices from each DEX...\n');
  
  const solToUsdcPrices = [];
  
  for (const dex of dexes) {
    const quote = await getDexQuote(SOL, USDC, amount, [dex.id]);
    if (quote && quote.outAmount) {
      const usdc = parseInt(quote.outAmount) / 1e6;
      const price = usdc / 10; // price per SOL
      solToUsdcPrices.push({ dex: dex.name, usdc, price });
      console.log(`  ${dex.name.padEnd(18)} → ${usdc.toFixed(2)} USDC (${price.toFixed(4)} per SOL)`);
    } else {
      console.log(`  ${dex.name.padEnd(18)} → No route available`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\n  Fetching USDC → SOL prices from each DEX...\n');
  
  // Use avg USDC from above
  const avgUsdc = solToUsdcPrices.reduce((a, b) => a + b.usdc, 0) / solToUsdcPrices.length;
  const usdcAmount = Math.floor(avgUsdc * 1e6);
  
  const usdcToSolPrices = [];
  
  for (const dex of dexes) {
    const quote = await getDexQuote(USDC, SOL, usdcAmount, [dex.id]);
    if (quote && quote.outAmount) {
      const sol = parseInt(quote.outAmount) / 1e9;
      const price = avgUsdc / sol; // USDC per SOL
      usdcToSolPrices.push({ dex: dex.name, sol, price });
      console.log(`  ${dex.name.padEnd(18)} → ${sol.toFixed(6)} SOL (${price.toFixed(4)} per SOL)`);
    } else {
      console.log(`  ${dex.name.padEnd(18)} → No route available`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Find best arb opportunity
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                    CROSS-DEX ARBITRAGE SCAN');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  if (solToUsdcPrices.length < 2 || usdcToSolPrices.length < 2) {
    console.log('  Not enough DEX data for comparison');
    return;
  }
  
  // Find best sell (highest USDC out) and best buy (most SOL back)
  const bestSell = solToUsdcPrices.reduce((a, b) => a.usdc > b.usdc ? a : b);
  const worstSell = solToUsdcPrices.reduce((a, b) => a.usdc < b.usdc ? a : b);
  const bestBuy = usdcToSolPrices.reduce((a, b) => a.sol > b.sol ? a : b);
  const worstBuy = usdcToSolPrices.reduce((a, b) => a.sol < b.sol ? a : b);
  
  console.log('  BEST PRICES FOUND:');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Best place to SELL SOL:  ${bestSell.dex} (${bestSell.usdc.toFixed(2)} USDC)`);
  console.log(`  Worst place to SELL SOL: ${worstSell.dex} (${worstSell.usdc.toFixed(2)} USDC)`);
  console.log(`  Best place to BUY SOL:   ${bestBuy.dex} (${bestBuy.sol.toFixed(6)} SOL)`);
  console.log(`  Worst place to BUY SOL:  ${worstBuy.dex} (${worstBuy.sol.toFixed(6)} SOL)`);
  console.log('');
  
  // Calculate spread
  const sellSpread = ((bestSell.usdc - worstSell.usdc) / worstSell.usdc) * 100;
  const buySpread = ((bestBuy.sol - worstBuy.sol) / worstBuy.sol) * 100;
  
  console.log('  PRICE SPREADS:');
  console.log('  ─────────────────────────────────────────');
  console.log(`  SOL→USDC spread: ${sellSpread.toFixed(4)}% (${bestSell.dex} vs ${worstSell.dex})`);
  console.log(`  USDC→SOL spread: ${buySpread.toFixed(4)}% (${bestBuy.dex} vs ${worstBuy.dex})`);
  console.log('');
  
  // Best arb: sell on best, buy on best
  // Simulate: 10 SOL → sell on bestSell → buy on bestBuy → ? SOL
  const usdcFromSell = bestSell.usdc;
  const solFromBuy = (usdcFromSell / avgUsdc) * bestBuy.sol;
  const arbProfit = ((solFromBuy - 10) / 10) * 100;
  
  console.log('  BEST ARBITRAGE PATH:');
  console.log('  ─────────────────────────────────────────');
  console.log(`  10 SOL → ${bestSell.dex} → ${usdcFromSell.toFixed(2)} USDC → ${bestBuy.dex} → ${solFromBuy.toFixed(6)} SOL`);
  console.log(`  Net change: ${arbProfit >= 0 ? '+' : ''}${arbProfit.toFixed(4)}%`);
  console.log('');
  
  // Gas cost
  const gasCost = 0.0005; // ~0.0005 SOL for 2 swaps
  const gasPct = (gasCost / 10) * 100;
  const netAfterGas = arbProfit - gasPct;
  
  console.log('  PROFITABILITY:');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Gross profit:    ${arbProfit >= 0 ? '+' : ''}${arbProfit.toFixed(4)}%`);
  console.log(`  Gas cost:        -${gasPct.toFixed(4)}%`);
  console.log(`  NET PROFIT:      ${netAfterGas >= 0 ? '+' : ''}${netAfterGas.toFixed(4)}%`);
  console.log(`  Status:          ${netAfterGas > 0.05 ? '✅ PROFITABLE!' : '❌ Not profitable'}`);
  console.log('');
  
  if (netAfterGas > 0.05) {
    const profitUSD = (netAfterGas / 100) * 10 * 127; // 10 SOL @ $127
    console.log(`  💰 Potential profit: $${profitUSD.toFixed(2)} on 10 SOL trade`);
  }
  
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

scanDexPrices().catch(console.error);
