#!/usr/bin/env node
/**
 * 📊 Stats Verification & Opportunity Analyzer
 * 
 * Checks:
 * - Real win/loss statistics from all position files
 * - Current filter settings and their impact
 * - How many tokens are being rejected and why
 * - Recommendations to increase opportunities
 */

import fs from 'fs';
import fetch from 'node-fetch';
import { analyzeToken } from './ml-predictor.mjs';
import { rugShieldCheck } from './rug-shield.mjs';

const SOL_PRICE = 120;

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY ACTUAL STATS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════');
console.log('📊 TRADE STATISTICS VERIFICATION');
console.log('═══════════════════════════════════════════════════════════\n');

const posFiles = ['positions.json', 'positions-safe.json', 'positions-fl.json', 'positions-flashloan.json', 'positions-live.json'];

let totalTrades = 0;
let wins = 0;
let losses = 0;
let totalProfitSOL = 0;
let totalLossSOL = 0;
let winSizes = [];
let lossSizes = [];
let tradeDetails = [];

for (const file of posFiles) {
  if (!fs.existsSync(file)) continue;
  
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.positions || !Array.isArray(data.positions)) continue;
    
    console.log(`\n📁 Analyzing ${file}...`);
    
    for (const pos of data.positions) {
      const isArray = Array.isArray(pos);
      const p = isArray ? pos[1] : pos;
      
      if (p.status === 'CLOSED' && p.profit !== undefined) {
        totalTrades++;
        const profitSOL = parseFloat(p.profit);
        const profitUSD = profitSOL * SOL_PRICE;
        const profitPct = parseFloat(p.profitPct) || 0;
        
        tradeDetails.push({
          symbol: p.symbol || 'UNKNOWN',
          profitSOL,
          profitUSD,
          profitPct,
          file
        });
        
        if (profitSOL > 0) {
          wins++;
          winSizes.push(profitUSD);
          totalProfitSOL += profitSOL;
        } else {
          losses++;
          lossSizes.push(Math.abs(profitUSD));
          totalLossSOL += Math.abs(profitSOL);
        }
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Error reading ${file}: ${e.message}`);
  }
}

console.log('\n' + '─'.repeat(60));
console.log('VERIFIED STATISTICS');
console.log('─'.repeat(60));

const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
const avgWinSize = winSizes.length > 0 ? winSizes.reduce((a, b) => a + b, 0) / winSizes.length : 0;
const avgLossSize = lossSizes.length > 0 ? lossSizes.reduce((a, b) => a + b, 0) / lossSizes.length : 0;
const totalProfitUSD = totalProfitSOL * SOL_PRICE;
const totalLossUSD = totalLossSOL * SOL_PRICE;
const netPnL = (totalProfitSOL - totalLossSOL) * SOL_PRICE;

console.log(`\nTotal Trades:    ${totalTrades}`);
console.log(`Wins:            ${wins} (${winRate.toFixed(1)}%)`);
console.log(`Losses:          ${losses} (${(100 - winRate).toFixed(1)}%)`);
console.log(`\nAverage Win:     +$${avgWinSize.toFixed(2)}`);
console.log(`Average Loss:    -$${avgLossSize.toFixed(2)}`);
console.log(`\nTotal Profits:   +$${totalProfitUSD.toFixed(2)}`);
console.log(`Total Losses:    -$${totalLossUSD.toFixed(2)}`);
console.log(`Net P&L:         ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

// Expectancy calculation
const expectancy = (avgWinSize * (winRate / 100)) - (avgLossSize * ((100 - winRate) / 100));
console.log(`\nExpectancy:      ${expectancy >= 0 ? '+' : ''}$${expectancy.toFixed(2)} per trade`);

if (expectancy > 0) {
  console.log(`✅ PROFITABLE: You make $${expectancy.toFixed(2)} on average per trade`);
} else {
  console.log(`❌ UNPROFITABLE: You lose $${Math.abs(expectancy).toFixed(2)} on average per trade`);
}

// Show top 5 wins and losses
console.log('\n' + '─'.repeat(60));
console.log('TOP 5 WINS');
console.log('─'.repeat(60));
const topWins = tradeDetails.filter(t => t.profitSOL > 0).sort((a, b) => b.profitUSD - a.profitUSD).slice(0, 5);
topWins.forEach((t, i) => {
  console.log(`${i + 1}. ${t.symbol.padEnd(15)} +$${t.profitUSD.toFixed(2)} (+${t.profitPct.toFixed(1)}%)`);
});

console.log('\n' + '─'.repeat(60));
console.log('TOP 5 LOSSES');
console.log('─'.repeat(60));
const topLosses = tradeDetails.filter(t => t.profitSOL < 0).sort((a, b) => a.profitUSD - b.profitUSD).slice(0, 5);
topLosses.forEach((t, i) => {
  console.log(`${i + 1}. ${t.symbol.padEnd(15)} -$${Math.abs(t.profitUSD).toFixed(2)} (${t.profitPct.toFixed(1)}%)`);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST CURRENT FILTERS ON LIVE TOKENS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('🔍 OPPORTUNITY ANALYSIS - Testing Live Tokens');
console.log('═══════════════════════════════════════════════════════════\n');

const CURRENT_FILTERS = {
  MIN_LIQUIDITY_USD: 200,
  MIN_ML_SCORE: 0.4,
  MAX_RUG_RISK: 0.8
};

console.log('Current Filter Settings:');
console.log(`  Min Liquidity:   $${CURRENT_FILTERS.MIN_LIQUIDITY_USD}`);
console.log(`  Min ML Score:    ${(CURRENT_FILTERS.MIN_ML_SCORE * 100).toFixed(0)}%`);
console.log(`  Max Rug Risk:    ${(CURRENT_FILTERS.MAX_RUG_RISK * 100).toFixed(0)}%`);

console.log('\nFetching live tokens...\n');

try {
  // Test from multiple sources
  const sources = [
    { name: 'DexScreener Boosted', url: 'https://api.dexscreener.com/token-boosts/latest/v1' },
    { name: 'DexScreener Trending', url: 'https://api.dexscreener.com/latest/dex/tokens/solana' }
  ];
  
  let totalTokensFound = 0;
  let rejectionReasons = {
    lowLiquidity: 0,
    lowMLScore: 0,
    highRugRisk: 0,
    rugShieldBlocked: 0,
    passed: 0
  };
  
  const passedTokens = [];
  
  for (const source of sources) {
    console.log(`\n📡 Checking ${source.name}...`);
    
    try {
      const res = await fetch(source.url);
      const data = await res.json();
      
      let tokens = [];
      if (source.name.includes('Boosted')) {
        tokens = data.filter(t => t.chainId === 'solana').slice(0, 10);
      } else {
        tokens = data.pairs ? data.pairs.slice(0, 10) : [];
      }
      
      totalTokensFound += tokens.length;
      console.log(`   Found ${tokens.length} tokens`);
      
      for (const token of tokens) {
        const mint = source.name.includes('Boosted') ? token.tokenAddress : token.baseToken?.address;
        if (!mint) continue;
        
        // Get token data
        const tokenRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        const tokenData = await tokenRes.json();
        const pair = tokenData.pairs?.[0];
        
        if (!pair) continue;
        
        const symbol = pair.baseToken?.symbol || 'UNKNOWN';
        const liquidity = parseFloat(pair.liquidity?.usd || 0);
        const volume = parseFloat(pair.volume?.h24 || 0);
        
        // Test liquidity filter
        if (liquidity < CURRENT_FILTERS.MIN_LIQUIDITY_USD) {
          rejectionReasons.lowLiquidity++;
          continue;
        }
        
        // Test ML filter
        const mlData = {
          liquidity,
          volume,
          ageHours: 0.5,
          priceVelocity: Math.abs(parseFloat(pair.priceChange?.m5 || 0)) / 100,
          volumeSpike: volume > liquidity * 2 ? 0.8 : 0.3,
          holderConcentration: 0.5
        };
        
        const mlResult = analyzeToken(mlData);
        
        if (mlResult.score < CURRENT_FILTERS.MIN_ML_SCORE) {
          rejectionReasons.lowMLScore++;
          console.log(`   ❌ ${symbol}: ML score ${(mlResult.score * 100).toFixed(0)}% (need ${(CURRENT_FILTERS.MIN_ML_SCORE * 100).toFixed(0)}%)`);
          continue;
        }
        
        if (mlResult.rugRisk > CURRENT_FILTERS.MAX_RUG_RISK) {
          rejectionReasons.highRugRisk++;
          console.log(`   ❌ ${symbol}: Rug risk ${(mlResult.rugRisk * 100).toFixed(0)}% (max ${(CURRENT_FILTERS.MAX_RUG_RISK * 100).toFixed(0)}%)`);
          continue;
        }
        
        // Test Rug Shield (this is slow, so we limit it)
        console.log(`   🛡️ Testing ${symbol} with Rug Shield...`);
        const rugCheck = await rugShieldCheck(mint, symbol);
        
        if (!rugCheck.isSafe) {
          rejectionReasons.rugShieldBlocked++;
          console.log(`   🚫 ${symbol}: ${rugCheck.recommendation}`);
          continue;
        }
        
        // PASSED ALL FILTERS
        rejectionReasons.passed++;
        passedTokens.push({
          symbol,
          liquidity,
          mlScore: mlResult.score,
          rugRisk: mlResult.rugRisk,
          recommendation: rugCheck.recommendation
        });
        console.log(`   ✅ ${symbol}: PASSED - ML ${(mlResult.score * 100).toFixed(0)}%, Liq $${liquidity.toFixed(0)}`);
        
        await new Promise(r => setTimeout(r, 500)); // Rate limit
      }
      
    } catch (e) {
      console.log(`   ⚠️ Error: ${e.message}`);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('FILTER IMPACT ANALYSIS');
  console.log('─'.repeat(60));
  console.log(`\nTokens Evaluated:     ${totalTokensFound}`);
  console.log(`\nRejection Breakdown:`);
  console.log(`  Low Liquidity (<$${CURRENT_FILTERS.MIN_LIQUIDITY_USD}):  ${rejectionReasons.lowLiquidity} (${(rejectionReasons.lowLiquidity / totalTokensFound * 100).toFixed(1)}%)`);
  console.log(`  Low ML Score (<${(CURRENT_FILTERS.MIN_ML_SCORE * 100).toFixed(0)}%):   ${rejectionReasons.lowMLScore} (${(rejectionReasons.lowMLScore / totalTokensFound * 100).toFixed(1)}%)`);
  console.log(`  High Rug Risk (>${(CURRENT_FILTERS.MAX_RUG_RISK * 100).toFixed(0)}%):  ${rejectionReasons.highRugRisk} (${(rejectionReasons.highRugRisk / totalTokensFound * 100).toFixed(1)}%)`);
  console.log(`  Rug Shield Blocked:    ${rejectionReasons.rugShieldBlocked} (${(rejectionReasons.rugShieldBlocked / totalTokensFound * 100).toFixed(1)}%)`);
  console.log(`\n✅ PASSED ALL FILTERS:   ${rejectionReasons.passed} (${(rejectionReasons.passed / totalTokensFound * 100).toFixed(1)}%)`);
  
  if (passedTokens.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('TOKENS READY TO TRADE NOW');
    console.log('─'.repeat(60));
    passedTokens.forEach((t, i) => {
      console.log(`\n${i + 1}. ${t.symbol}`);
      console.log(`   Liquidity:  $${t.liquidity.toFixed(0)}`);
      console.log(`   ML Score:   ${(t.mlScore * 100).toFixed(0)}%`);
      console.log(`   Rug Risk:   ${(t.rugRisk * 100).toFixed(0)}%`);
      console.log(`   Status:     ${t.recommendation}`);
    });
  } else {
    console.log('\n⚠️ NO TOKENS PASSED - All were filtered out!');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('💡 RECOMMENDATIONS TO INCREASE OPPORTUNITIES');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (rejectionReasons.passed === 0) {
  console.log('🚨 CRITICAL: No tokens are passing your filters!\n');
  
  if (rejectionReasons.lowMLScore > rejectionReasons.lowLiquidity) {
    console.log('Main Issue: ML Score too strict');
    console.log(`   ${rejectionReasons.lowMLScore} tokens rejected for low ML score`);
    console.log('   Recommendation: Lower MIN_ML_SCORE from 0.4 to 0.3 (30%)');
    console.log('   Edit live-trader.mjs line 30: MIN_ML_SCORE: 0.3,');
  } else if (rejectionReasons.lowLiquidity > rejectionReasons.lowMLScore) {
    console.log('Main Issue: Liquidity requirement too high');
    console.log(`   ${rejectionReasons.lowLiquidity} tokens rejected for low liquidity`);
    console.log('   Recommendation: Lower MIN_LIQUIDITY_USD from 200 to 100');
    console.log('   Edit live-trader.mjs line 29: MIN_LIQUIDITY_USD: 100,');
  }
  
  if (rejectionReasons.rugShieldBlocked > 5) {
    console.log('\nSecondary Issue: Rug Shield blocking many tokens');
    console.log(`   ${rejectionReasons.rugShieldBlocked} tokens blocked by Rug Shield`);
    console.log('   This is actually GOOD - these are likely scams');
  }
  
} else if (rejectionReasons.passed < 3) {
  console.log('⚠️ Few opportunities found - consider loosening filters slightly\n');
  console.log('Suggestions:');
  console.log('  1. Lower ML score: 40% → 35%');
  console.log('  2. Lower liquidity: $200 → $150');
  console.log('  3. This will increase from ~10% pass rate to ~20-30%');
  
} else {
  console.log('✅ Good opportunity flow!\n');
  console.log(`Found ${rejectionReasons.passed} tradeable tokens from ${totalTokensFound} scanned`);
  console.log(`Pass rate: ${(rejectionReasons.passed / totalTokensFound * 100).toFixed(1)}%`);
  console.log('\nNo changes needed - bot should find trades regularly.');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('📈 PROFITABILITY PROJECTION');
console.log('═══════════════════════════════════════════════════════════\n');

if (totalTrades > 0 && expectancy !== 0) {
  const tradesPerDay = 5; // Estimate
  const dailyExpectancy = expectancy * tradesPerDay;
  const weeklyExpectancy = dailyExpectancy * 7;
  
  console.log(`Based on your ${totalTrades} trades history:`);
  console.log(`  Expectancy:    ${expectancy >= 0 ? '+' : ''}$${expectancy.toFixed(2)} per trade`);
  console.log(`  Win Rate:      ${winRate.toFixed(1)}%`);
  console.log(`\nProjections (at ~${tradesPerDay} trades/day):`);
  console.log(`  Daily:         ${dailyExpectancy >= 0 ? '+' : ''}$${dailyExpectancy.toFixed(2)}`);
  console.log(`  Weekly:        ${weeklyExpectancy >= 0 ? '+' : ''}$${weeklyExpectancy.toFixed(2)}`);
  
  const daysToLossLimit = expectancy < 0 ? (20 / Math.abs(dailyExpectancy)) : Infinity;
  if (expectancy < 0 && daysToLossLimit < 30) {
    console.log(`\n⚠️ Warning: At current performance, you'll hit $20 loss limit in ~${Math.round(daysToLossLimit)} days`);
  }
}

} catch (e) {
  console.log(`\n❌ Error during opportunity analysis: ${e.message}`);
}

console.log('\n');
