#!/usr/bin/env node
/**
 * 🧠 ENHANCED ML ANALYZER
 * 
 * - Tracks rug pull timing patterns
 * - Analyzes price velocity before rugs
 * - Learns from historical data
 * - Shows model accuracy and insights
 */
import fs from 'fs';
import fetch from 'node-fetch';

const ML_DATA_FILE = 'ml-training-data.json';
const MODEL_FILE = 'ml-model.json';
const RUG_DATA_FILE = 'rug-patterns.json';

// === LOAD DATA ===
function loadData(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return defaultVal;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === ANALYZE CURRENT MODEL ===
async function analyzeModel() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🧠 ML MODEL ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const model = loadData(MODEL_FILE, null);
  const trainingData = loadData(ML_DATA_FILE, { trades: [] });
  const rugPatterns = loadData(RUG_DATA_FILE, { rugs: [], stats: {} });
  
  // Model weights
  console.log('📊 CURRENT MODEL WEIGHTS:');
  console.log('─────────────────────────────────────────');
  if (model?.weights) {
    for (const [feature, weight] of Object.entries(model.weights)) {
      const bar = '█'.repeat(Math.abs(Math.round(weight * 20)));
      const sign = weight >= 0 ? '+' : '-';
      console.log(`  ${feature.padEnd(22)} ${sign}${Math.abs(weight).toFixed(3)} ${bar}`);
    }
  } else {
    console.log('  No model found - needs training');
  }
  
  // Model stats
  console.log('\n📈 MODEL ACCURACY:');
  console.log('─────────────────────────────────────────');
  if (model?.stats) {
    console.log(`  Total Predictions: ${model.stats.totalPredictions}`);
    console.log(`  Correct: ${model.stats.correctPredictions}`);
    console.log(`  Accuracy: ${model.stats.accuracy}%`);
    
    const acc = parseFloat(model.stats.accuracy);
    if (acc < 50) console.log('  ⚠️ BELOW RANDOM - Model needs more training!');
    else if (acc < 60) console.log('  🟡 MARGINAL - Slightly better than random');
    else if (acc < 70) console.log('  🟢 DECENT - Model is learning');
    else console.log('  ✅ GOOD - Model is performing well');
  }
  
  // Training data analysis
  console.log('\n📚 TRAINING DATA:');
  console.log('─────────────────────────────────────────');
  const trades = trainingData.trades || [];
  console.log(`  Total trades recorded: ${trades.length}`);
  
  if (trades.length > 0) {
    const profits = trades.filter(t => t.profitPct > 0);
    const losses = trades.filter(t => t.profitPct <= 0);
    const rugs = trades.filter(t => t.profitPct < -20);
    
    console.log(`  Profitable: ${profits.length} (${((profits.length/trades.length)*100).toFixed(1)}%)`);
    console.log(`  Losses: ${losses.length} (${((losses.length/trades.length)*100).toFixed(1)}%)`);
    console.log(`  Rugs (<-20%): ${rugs.length} (${((rugs.length/trades.length)*100).toFixed(1)}%)`);
    
    // Average hold times
    const avgHoldWin = profits.length > 0 
      ? profits.reduce((a, b) => a + b.holdTime, 0) / profits.length / 1000 
      : 0;
    const avgHoldLoss = losses.length > 0 
      ? losses.reduce((a, b) => a + b.holdTime, 0) / losses.length / 1000 
      : 0;
    const avgHoldRug = rugs.length > 0 
      ? rugs.reduce((a, b) => a + b.holdTime, 0) / rugs.length / 1000 
      : 0;
    
    console.log(`\n  ⏱️ TIMING PATTERNS:`);
    console.log(`  Avg hold (wins): ${avgHoldWin.toFixed(1)}s`);
    console.log(`  Avg hold (losses): ${avgHoldLoss.toFixed(1)}s`);
    console.log(`  Avg hold (rugs): ${avgHoldRug.toFixed(1)}s`);
    
    // Liquidity analysis
    const avgLiqWin = profits.length > 0 
      ? profits.reduce((a, b) => a + b.liquidity, 0) / profits.length 
      : 0;
    const avgLiqLoss = losses.length > 0 
      ? losses.reduce((a, b) => a + b.liquidity, 0) / losses.length 
      : 0;
    
    console.log(`\n  💧 LIQUIDITY PATTERNS:`);
    console.log(`  Avg liquidity (wins): $${avgLiqWin.toFixed(0)}`);
    console.log(`  Avg liquidity (losses): $${avgLiqLoss.toFixed(0)}`);
    
    // Identify patterns
    console.log('\n  🎯 KEY INSIGHTS:');
    if (avgLiqWin > avgLiqLoss * 1.2) {
      console.log('  ✅ Higher liquidity → Better outcomes');
    }
    if (avgHoldRug < 10) {
      console.log('  ⚠️ Rugs happen FAST (<10s) - need quicker exits');
    }
    if (avgHoldWin < avgHoldLoss) {
      console.log('  ✅ Winners exit faster than losers');
    }
  }
  
  return { model, trainingData };
}

