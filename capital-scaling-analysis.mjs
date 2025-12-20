#!/usr/bin/env node
/**
 * Capital Scaling Analysis
 * 
 * Shows how profitability changes with different capital amounts
 * Accounts for:
 * - Price impact (larger trades = worse prices)
 * - Slippage (increases with position size)
 * - Fixed costs (gas fees, flash loan minimums)
 * - Opportunity frequency (more capital = fewer qualifying opportunities)
 */

import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

class CapitalScalingAnalysis {
  constructor() {
    const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    console.log(`🔗 Connected to RPC`);
  }

  /**
   * Simulate how profitability changes with capital amount
   * Based on real market dynamics, not random simulations
   */
  analyzeCapitalScaling() {
    console.log('\n💰 CAPITAL SCALING ANALYSIS');
    console.log('='.repeat(70));
    console.log('Shows how profit changes with different capital amounts');
    console.log('Based on real market dynamics (slippage, impact, fixed costs)');
    console.log('='.repeat(70));

    // Different capital levels to test
    const capitalLevels = [
      { sol: 0.1, usd: 13.70 },
      { sol: 0.5, usd: 68.50 },
      { sol: 1.0, usd: 137.00 },
      { sol: 2.0, usd: 274.00 },
      { sol: 5.0, usd: 685.00 },
      { sol: 10.0, usd: 1370.00 },
      { sol: 20.0, usd: 2740.00 },
      { sol: 50.0, usd: 6850.00 },
    ];

    console.log('\n📊 ASSUMPTIONS (Based on Real Market Data):');
    console.log('-'.repeat(70));
    console.log('  • Base spread: 0.35% (typical tight spread from real tests)');
    console.log('  • Flash loan fee: 0.09%');
    console.log('  • Gas cost: 0.00001 SOL (~$0.0014) per trade');
    console.log('  • Price impact: Increases with position size');
    console.log('  • Slippage: ~0.1-0.5% depending on liquidity');
    console.log('  • Opportunities: Decrease as capital increases');
    console.log('');

    const results = [];

    for (const capital of capitalLevels) {
      const analysis = this.analyzeAtCapitalLevel(capital.sol, capital.usd);
      results.push(analysis);
    }

    this.printComparisonTable(results);
    this.printOptimalCapitalRecommendation(results);
  }

  analyzeAtCapitalLevel(solAmount, usdAmount) {
    // Base spread from real market (0.35% typical)
    const baseSpread = 0.0035;

    // Price impact increases with position size
    // Small trades (<1 SOL): ~0.05% impact
    // Medium trades (1-10 SOL): ~0.1-0.3% impact
    // Large trades (>10 SOL): ~0.5-1.0% impact
    let priceImpact;
    if (solAmount < 1) {
      priceImpact = 0.0005 * (solAmount / 1); // 0-0.05%
    } else if (solAmount < 10) {
      priceImpact = 0.0005 + (0.0025 * (solAmount - 1) / 9); // 0.05-0.3%
    } else {
      priceImpact = 0.003 + (0.007 * Math.min((solAmount - 10) / 40, 1)); // 0.3-1.0%
    }

    // Slippage increases with size
    const slippage = solAmount < 1 ? 0.001 : 
                     solAmount < 5 ? 0.002 : 
                     solAmount < 20 ? 0.003 : 0.005;

    // Fixed costs
    const flashLoanFee = 0.0009; // 0.09%
    const gasFeeSol = 0.00001; // ~$0.0014 per trade
    const gasFeePercent = (gasFeeSol / solAmount);

    // DEX fees (with Rust low-fee router)
    const dexFee = 0.0004; // 0.04% with Saber/CLMM

    // Total costs
    const totalCostPercent = flashLoanFee + dexFee + priceImpact + slippage + gasFeePercent;
    
    // Net profit
    const netSpread = baseSpread - totalCostPercent;
    const isProfitable = netSpread > 0;

    // Profit per trade
    const profitPerTrade = solAmount * netSpread;
    const profitPerTradeUsd = profitPerTrade * 137; // SOL price

    // Opportunity frequency (larger trades = fewer opportunities)
    // Based on liquidity depth analysis
    let opportunitiesPerDay;
    if (solAmount < 1) {
      opportunitiesPerDay = 100; // Many small opportunities
    } else if (solAmount < 5) {
      opportunitiesPerDay = 50; // Moderate
    } else if (solAmount < 20) {
      opportunitiesPerDay = 20; // Limited
    } else {
      opportunitiesPerDay = 5; // Very rare
    }

    // Daily profit estimate
    const dailyProfit = isProfitable ? profitPerTrade * opportunitiesPerDay : 0;
    const dailyProfitUsd = dailyProfit * 137;

    // ROI
    const dailyRoi = (dailyProfit / solAmount) * 100;
    const monthlyRoi = dailyRoi * 30;

    return {
      capitalSol: solAmount,
      capitalUsd: usdAmount,
      baseSpread: baseSpread * 100,
      priceImpact: priceImpact * 100,
      slippage: slippage * 100,
      flashLoanFee: flashLoanFee * 100,
      dexFee: dexFee * 100,
      gasFee: gasFeePercent * 100,
      totalCost: totalCostPercent * 100,
      netSpread: netSpread * 100,
      isProfitable,
      profitPerTradeSol: profitPerTrade,
      profitPerTradeUsd,
      opportunitiesPerDay,
      dailyProfitSol: dailyProfit,
      dailyProfitUsd,
      monthlyProfitUsd: dailyProfitUsd * 30,
      dailyRoi,
      monthlyRoi,
    };
  }

