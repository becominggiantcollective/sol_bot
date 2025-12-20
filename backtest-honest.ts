/**
 * HONEST BOT BACKTESTER
 * 
 * Tests the trading strategy using REAL Jupiter quotes to see what would happen
 * without actually executing trades. Uses live market data for accurate simulation.
 */
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_PRICE = 230;

// Backtest configuration
const CONFIG = {
  startingBalanceSOL: 0.1,      // Start with 0.1 SOL (~$23)
  tradeSize: 0.01,              // Trade 0.01 SOL per opportunity
  gasPerTrade: 0.0001,          // ~0.0001 SOL gas cost per round trip
  scanIntervalMs: 2000,         // Scan every 2 seconds
  duration: 60,                 // Run for 60 seconds (1 minute demo)
  minProfitPercent: 0.05,       // Need 0.05% profit minimum
};

// Tokens to check for arbitrage
const TOKENS = [
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', name: 'USDT', decimals: 6 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', name: 'mSOL', decimals: 9 },
  { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', name: 'jitoSOL', decimals: 9 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', name: 'JUP', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK', decimals: 5 },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY', decimals: 6 },
];

// Stats tracking
let stats = {
  totalScans: 0,
  opportunitiesFound: 0,
  tradesTaken: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfitSOL: 0,
  totalGasSOL: 0,
  bestTrade: 0,
  worstTrade: 0,
  profitHistory: [] as number[],
  balance: CONFIG.startingBalanceSOL,
};

async function getQuote(inputMint: string, outputMint: string, amount: number, slippageBps: number = 50) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (JUPITER_KEY) headers['x-api-key'] = JUPITER_KEY;
  
  try {
    const res = await axios.get(`${JUPITER_API}/quote`, {
      params: { inputMint, outputMint, amount, slippageBps },
      headers,
      timeout: 5000,
    });
    return res.data;
  } catch (e) {
    return null;
  }
}

async function checkArbitrage(token: typeof TOKENS[0], tradeSizeLamports: number): Promise<{
  profitable: boolean;
  profitSOL: number;
  profitPercent: number;
  route: string;
} | null> {
  try {
    // Get SOL -> Token quote
    const quote1 = await getQuote(SOL_MINT, token.mint, tradeSizeLamports, 50);
    if (!quote1?.outAmount) return null;
    
    const tokenAmount = parseInt(quote1.outAmount);
    
    // Get Token -> SOL quote
    const quote2 = await getQuote(token.mint, SOL_MINT, tokenAmount, 50);
    if (!quote2?.outAmount) return null;
    
    const finalSOLLamports = parseInt(quote2.outAmount);
    const finalSOL = finalSOLLamports / 1e9;
    const tradeSizeSOL = tradeSizeLamports / 1e9;
    
    const grossProfitSOL = finalSOL - tradeSizeSOL;
    const netProfitSOL = grossProfitSOL - CONFIG.gasPerTrade;
    const profitPercent = (grossProfitSOL / tradeSizeSOL) * 100;
    
    return {
      profitable: netProfitSOL > 0 && profitPercent >= CONFIG.minProfitPercent,
      profitSOL: netProfitSOL,
      profitPercent,
      route: `SOL → ${token.name} → SOL`,
    };
  } catch (e) {
    return null;
  }
}

async function runBacktest() {
  console.log('═'.repeat(70));
  console.log('🧪 HONEST BOT BACKTESTER');
  console.log('   Using REAL Jupiter quotes from live market');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Configuration:');
  console.log(`  Starting balance: ${CONFIG.startingBalanceSOL} SOL (~$${(CONFIG.startingBalanceSOL * SOL_PRICE).toFixed(2)})`);
  console.log(`  Trade size:       ${CONFIG.tradeSize} SOL per trade`);
  console.log(`  Gas per trade:    ${CONFIG.gasPerTrade} SOL`);
  console.log(`  Min profit:       ${CONFIG.minProfitPercent}%`);
  console.log(`  Duration:         ${CONFIG.duration} seconds`);
  console.log(`  Tokens checked:   ${TOKENS.map(t => t.name).join(', ')}`);
  console.log('');
  console.log('═'.repeat(70));
  console.log('Starting backtest...');
  console.log('');
  
  const startTime = Date.now();
  const endTime = startTime + (CONFIG.duration * 1000);
  
  while (Date.now() < endTime) {
    stats.totalScans++;
    
    const tradeSizeLamports = Math.floor(CONFIG.tradeSize * 1e9);
    
    // Check each token for arbitrage
    for (const token of TOKENS) {
      if (stats.balance < CONFIG.tradeSize + CONFIG.gasPerTrade) {
        console.log('⚠️ Insufficient balance, stopping...');
        break;
      }
      
      const result = await checkArbitrage(token, tradeSizeLamports);
      
      if (result) {
        if (result.profitable) {
          stats.opportunitiesFound++;
          
          // Simulate taking the trade
          stats.tradesTaken++;
          stats.balance += result.profitSOL;
          stats.totalProfitSOL += result.profitSOL;
          stats.totalGasSOL += CONFIG.gasPerTrade;
          stats.profitHistory.push(result.profitSOL);
          
          if (result.profitSOL > 0) {
            stats.successfulTrades++;
            if (result.profitSOL > stats.bestTrade) stats.bestTrade = result.profitSOL;
          } else {
            stats.failedTrades++;
            if (result.profitSOL < stats.worstTrade) stats.worstTrade = result.profitSOL;
          }
          
          console.log(`✅ [${new Date().toLocaleTimeString()}] ${result.route}: ${result.profitPercent >= 0 ? '+' : ''}${result.profitPercent.toFixed(4)}% | Net: ${result.profitSOL >= 0 ? '+' : ''}${result.profitSOL.toFixed(6)} SOL | Balance: ${stats.balance.toFixed(6)} SOL`);
        } else {
          // Log spread info periodically
          if (stats.totalScans % 5 === 0) {
            const spreadInfo = result.profitPercent.toFixed(4);
            process.stdout.write(`[Scan ${stats.totalScans}] ${token.name}: ${spreadInfo}%  `);
          }
        }
      }
      
      // Small delay between tokens
      await new Promise(r => setTimeout(r, 200));
    }
    
    if (stats.totalScans % 5 === 0) {
      console.log('');
    }
    
    // Wait between scans
    await new Promise(r => setTimeout(r, CONFIG.scanIntervalMs));
  }
  
  // Print final results
  printResults();
}