// === LIVE RUG TRACKER ===
async function trackRugPatterns() {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🔴 LIVE RUG PATTERN TRACKER');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('Monitoring tokens for rug patterns...\n');
  
  let rugData = loadData(RUG_DATA_FILE, { 
    rugs: [], 
    stats: { 
      totalTracked: 0,
      totalRugs: 0,
      avgTimeToRug: 0,
      avgDropPct: 0 
    } 
  });
  
  const trackedTokens = new Map();
  
  async function scan() {
    try {
      const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      const tokens = await res.json();
      const solTokens = tokens.filter(t => t.chainId === 'solana').slice(0, 15);
      
      for (const token of solTokens) {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
        const pairData = await pairRes.json();
        const pair = pairData.pairs?.[0];
        if (!pair) continue;
        
        const mint = token.tokenAddress;
        const symbol = pair.baseToken?.symbol || 'UNKNOWN';
        const liq = pair.liquidity?.usd || 0;
        const price5m = pair.priceChange?.m5 || 0;
        const price1h = pair.priceChange?.h1 || 0;
        
        // Track new tokens
        if (!trackedTokens.has(mint)) {
          trackedTokens.set(mint, {
            symbol,
            startTime: Date.now(),
            startLiq: liq,
            startPrice5m: price5m,
            peakPrice: 0,
            rugged: false,
          });
          rugData.stats.totalTracked++;
          console.log(`👀 Tracking: ${symbol} | Liq: $${(liq/1000).toFixed(1)}K | 5min: ${price5m >= 0 ? '+' : ''}${price5m.toFixed(1)}%`);
        }
        
        const tracked = trackedTokens.get(mint);
        
        // Update peak
        if (price5m > tracked.peakPrice) {
          tracked.peakPrice = price5m;
        }
        
        // Detect rug (>50% drop in 5min or >80% drop in 1hr)
        if (!tracked.rugged && (price5m < -50 || price1h < -80)) {
          tracked.rugged = true;
          const timeToRug = (Date.now() - tracked.startTime) / 1000;
          
          console.log(`\n🔴 RUG DETECTED: ${symbol}`);
          console.log(`   Time to rug: ${timeToRug.toFixed(1)}s`);
          console.log(`   Drop: ${price5m.toFixed(1)}% (5min) | ${price1h.toFixed(1)}% (1hr)`);
          console.log(`   Peak before rug: +${tracked.peakPrice.toFixed(1)}%`);
          console.log(`   Liquidity: $${(liq/1000).toFixed(1)}K (was $${(tracked.startLiq/1000).toFixed(1)}K)`);
          
          // Record rug pattern
          rugData.rugs.push({
            symbol,
            mint,
            timeToRug,
            dropPct5m: price5m,
            dropPct1h: price1h,
            peakBeforeRug: tracked.peakPrice,
            startLiquidity: tracked.startLiq,
            endLiquidity: liq,
            timestamp: Date.now(),
          });
          
          rugData.stats.totalRugs++;
          rugData.stats.avgTimeToRug = rugData.rugs.reduce((a, b) => a + b.timeToRug, 0) / rugData.rugs.length;
          rugData.stats.avgDropPct = rugData.rugs.reduce((a, b) => a + Math.abs(b.dropPct5m), 0) / rugData.rugs.length;
          
          saveData(RUG_DATA_FILE, rugData);
          
          console.log(`\n📊 Rug Stats: ${rugData.stats.totalRugs}/${rugData.stats.totalTracked} tokens rugged`);
          console.log(`   Avg time to rug: ${rugData.stats.avgTimeToRug.toFixed(1)}s`);
          console.log(`   Avg drop: -${rugData.stats.avgDropPct.toFixed(1)}%`);
        }
        
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e) {
      console.log('Scan error:', e.message);
    }
  }
  
  // Run continuously
  console.log('Press Ctrl+C to stop and save data\n');
  
  while (true) {
    await scan();
    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Tracking ${trackedTokens.size} tokens | Rugs detected: ${rugData.stats.totalRugs}`);
    await new Promise(r => setTimeout(r, 10000));
  }
}

// === MAIN ===
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--track') || args.includes('-t')) {
    // Live tracking mode
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Tracker stopped - data saved to rug-patterns.json');
      process.exit(0);
    });
    await trackRugPatterns();
  } else {
    // Analysis mode
    await analyzeModel();
    
    // Show rug pattern stats if available
    const rugData = loadData(RUG_DATA_FILE, null);
    if (rugData?.rugs?.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('🔴 RUG PATTERN ANALYSIS');
      console.log('═══════════════════════════════════════════════════════════════════\n');
      
      console.log(`Total rugs tracked: ${rugData.rugs.length}`);
      console.log(`Avg time to rug: ${rugData.stats.avgTimeToRug?.toFixed(1) || 0}s`);
      console.log(`Avg drop: -${rugData.stats.avgDropPct?.toFixed(1) || 0}%`);
      
      console.log('\nRecent rugs:');
      for (const rug of rugData.rugs.slice(-5)) {
        console.log(`  ${rug.symbol}: -${Math.abs(rug.dropPct5m).toFixed(1)}% in ${rug.timeToRug.toFixed(1)}s | Peak: +${rug.peakBeforeRug.toFixed(1)}%`);
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('Run with --track to start live rug tracking');
    console.log('═══════════════════════════════════════════════════════════════════\n');
  }
}

main().catch(console.error);