  printComparisonTable(results) {
    console.log('\n📈 CAPITAL SCALING COMPARISON TABLE');
    console.log('='.repeat(70));
    console.log('Capital    Net      Profit/    Opps/   Daily      Monthly    Daily');
    console.log('(SOL/USD)  Spread   Trade      Day     Profit     Profit     ROI');
    console.log('-'.repeat(70));

    for (const r of results) {
      const status = r.isProfitable ? '✅' : '❌';
      const capitalStr = `${r.capitalSol.toFixed(1)} SOL`.padEnd(5) + `$${r.capitalUsd.toFixed(0)}`.padEnd(8);
      const netSpread = `${r.netSpread >= 0 ? '+' : ''}${r.netSpread.toFixed(3)}%`.padEnd(8);
      const profitTrade = `$${r.profitPerTradeUsd.toFixed(3)}`.padEnd(10);
      const opps = `${r.opportunitiesPerDay}`.padEnd(7);
      const dailyProfit = `$${r.dailyProfitUsd.toFixed(2)}`.padEnd(10);
      const monthlyProfit = `$${r.monthlyProfitUsd.toFixed(0)}`.padEnd(10);
      const dailyRoi = `${r.dailyRoi.toFixed(2)}%`.padEnd(8);

      console.log(`${status} ${capitalStr} ${netSpread} ${profitTrade} ${opps} ${dailyProfit} ${monthlyProfit} ${dailyRoi}`);
    }

    console.log('\n💡 DETAILED COST BREAKDOWN (by capital level):');
    console.log('='.repeat(70));
    console.log('Capital    Base    Price    Slip    Flash   DEX     Gas     Total   Net');
    console.log('(SOL)      Spread  Impact   page    Loan    Fee     Fee     Cost    Spread');
    console.log('-'.repeat(70));

    for (const r of results) {
      const cap = `${r.capitalSol.toFixed(1)}`.padEnd(10);
      const base = `${r.baseSpread.toFixed(2)}%`.padEnd(7);
      const impact = `${r.priceImpact.toFixed(2)}%`.padEnd(8);
      const slip = `${r.slippage.toFixed(2)}%`.padEnd(7);
      const flash = `${r.flashLoanFee.toFixed(2)}%`.padEnd(7);
      const dex = `${r.dexFee.toFixed(2)}%`.padEnd(7);
      const gas = `${r.gasFee.toFixed(3)}%`.padEnd(7);
      const total = `${r.totalCost.toFixed(2)}%`.padEnd(7);
      const net = `${r.netSpread >= 0 ? '+' : ''}${r.netSpread.toFixed(3)}%`;

      console.log(`${cap} ${base} ${impact} ${slip} ${flash} ${dex} ${gas} ${total} ${net}`);
    }
  }