function printResults() {
  const runTimeSeconds = CONFIG.duration;
  const netProfitSOL = stats.totalProfitSOL;
  const netProfitUSD = netProfitSOL * SOL_PRICE;
  const roi = (netProfitSOL / CONFIG.startingBalanceSOL) * 100;
  const hourlyProfit = (netProfitSOL / runTimeSeconds) * 3600;
  const dailyProfit = hourlyProfit * 24;
  const winRate = stats.tradesTaken > 0 ? (stats.successfulTrades / stats.tradesTaken) * 100 : 0;
  
  console.log('');
  console.log('═'.repeat(70));
  console.log('📊 BACKTEST RESULTS');
  console.log('═'.repeat(70));
  console.log('');
  console.log('EXECUTION STATS:');
  console.log(`  Runtime:              ${runTimeSeconds} seconds`);
  console.log(`  Total scans:          ${stats.totalScans}`);
  console.log(`  Opportunities found:  ${stats.opportunitiesFound}`);
  console.log(`  Trades executed:      ${stats.tradesTaken}`);
  console.log('');
  console.log('TRADE PERFORMANCE:');
  console.log(`  Successful trades:    ${stats.successfulTrades}`);
  console.log(`  Failed trades:        ${stats.failedTrades}`);
  console.log(`  Win rate:             ${winRate.toFixed(2)}%`);
  console.log(`  Best trade:           +${stats.bestTrade.toFixed(6)} SOL`);
  console.log(`  Worst trade:          ${stats.worstTrade.toFixed(6)} SOL`);
  console.log('');
  console.log('PROFITABILITY:');
  console.log(`  Starting balance:     ${CONFIG.startingBalanceSOL.toFixed(6)} SOL (~$${(CONFIG.startingBalanceSOL * SOL_PRICE).toFixed(2)})`);
  console.log(`  Ending balance:       ${stats.balance.toFixed(6)} SOL (~$${(stats.balance * SOL_PRICE).toFixed(2)})`);
  console.log(`  Net profit:           ${netProfitSOL >= 0 ? '+' : ''}${netProfitSOL.toFixed(6)} SOL (~$${netProfitUSD.toFixed(4)})`);
  console.log(`  Total gas spent:      -${stats.totalGasSOL.toFixed(6)} SOL`);
  console.log(`  ROI:                  ${roi >= 0 ? '+' : ''}${roi.toFixed(4)}%`);
  console.log('');
  console.log('PROJECTED RETURNS (if this rate continues):');
  console.log(`  Hourly:               ${hourlyProfit >= 0 ? '+' : ''}${hourlyProfit.toFixed(6)} SOL (~$${(hourlyProfit * SOL_PRICE).toFixed(4)})`);
  console.log(`  Daily:                ${dailyProfit >= 0 ? '+' : ''}${dailyProfit.toFixed(6)} SOL (~$${(dailyProfit * SOL_PRICE).toFixed(4)})`);
  console.log(`  Monthly (30d):        ${(dailyProfit * 30) >= 0 ? '+' : ''}${(dailyProfit * 30).toFixed(6)} SOL (~$${(dailyProfit * 30 * SOL_PRICE).toFixed(2)})`);
  console.log('');
  console.log('═'.repeat(70));
  console.log('⚠️  IMPORTANT NOTES:');
  console.log('═'.repeat(70));
  console.log('');
  console.log('1. This backtest uses LIVE Jupiter quotes - spreads are real');
  console.log('2. Actual execution may differ due to:');
  console.log('   - Transaction latency (others may front-run)');
  console.log('   - Slippage during execution');
  console.log('   - Failed transactions');
  console.log('3. Profitable arbitrage on major tokens is RARE in efficient markets');
  console.log('4. Most retail arbitrage bots LOSE money to gas fees');
  console.log('5. Flash loan arbitrage requires >0.32% spread (Solend fee + gas)');
  console.log('');
  
  if (stats.opportunitiesFound === 0) {
    console.log('📈 MARKET ANALYSIS:');
    console.log('   No profitable opportunities found during this period.');
    console.log('   This is NORMAL - Solana markets are highly efficient.');
    console.log('   Professional market makers capture most arbitrage.');
    console.log('');
    console.log('💡 REALISTIC EXPECTATIONS:');
    console.log('   - Simple token arbitrage: ~0% return (too competitive)');
    console.log('   - New token sniping: High risk, occasional wins');
    console.log('   - Flash loans: Need 0.32%+ spread (rare)');
    console.log('');
  }
}

// Run
runBacktest().catch(console.error);
