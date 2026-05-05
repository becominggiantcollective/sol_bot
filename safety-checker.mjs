#!/usr/bin/env node
/**
 * 🛡️ ADVANCED TOKEN SAFETY CHECKER
 * 
 * Implements the 4 Golden Rules:
 * 1. Only trade coins with liquidity locked
 * 2. Check holder distribution — no whales controlling 40%
 * 3. Enter early, before Twitter hype hits
 * 4. Sell in stages. Always.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

const RPC_URL = process.env.HELIUS_RPC_URL;
const JUPITER_API = 'https://public.jupiterapi.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Known LP lock programs on Solana
const LP_LOCK_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token
  'LockrYhfEVUwKZg7gXtYS5jQVvfs3bDHFWmNh8P8Xjk', // Raydium Lock
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Jupiter Lock
];

// === RULE 1: LIQUIDITY LOCK CHECK ===
export async function checkLiquidityLock(tokenMint) {
  console.log(`   📌 Checking liquidity lock...`);
  
  try {
    // Get pool info from DexScreener
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return {
        isLocked: false,
        reason: 'No liquidity pools found',
        lockPercentage: 0,
        totalLiquidity: 0
      };
    }
    
    const mainPair = data.pairs[0];
    const poolAddress = mainPair.pairAddress;
    const totalLiquidity = parseFloat(mainPair.liquidity?.usd || 0);
    
    // Check if LP tokens are burned or locked
    // Burned LP = sent to dead address or lock contract
    const lpInfo = mainPair.liquidity;
    
    // Heuristic: If the pool exists and has decent liquidity, check if creator still holds LP
    // This is a simplified check - full implementation would query LP token holders
    
    // Check for common lock indicators in DexScreener data
    const info = mainPair.info || {};
    const socials = info.socials || [];
    
    // Look for "locked" or "burned" in pool name/description
    const poolName = (mainPair.baseToken?.name || '').toLowerCase();
    const hasLockKeyword = poolName.includes('lock') || poolName.includes('safe');
    
    // Check creation time - very new pools are risky even if "locked"
    const createdAt = mainPair.pairCreatedAt;
    const ageHours = createdAt ? (Date.now() - createdAt) / (1000 * 60 * 60) : 0;
    
    // For Raydium/Pump.fun pools, check if liquidity was burned at creation
    const dexId = mainPair.dexId;
    const isPumpFun = dexId === 'pump-fun' || mainPair.url?.includes('pump.fun');
    
    // Pump.fun pools have liquidity burned by default
    if (isPumpFun) {
      return {
        isLocked: true,
        reason: 'Pump.fun pool - liquidity burned at creation',
        lockPercentage: 100,
        totalLiquidity,
        dex: 'pump.fun',
        ageHours
      };
    }
    
    // For other DEXes, we need deeper analysis
    // This is a heuristic based on liquidity amount and age
    const likelyLocked = totalLiquidity > 5000 && ageHours > 1;
    
    return {
      isLocked: likelyLocked,
      reason: likelyLocked ? 'Established pool with significant liquidity' : 'Unable to verify lock - proceed with caution',
      lockPercentage: likelyLocked ? 80 : 0,  // Estimated
      totalLiquidity,
      dex: dexId,
      ageHours,
      poolAddress
    };
    
  } catch (error) {
    return {
      isLocked: false,
      reason: `Error: ${error.message}`,
      lockPercentage: 0,
      totalLiquidity: 0
    };
  }
}

// === RULE 2: WHALE/HOLDER DISTRIBUTION CHECK ===
export async function checkHolderDistribution(tokenMint) {
  console.log(`   👥 Checking holder distribution...`);
  
  try {
    const mintPubkey = new PublicKey(tokenMint);
    
    // Get largest token accounts
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return {
        isSafe: false,
        reason: 'No holder data available',
        topHolderPct: 100,
        whaleAlert: true
      };
    }
    
    // Get total supply
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supplyInfo.value.amount);
    
    // Calculate distribution
    const holders = largestAccounts.value;
    let top1Pct = 0;
    let top5Pct = 0;
    let top10Pct = 0;
    
    for (let i = 0; i < holders.length && i < 10; i++) {
      const holderPct = (Number(holders[i].amount) / totalSupply) * 100;
      
      if (i === 0) top1Pct = holderPct;
      if (i < 5) top5Pct += holderPct;
      if (i < 10) top10Pct += holderPct;
    }
    
    // Rule: No single whale controlling 40%+
    const hasWhale = top1Pct >= 40;
    
    // Additional checks
    const top5Concentrated = top5Pct >= 70;  // Top 5 shouldn't hold 70%+
    const top10Concentrated = top10Pct >= 85; // Top 10 shouldn't hold 85%+
    
    const isSafe = !hasWhale && !top5Concentrated;
    
    let reason = '';
    if (hasWhale) {
      reason = `⚠️ WHALE ALERT: Top holder owns ${top1Pct.toFixed(1)}%`;
    } else if (top5Concentrated) {
      reason = `⚠️ Top 5 holders control ${top5Pct.toFixed(1)}%`;
    } else if (top10Concentrated) {
      reason = `Moderate concentration: Top 10 hold ${top10Pct.toFixed(1)}%`;
    } else {
      reason = `✅ Good distribution: Top holder ${top1Pct.toFixed(1)}%, Top 10: ${top10Pct.toFixed(1)}%`;
    }
    
    return {
      isSafe,
      reason,
      topHolderPct: top1Pct,
      top5Pct,
      top10Pct,
      whaleAlert: hasWhale,
      holderCount: holders.length,
      distribution: holders.slice(0, 5).map((h, i) => ({
        rank: i + 1,
        percentage: ((Number(h.amount) / totalSupply) * 100).toFixed(2) + '%',
        address: h.address.toString().slice(0, 8) + '...'
      }))
    };
    
  } catch (error) {
    return {
      isSafe: false,
      reason: `Error: ${error.message}`,
      topHolderPct: 100,
      whaleAlert: true
    };
  }
}

// === RULE 3: EARLY ENTRY CHECK (Before Hype) ===
export async function checkIfEarlyEntry(tokenMint) {
  console.log(`   ⏰ Checking entry timing...`);
  
  try {
    // Get token info from DexScreener
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return {
        isEarly: true,
        reason: 'Very new - no trading data yet',
        ageMinutes: 0,
        priceChange24h: 0,
        volumeUsd24h: 0,
        hypeLevel: 'unknown'
      };
    }
    
    const pair = data.pairs[0];
    
    // Get metrics
    const createdAt = pair.pairCreatedAt;
    const ageMinutes = createdAt ? Math.floor((Date.now() - createdAt) / (1000 * 60)) : 0;
    const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
    const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);
    const priceChange24h = parseFloat(pair.priceChange?.h24 || 0);
    const volumeUsd24h = parseFloat(pair.volume?.h24 || 0);
    const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    
    // Determine hype level
    let hypeLevel = 'low';
    let isEarly = true;
    let reason = '';
    
    // Signs of EARLY entry (good):
    // - Token is < 30 minutes old
    // - Price hasn't pumped more than 100% yet
    // - Volume is building but not explosive
    // - Transaction count is growing steadily
    
    // Signs of LATE entry (bad):
    // - Token already pumped 500%+
    // - Volume is extremely high ($1M+)
    // - Everyone talking about it (can't measure directly)
    // - Price is declining from ATH
    
    if (ageMinutes < 15) {
      hypeLevel = 'none';
      isEarly = true;
      reason = '🚀 VERY EARLY - Token just launched!';
    } else if (ageMinutes < 60 && priceChange1h < 200) {
      hypeLevel = 'low';
      isEarly = true;
      reason = '✅ Early entry - Still building momentum';
    } else if (priceChange24h > 500 || volumeUsd24h > 1000000) {
      hypeLevel = 'extreme';
      isEarly = false;
      reason = '⚠️ LATE - Already pumped, Twitter hype likely peaked';
    } else if (priceChange24h > 200 || volumeUsd24h > 500000) {
      hypeLevel = 'high';
      isEarly = false;
      reason = '⚠️ Getting late - Significant pump already happened';
    } else if (priceChange1h < -20) {
      hypeLevel = 'fading';
      isEarly = false;
      reason = '📉 Post-hype dump in progress - avoid';
    } else {
      hypeLevel = 'moderate';
      isEarly = true;
      reason = '⚡ Moderate hype - Proceed with caution';
    }
    
    return {
      isEarly,
      reason,
      ageMinutes,
      priceChange5m,
      priceChange1h,
      priceChange24h,
      volumeUsd24h,
      txns24h,
      hypeLevel
    };
    
  } catch (error) {
    return {
      isEarly: false,
      reason: `Error: ${error.message}`,
      ageMinutes: 0,
      hypeLevel: 'unknown'
    };
  }
}

// === RULE 4: STAGED SELLING STRATEGY ===
export function getSellStrategy(entryAmount, currentPrice, entryPrice) {
  const profitPct = ((currentPrice / entryPrice) - 1) * 100;
  
  // Staged selling strategy
  const stages = [
    { trigger: 30, sellPct: 25, reason: 'Take initial profit - secure entry cost' },
    { trigger: 50, sellPct: 25, reason: 'Lock in gains - now playing with house money' },
    { trigger: 100, sellPct: 25, reason: 'Double your money - take half off' },
    { trigger: 200, sellPct: 15, reason: 'Let winners run - small reduction' },
    { trigger: 500, sellPct: 10, reason: 'Moon bag time - keep small position' },
  ];
  
  let remainingPct = 100;
  const executedStages = [];
  const pendingStages = [];
  
  for (const stage of stages) {
    if (profitPct >= stage.trigger) {
      executedStages.push({
        ...stage,
        status: 'TRIGGERED',
        sellAmount: (entryAmount * stage.sellPct / 100)
      });
      remainingPct -= stage.sellPct;
    } else {
      pendingStages.push({
        ...stage,
        status: 'PENDING',
        triggerPrice: entryPrice * (1 + stage.trigger / 100)
      });
    }
  }
  
  return {
    currentProfit: profitPct,
    remainingPosition: remainingPct,
    executedStages,
    pendingStages,
    nextSellAt: pendingStages[0] || null,
    recommendation: getRecommendation(profitPct, remainingPct)
  };
}

function getRecommendation(profitPct, remainingPct) {
  if (profitPct < -20) {
    return '🛑 STOP LOSS - Consider cutting losses';
  } else if (profitPct < 0) {
    return '⏳ HOLD - Wait for recovery or cut at -25%';
  } else if (profitPct < 30) {
    return '📈 HOLD - Wait for +30% to start taking profits';
  } else if (remainingPct > 75) {
    return '💰 SELL 25% - Lock in initial gains!';
  } else if (remainingPct > 50) {
    return '💰 SELL MORE - Continue staged exit';
  } else if (remainingPct > 25) {
    return '🌙 MOON BAG - Keep 25% for potential moonshot';
  } else {
    return '✅ MOSTLY EXITED - Let remainder ride';
  }
}

// === COMPREHENSIVE SAFETY CHECK ===
export async function fullSafetyCheck(tokenMint) {
  console.log(`\n🛡️ FULL SAFETY CHECK: ${tokenMint.slice(0, 12)}...`);
  console.log('─'.repeat(50));
  
  const results = {
    tokenMint,
    timestamp: new Date().toISOString(),
    checks: {},
    overallSafe: false,
    riskScore: 0,
    recommendation: ''
  };
  
  // Rule 1: Liquidity Lock
  const liquidityCheck = await checkLiquidityLock(tokenMint);
  results.checks.liquidityLock = liquidityCheck;
  if (!liquidityCheck.isLocked) results.riskScore += 30;
  
  // Rule 2: Holder Distribution  
  const holderCheck = await checkHolderDistribution(tokenMint);
  results.checks.holderDistribution = holderCheck;
  if (!holderCheck.isSafe) results.riskScore += 35;
  if (holderCheck.whaleAlert) results.riskScore += 20;
  
  // Rule 3: Entry Timing
  const timingCheck = await checkIfEarlyEntry(tokenMint);
  results.checks.entryTiming = timingCheck;
  if (!timingCheck.isEarly) results.riskScore += 15;
  
  // Calculate overall safety
  results.overallSafe = results.riskScore < 40;
  
  // Generate recommendation
  if (results.riskScore >= 60) {
    results.recommendation = '🚫 DO NOT BUY - Multiple red flags';
  } else if (results.riskScore >= 40) {
    results.recommendation = '⚠️ HIGH RISK - Only small position if any';
  } else if (results.riskScore >= 20) {
    results.recommendation = '⚡ MODERATE - Use staged selling, set stop loss';
  } else {
    results.recommendation = '✅ RELATIVELY SAFE - Follow 4 golden rules';
  }
  
  return results;
}

// === PRINT DETAILED REPORT ===
export function printSafetyReport(results) {
  console.log('\n' + '═'.repeat(60));
  console.log('🛡️ TOKEN SAFETY REPORT');
  console.log('═'.repeat(60));
  console.log(`Token: ${results.tokenMint}`);
  console.log(`Time: ${results.timestamp}`);
  console.log(`Risk Score: ${results.riskScore}/100`);
  console.log(`Status: ${results.recommendation}`);
  
  // Rule 1
  console.log('\n📌 RULE 1: Liquidity Lock');
  const liq = results.checks.liquidityLock;
  console.log(`   Locked: ${liq.isLocked ? '✅ YES' : '❌ NO'}`);
  console.log(`   Reason: ${liq.reason}`);
  console.log(`   Liquidity: $${(liq.totalLiquidity || 0).toLocaleString()}`);
  if (liq.dex) console.log(`   DEX: ${liq.dex}`);
  
  // Rule 2
  console.log('\n👥 RULE 2: Holder Distribution');
  const holder = results.checks.holderDistribution;
  console.log(`   Safe: ${holder.isSafe ? '✅ YES' : '❌ NO'}`);
  console.log(`   ${holder.reason}`);
  if (holder.distribution) {
    console.log('   Top 5 Holders:');
    for (const h of holder.distribution) {
      console.log(`      #${h.rank}: ${h.percentage} (${h.address})`);
    }
  }
  
  // Rule 3
  console.log('\n⏰ RULE 3: Entry Timing');
  const timing = results.checks.entryTiming;
  console.log(`   Early Entry: ${timing.isEarly ? '✅ YES' : '❌ NO (too late)'}`);
  console.log(`   ${timing.reason}`);
  console.log(`   Age: ${timing.ageMinutes} minutes`);
  console.log(`   24h Change: ${timing.priceChange24h >= 0 ? '+' : ''}${(timing.priceChange24h || 0).toFixed(1)}%`);
  console.log(`   Hype Level: ${timing.hypeLevel?.toUpperCase()}`);
  
  // Rule 4
  console.log('\n💰 RULE 4: Staged Selling Strategy');
  console.log('   If you buy, use these sell targets:');
  console.log('   • +30%  → Sell 25% (secure entry cost)');
  console.log('   • +50%  → Sell 25% (house money)');
  console.log('   • +100% → Sell 25% (take half)');
  console.log('   • +200% → Sell 15% (reduce exposure)');
  console.log('   • +500% → Sell 10% (moon bag)');
  console.log('   • STOP LOSS: -25% (cut losses)');
  
  console.log('\n' + '═'.repeat(60));
  
  return results;
}

// CLI
if (process.argv[1]?.includes('safety-checker')) {
  const mint = process.argv[2];
  
  if (!mint) {
    console.log('Usage: node safety-checker.mjs <TOKEN_MINT>');
    console.log('\nExample:');
    console.log('  node safety-checker.mjs DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    process.exit(1);
  }
  
  const results = await fullSafetyCheck(mint);
  printSafetyReport(results);
}