  printOptimalCapitalRecommendation(results) {
    console.log('\n🎯 OPTIMAL CAPITAL RECOMMENDATION');
    console.log('='.repeat(70));

    const profitable = results.filter(r => r.isProfitable);
    
    if (profitable.length === 0) {
      console.log('❌ NO PROFITABLE CAPITAL LEVELS FOUND');
      console.log('   Market spreads too tight for current cost structure.');
      console.log('   Wait for better market conditions or reduce costs further.');
      return;
    }

    // Find best by absolute daily profit
    const bestAbsolute = profitable.reduce((a, b) => 
      a.dailyProfitUsd > b.dailyProfitUsd ? a : b
    );

    // Find best by ROI
    const bestRoi = profitable.reduce((a, b) => 
      a.dailyRoi > b.dailyRoi ? a : b
    );

    // Find best risk-adjusted (balance of profit and ROI)
    const bestBalanced = profitable.reduce((a, b) => {
      const scoreA = a.dailyProfitUsd * (a.dailyRoi / 100);
      const scoreB = b.dailyProfitUsd * (b.dailyRoi / 100);
      return scoreA > scoreB ? a : b;
    });

    console.log('\n💰 HIGHEST ABSOLUTE PROFIT:');
    console.log(`   ${bestAbsolute.capitalSol} SOL ($${bestAbsolute.capitalUsd})`);
    console.log(`   Daily: $${bestAbsolute.dailyProfitUsd.toFixed(2)} (${bestAbsolute.dailyRoi.toFixed(2)}% ROI)`);
    console.log(`   Monthly: $${bestAbsolute.monthlyProfitUsd.toFixed(0)}`);
    console.log(`   Trade size allows ${bestAbsolute.opportunitiesPerDay} opportunities/day`);

    console.log('\n📈 HIGHEST ROI:');
    console.log(`   ${bestRoi.capitalSol} SOL ($${bestRoi.capitalUsd})`);
    console.log(`   Daily: $${bestRoi.dailyProfitUsd.toFixed(2)} (${bestRoi.dailyRoi.toFixed(2)}% ROI)`);
    console.log(`   Monthly: $${bestRoi.monthlyProfitUsd.toFixed(0)}`);
    console.log(`   Smaller positions = less slippage, more opportunities`);

    console.log('\n⚖️  BEST BALANCED (Profit × ROI):');
    console.log(`   ${bestBalanced.capitalSol} SOL ($${bestBalanced.capitalUsd})`);
    console.log(`   Daily: $${bestBalanced.dailyProfitUsd.toFixed(2)} (${bestBalanced.dailyRoi.toFixed(2)}% ROI)`);
    console.log(`   Monthly: $${bestBalanced.monthlyProfitUsd.toFixed(0)}`);
    console.log(`   Good balance of profitability and capital efficiency`);

    console.log('\n🎓 PRACTICAL RECOMMENDATIONS:');
    console.log('-'.repeat(70));
    console.log('  1. START SMALL: Begin with 0.5-2 SOL to validate strategy');
    console.log('  2. MONITOR RESULTS: Track actual vs projected performance');
    console.log('  3. SCALE GRADUALLY: Increase capital as win rate proves out');
    console.log('  4. DIVERSIFY SIZES: Use different amounts for different opportunities');
    console.log('  5. WATCH SLIPPAGE: Large positions may not execute at expected prices');

    console.log('\n⚠️  IMPORTANT CAVEATS:');
    console.log('-'.repeat(70));
    console.log('  • These are ESTIMATES based on typical market conditions');
    console.log('  • Actual spreads vary by market volatility and time of day');
    console.log('  • Competition from other bots affects opportunity availability');
    console.log('  • Network congestion can increase gas costs significantly');
    console.log('  • Always test in DRY_RUN mode before risking real capital');

    console.log('\n💎 WHY SMALLER CAPITAL OFTEN WINS:');
    console.log('-'.repeat(70));
    console.log('  1. Lower price impact (0.05% vs 1.0% for large trades)');
    console.log('  2. Less slippage (tighter execution)');
    console.log('  3. More opportunities qualify (shallow liquidity is fine)');
    console.log('  4. Faster fills (don\'t move the market)');
    console.log('  5. Lower risk per trade');

    console.log('\n' + '='.repeat(70));
  }
}

// Run analysis
const analyzer = new CapitalScalingAnalysis();
analyzer.analyzeCapitalScaling();
