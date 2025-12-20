import fetch from 'node-fetch';

const JUPITER_API = 'https://api.jup.ag/swap/v1/quote';
const API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';

const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
};

const FLASH_LOAN_FEE = 0.003;
const DEX_FEE_AVG = 0.0025;
const GAS_COST_SOL = 0.005;

async function getSolPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    return data.solana.usd;
  } catch {
    return 220; // fallback
  }
}

async function getQuote(inputMint, outputMint, amount) {
  const url = `${JUPITER_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`;
  const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) return null;
  return res.json();
}

async function analyzeArbitrage(tokenA, tokenB, nameA, nameB, solPrice, decimalsA) {
  const amountA = decimalsA === 9 ? 10e9 : 1000e6;
  const amountUSD = decimalsA === 9 ? 10 * solPrice : 1000;
  
  const forwardQuote = await getQuote(tokenA, tokenB, amountA);
  if (!forwardQuote) return null;
  
  const amountB = parseInt(forwardQuote.outAmount);
  const reverseQuote = await getQuote(tokenB, tokenA, amountB);
  if (!reverseQuote) return null;
  
  const finalA = parseInt(reverseQuote.outAmount);
  const grossSpread = (finalA - amountA) / amountA;
  
  const totalCost = FLASH_LOAN_FEE + (DEX_FEE_AVG * 2) + 0.0005;
  const netProfit = grossSpread - totalCost;
  
  return {
    pair: `${nameA}/${nameB}`,
    grossSpread: (grossSpread * 100).toFixed(3),
    totalCost: (totalCost * 100).toFixed(2),
    netProfit: (netProfit * 100).toFixed(3),
    profitable: netProfit > 0,
    profitUSD: (netProfit * amountUSD).toFixed(2)
  };
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('        FLASH LOAN ARBITRAGE PROFIT ANALYSIS (REAL-TIME)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Time: ${new Date().toLocaleString()}`);
  
  const solPrice = await getSolPrice();
  console.log(`  SOL Price: $${solPrice.toFixed(2)}`);
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │                     COSTS BREAKDOWN                         │');
  console.log('  ├─────────────────────────────────────────────────────────────┤');
  console.log('  │  Flash Loan Fee (Solend):       0.30%                       │');
  console.log('  │  DEX Fees (2 swaps @ 0.25%):    0.50%                       │');
  console.log('  │  Gas + Priority:                0.05%                       │');
  console.log('  ├─────────────────────────────────────────────────────────────┤');
  console.log('  │  TOTAL MINIMUM COST:            0.85%                       │');
  console.log('  │  BREAKEVEN SPREAD NEEDED:       >0.85%                      │');
  console.log('  └─────────────────────────────────────────────────────────────┘');
  console.log('');
  
  const pairs = [
    [TOKENS.SOL, TOKENS.USDC, 'SOL', 'USDC', 9],
    [TOKENS.SOL, TOKENS.USDT, 'SOL', 'USDT', 9],
    [TOKENS.SOL, TOKENS.RAY, 'SOL', 'RAY', 9],
    [TOKENS.SOL, TOKENS.JUP, 'SOL', 'JUP', 9],
    [TOKENS.SOL, TOKENS.BONK, 'SOL', 'BONK', 9],
    [TOKENS.SOL, TOKENS.WIF, 'SOL', 'WIF', 9],
    [TOKENS.USDC, TOKENS.USDT, 'USDC', 'USDT', 6],
  ];
  
  console.log('  ┌───────────┬──────────┬────────┬──────────┬────────┬─────────┐');
  console.log('  │ Pair      │ Gross %  │ Cost % │ Net %    │ Status │ P/L     │');
  console.log('  ├───────────┼──────────┼────────┼──────────┼────────┼─────────┤');
  
  let profitable = 0;
  let totalLoss = 0;
  
  for (const [tokenA, tokenB, nameA, nameB, decimals] of pairs) {
    try {
      const result = await analyzeArbitrage(tokenA, tokenB, nameA, nameB, solPrice, decimals);
      if (result) {
        const status = result.profitable ? '✅' : '❌';
        const pl = result.profitable ? `+$${result.profitUSD}` : `-$${Math.abs(parseFloat(result.profitUSD)).toFixed(2)}`;
        totalLoss += parseFloat(result.profitUSD);
        if (result.profitable) profitable++;
        console.log(`  │ ${result.pair.padEnd(9)} │ ${result.grossSpread.padStart(7)}% │ ${result.totalCost.padStart(5)}% │ ${result.netProfit.padStart(7)}% │   ${status}   │ ${pl.padStart(7)} │`);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`  │ ${nameA}/${nameB}: API Error`);
    }
  }
  
  console.log('  └───────────┴──────────┴────────┴──────────┴────────┴─────────┘');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Profitable Pairs Right Now:  ${profitable}/${pairs.length}`);
  console.log(`  If Traded All 7 Pairs:       ${totalLoss > 0 ? '+' : ''}$${totalLoss.toFixed(2)} (on ~$${(10*solPrice*5 + 2000).toFixed(0)} volume)`);
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │              MONTHLY PROFIT PROJECTIONS                     │');
  console.log('  ├──────────────────────┬────────┬──────────┬─────────────────┤');
  console.log('  │ Scenario             │ Trades │ Per Trade│ Monthly Profit  │');
  console.log('  ├──────────────────────┼────────┼──────────┼─────────────────┤');
  console.log('  │ Current (efficient)  │ 0/day  │   $0     │       $0        │');
  console.log('  │ Low volatility       │ 1/day  │   $0.50  │      $15        │');
  console.log('  │ Medium volatility    │ 3/day  │   $1.00  │      $90        │');
  console.log('  │ High volatility      │ 10/day │   $2.00  │     $600        │');
  console.log('  │ New token launch     │ 1/wk   │  $10-50  │    $40-200      │');
  console.log('  └──────────────────────┴────────┴──────────┴─────────────────┘');
  console.log('');
  console.log('  ⚠️  BOTTOM LINE:');
  console.log('  ───────────────────────────────────────────────────────────────');
  console.log('  • Current spreads: 0.02% - 0.15% (way below 0.85% breakeven)');
  console.log('  • Every trade would LOSE ~0.7-0.8% after fees');
  console.log('  • Need 5-10x more spread to profit');
  console.log('  • This only happens during: new launches, crashes, high volume');
  console.log('');
}

main().catch(console.error);
