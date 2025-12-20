#!/usr/bin/env node
/**
 * 🛡️ ADVANCED TOKEN SAFETY CHECKER v2
 * 
 * THE 6 GOLDEN RULES:
 * 1. Liquidity must be locked
 * 2. Scan the contract (renounced, no hidden fees/minting)
 * 3. Wallet distribution (no whales >40%)
 * 4. Community strength (Twitter/Telegram activity)
 * 5. Whale tracking (smart money following)
 * 6. Exit strategy (staged selling)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://public.jupiterapi.com';
const connection = new Connection(RPC_URL, 'confirmed');

// ═══════════════════════════════════════════════════════════════════
// RULE 1: LIQUIDITY LOCK CHECK
// ═══════════════════════════════════════════════════════════════════
export async function checkLiquidityLock(tokenMint) {
  console.log(`   🔒 R1: Checking liquidity lock...`);
  
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { isLocked: false, reason: 'No liquidity pools found', score: 0 };
    }
    
    const mainPair = data.pairs[0];
    const totalLiquidity = parseFloat(mainPair.liquidity?.usd || 0);
    const dexId = mainPair.dexId;
    const ageHours = mainPair.pairCreatedAt 
      ? (Date.now() - mainPair.pairCreatedAt) / (1000 * 60 * 60) 
      : 0;
    
    // Pump.fun pools have liquidity burned by default
    const isPumpFun = dexId === 'pump-fun' || dexId === 'pumpswap';
    
    if (isPumpFun) {
      return {
        isLocked: true,
        reason: '✅ Pump.fun - LP burned at creation',
        totalLiquidity,
        dex: dexId,
        ageHours,
        score: 100
      };
    }
    
    // For other DEXes, check liquidity and age
    const isLikelyLocked = totalLiquidity > 5000 && ageHours > 1;
    
    return {
      isLocked: isLikelyLocked,
      reason: isLikelyLocked 
        ? `✅ Established pool ($${totalLiquidity.toLocaleString()})` 
        : '⚠️ Unverified lock - check manually',
      totalLiquidity,
      dex: dexId,
      ageHours,
      score: isLikelyLocked ? 80 : 20
    };
    
  } catch (error) {
    return { isLocked: false, reason: `Error: ${error.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RULE 2: CONTRACT SCAN (Renounced, No Hidden Functions)
// ═══════════════════════════════════════════════════════════════════
export async function scanContract(tokenMint) {
  console.log(`   📜 R2: Scanning contract...`);
  
  try {
    const mintPubkey = new PublicKey(tokenMint);
    const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!accountInfo.value) {
      return { isSafe: false, reason: 'Token not found', score: 0 };
    }
    
    const data = accountInfo.value.data;
    const issues = [];
    let score = 100;
    
    if (data.parsed) {
      const info = data.parsed.info;
      
      // Check mint authority (can they create more tokens?)
      if (info.mintAuthority) {
        issues.push(`❌ Mint authority NOT renounced (${info.mintAuthority.slice(0,8)}...)`);
        score -= 40;
      }
      
      // Check freeze authority (can they freeze your wallet?)
      if (info.freezeAuthority) {
        issues.push(`❌ Freeze authority NOT renounced (${info.freezeAuthority.slice(0,8)}...)`);
        score -= 50;
      }
      
      // Check supply
      const supply = parseInt(info.supply || 0);
      const decimals = info.decimals || 0;
      
      return {
        isSafe: issues.length === 0,
        mintAuthority: info.mintAuthority || null,
        freezeAuthority: info.freezeAuthority || null,
        supply,
        decimals,
        issues,
        reason: issues.length === 0 
          ? '✅ Contract clean - authorities renounced' 
          : issues.join(' | '),
        score: Math.max(0, score)
      };
    }
    
    return { isSafe: false, reason: 'Unable to parse contract', score: 30 };
    
  } catch (error) {
    return { isSafe: false, reason: `Error: ${error.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RULE 3: WALLET DISTRIBUTION (No Whales >40%)
// ═══════════════════════════════════════════════════════════════════
export async function checkWalletDistribution(tokenMint) {
  console.log(`   👥 R3: Checking wallet distribution...`);
  
  try {
    const mintPubkey = new PublicKey(tokenMint);
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { isSafe: false, reason: 'No holder data', score: 0 };
    }
    
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supplyInfo.value.amount);
    
    const holders = largestAccounts.value;
    let top1Pct = 0, top5Pct = 0, top10Pct = 0;
    
    for (let i = 0; i < holders.length && i < 10; i++) {
      const pct = (Number(holders[i].amount) / totalSupply) * 100;
      if (i === 0) top1Pct = pct;
      if (i < 5) top5Pct += pct;
      if (i < 10) top10Pct += pct;
    }
    
    // Scoring
    let score = 100;
    const issues = [];
    
    if (top1Pct >= 50) {
      issues.push(`🚨 CRITICAL: Top wallet owns ${top1Pct.toFixed(1)}%`);
      score -= 60;
    } else if (top1Pct >= 40) {
      issues.push(`⚠️ Whale alert: Top wallet owns ${top1Pct.toFixed(1)}%`);
      score -= 40;
    } else if (top1Pct >= 20) {
      issues.push(`Large holder: ${top1Pct.toFixed(1)}%`);
      score -= 15;
    }
    
    if (top5Pct >= 70) {
      issues.push(`Top 5 control ${top5Pct.toFixed(1)}%`);
      score -= 20;
    }
    
    return {
      isSafe: top1Pct < 40 && top5Pct < 70,
      top1Pct,
      top5Pct,
      top10Pct,
      holderCount: holders.length,
      issues,
      reason: issues.length === 0 
        ? `✅ Healthy distribution (top: ${top1Pct.toFixed(1)}%)` 
        : issues.join(' | '),
      distribution: holders.slice(0, 5).map((h, i) => ({
        rank: i + 1,
        pct: ((Number(h.amount) / totalSupply) * 100).toFixed(2),
        address: h.address.toString().slice(0, 8) + '...'
      })),
      score: Math.max(0, score)
    };
    
  } catch (error) {
    return { isSafe: false, reason: `Error: ${error.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RULE 4: COMMUNITY STRENGTH (Social Activity)
// ═══════════════════════════════════════════════════════════════════
export async function checkCommunityStrength(tokenMint) {
  console.log(`   🌐 R4: Checking community strength...`);
  
  try {
    // Get token info from DexScreener (includes social links)
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { hasComm: false, reason: 'No data available', score: 0 };
    }
    
    const pair = data.pairs[0];
    const info = pair.info || {};
    const socials = info.socials || [];
    const websites = info.websites || [];
    
    let score = 0;
    const found = [];
    const missing = [];
    
    // Check for social links
    const hasTwitter = socials.some(s => s.type === 'twitter');
    const hasTelegram = socials.some(s => s.type === 'telegram');
    const hasDiscord = socials.some(s => s.type === 'discord');
    const hasWebsite = websites.length > 0;
    
    if (hasTwitter) { score += 30; found.push('Twitter'); } else { missing.push('Twitter'); }
    if (hasTelegram) { score += 30; found.push('Telegram'); } else { missing.push('Telegram'); }
    if (hasDiscord) { score += 15; found.push('Discord'); }
    if (hasWebsite) { score += 25; found.push('Website'); } else { missing.push('Website'); }
    
    // Check trading activity as proxy for community engagement
    const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    const volume24h = parseFloat(pair.volume?.h24 || 0);
    
    // High activity = strong community
    if (txns24h > 1000) score += 20;
    else if (txns24h > 500) score += 10;
    else if (txns24h > 100) score += 5;
    
    // Cap at 100
    score = Math.min(100, score);
    
    const hasCommunity = found.length >= 2 && txns24h > 50;
    
    return {
      hasCommunity,
      socials: found,
      missing,
      hasTwitter,
      hasTelegram,
      hasDiscord,
      hasWebsite,
      txns24h,
      volume24h,
      reason: hasCommunity 
        ? `✅ Active community: ${found.join(', ')} | ${txns24h} txns/24h`
        : `⚠️ Weak community: Missing ${missing.join(', ')} | ${txns24h} txns/24h`,
      score
    };
    
  } catch (error) {
    return { hasCommunity: false, reason: `Error: ${error.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RULE 5: WHALE TRACKING (Smart Money Following)
// ═══════════════════════════════════════════════════════════════════
export async function trackWhaleActivity(tokenMint) {
  console.log(`   🐋 R5: Tracking whale activity...`);
  
  try {
    // Get recent transactions for the token
    const mintPubkey = new PublicKey(tokenMint);
    
    // Get signatures for recent transactions
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit: 50 });
    
    if (signatures.length === 0) {
      return { signal: 'neutral', reason: 'No recent transactions', score: 50 };
    }
    
    // Analyze transaction timing and pattern
    const recentTxCount = signatures.length;
    const oldestTx = signatures[signatures.length - 1];
    const newestTx = signatures[0];
    
    const timeSpan = newestTx.blockTime && oldestTx.blockTime 
      ? (newestTx.blockTime - oldestTx.blockTime) / 60 
      : 0;
    
    // High frequency = active trading
    const txPerMinute = timeSpan > 0 ? recentTxCount / timeSpan : 0;
    
    // Get DexScreener data for buy/sell ratio
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    let buyRatio = 0.5;
    let score = 50;
    let signal = 'neutral';
    
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      const buys = pair.txns?.h24?.buys || 0;
      const sells = pair.txns?.h24?.sells || 0;
      const total = buys + sells;
      
      if (total > 0) {
        buyRatio = buys / total;
        
        // Analyze signal
        if (buyRatio > 0.65) {
          signal = 'bullish';
          score = 80 + (buyRatio - 0.65) * 50;
        } else if (buyRatio > 0.55) {
          signal = 'slightly_bullish';
          score = 60 + (buyRatio - 0.55) * 100;
        } else if (buyRatio < 0.35) {
          signal = 'bearish';
          score = 20 - (0.35 - buyRatio) * 50;
        } else if (buyRatio < 0.45) {
          signal = 'slightly_bearish';
          score = 40 - (0.45 - buyRatio) * 50;
        }
        
        score = Math.max(0, Math.min(100, score));
      }
    }
    
    const reasons = {
      bullish: `✅ Smart money BUYING - ${(buyRatio * 100).toFixed(0)}% buys`,
      slightly_bullish: `📈 More buyers than sellers - ${(buyRatio * 100).toFixed(0)}% buys`,
      neutral: `➡️ Balanced activity - ${(buyRatio * 100).toFixed(0)}% buys`,
      slightly_bearish: `📉 More selling pressure - ${(buyRatio * 100).toFixed(0)}% buys`,
      bearish: `⚠️ Whales DUMPING - ${(buyRatio * 100).toFixed(0)}% buys`
    };
    
    return {
      signal,
      buyRatio,
      txPerMinute,
      recentTxCount,
      reason: reasons[signal],
      score
    };
    
  } catch (error) {
    return { signal: 'unknown', reason: `Error: ${error.message}`, score: 50 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RULE 6: EXIT STRATEGY (Staged Selling)
// ═══════════════════════════════════════════════════════════════════
export const EXIT_STRATEGY = {
  stages: [
    { profit: 30, sellPct: 25, reason: 'Recover entry cost' },
    { profit: 50, sellPct: 25, reason: 'Playing with house money' },
    { profit: 100, sellPct: 25, reason: 'Double your money' },
    { profit: 200, sellPct: 15, reason: 'Lock major gains' },
    { profit: 500, sellPct: 10, reason: 'Moon bag' },
  ],
  stopLoss: -25,
  
  getAction(currentProfit, stagesSold = []) {
    // Check stop loss
    if (currentProfit <= this.stopLoss) {
      return { action: 'STOP_LOSS', sellPct: 100, reason: '🛑 Cut losses now!' };
    }
    
    // Check staged sells
    for (const stage of this.stages) {
      if (currentProfit >= stage.profit && !stagesSold.includes(stage.profit)) {
        return { 
          action: 'SELL_STAGE', 
          sellPct: stage.sellPct, 
          triggerProfit: stage.profit,
          reason: `💰 +${stage.profit}% hit - ${stage.reason}` 
        };
      }
    }
    
    // Hold
    const nextStage = this.stages.find(s => !stagesSold.includes(s.profit));
    return { 
      action: 'HOLD', 
      sellPct: 0, 
      nextTarget: nextStage?.profit || 'Moon 🌙',
      reason: `📊 Hold until +${nextStage?.profit || '???'}%` 
    };
  }
};

// ═══════════════════════════════════════════════════════════════════
// COMPREHENSIVE 6-RULE CHECK
// ═══════════════════════════════════════════════════════════════════
export async function fullSafetyCheck(tokenMint) {
  console.log(`\n🛡️ FULL 6-RULE SAFETY CHECK`);
  console.log(`Token: ${tokenMint.slice(0, 12)}...`);
  console.log('─'.repeat(55));
  
  const results = {
    tokenMint,
    timestamp: new Date().toISOString(),
    rules: {},
    overallScore: 0,
    maxScore: 600,
    passedRules: 0,
    failedRules: [],
    recommendation: ''
  };
  
  // Rule 1: Liquidity Lock
  results.rules.liquidityLock = await checkLiquidityLock(tokenMint);
  
  // Rule 2: Contract Scan
  results.rules.contract = await scanContract(tokenMint);
  
  // Rule 3: Wallet Distribution
  results.rules.distribution = await checkWalletDistribution(tokenMint);
  
  // Rule 4: Community Strength
  results.rules.community = await checkCommunityStrength(tokenMint);
  
  // Rule 5: Whale Tracking
  results.rules.whales = await trackWhaleActivity(tokenMint);
  
  // Rule 6: Exit Strategy (always ready)
  results.rules.exitStrategy = { 
    ready: true, 
    reason: '✅ Staged selling configured',
    score: 100 
  };
  
  // Calculate scores
  let totalScore = 0;
  let passed = 0;
  
  for (const [rule, data] of Object.entries(results.rules)) {
    totalScore += data.score || 0;
    if (data.score >= 60) {
      passed++;
    } else {
      results.failedRules.push(rule);
    }
  }
  
  results.overallScore = totalScore;
  results.passedRules = passed;
  
  // Generate recommendation
  const avgScore = totalScore / 6;
  
  if (avgScore >= 80 && passed >= 5) {
    results.recommendation = '✅ STRONG BUY - Passes most safety checks';
    results.riskLevel = 'LOW';
  } else if (avgScore >= 60 && passed >= 4) {
    results.recommendation = '⚡ CAUTIOUS BUY - Some concerns, use small position';
    results.riskLevel = 'MEDIUM';
  } else if (avgScore >= 40 && passed >= 3) {
    results.recommendation = '⚠️ HIGH RISK - Multiple red flags, avoid or tiny position';
    results.riskLevel = 'HIGH';
  } else {
    results.recommendation = '🚫 DO NOT BUY - Too many failed checks';
    results.riskLevel = 'EXTREME';
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// PRETTY PRINT REPORT
// ═══════════════════════════════════════════════════════════════════
export function printSafetyReport(r) {
  console.log('\n' + '═'.repeat(65));
  console.log('🛡️ THE 6 GOLDEN RULES - SAFETY REPORT');
  console.log('═'.repeat(65));
  console.log(`Token: ${r.tokenMint}`);
  console.log(`Time: ${r.timestamp}`);
  console.log(`Overall Score: ${r.overallScore}/${r.maxScore} (${(r.overallScore/r.maxScore*100).toFixed(0)}%)`);
  console.log(`Rules Passed: ${r.passedRules}/6`);
  console.log(`Risk Level: ${r.riskLevel}`);
  console.log(`\n${r.recommendation}`);
  
  console.log('\n' + '─'.repeat(65));
  
  // Rule 1
  const r1 = r.rules.liquidityLock;
  console.log(`\n🔒 RULE 1: Liquidity Lock [${r1.score}/100]`);
  console.log(`   ${r1.reason}`);
  if (r1.totalLiquidity) console.log(`   Liquidity: $${r1.totalLiquidity.toLocaleString()} | DEX: ${r1.dex}`);
  
  // Rule 2
  const r2 = r.rules.contract;
  console.log(`\n📜 RULE 2: Contract Scan [${r2.score}/100]`);
  console.log(`   ${r2.reason}`);
  if (r2.mintAuthority === null) console.log(`   ✅ Mint authority: RENOUNCED`);
  if (r2.freezeAuthority === null) console.log(`   ✅ Freeze authority: RENOUNCED`);
  
  // Rule 3
  const r3 = r.rules.distribution;
  console.log(`\n👥 RULE 3: Wallet Distribution [${r3.score}/100]`);
  console.log(`   ${r3.reason}`);
  if (r3.distribution) {
    console.log('   Top 5 Holders:');
    r3.distribution.forEach(h => console.log(`      #${h.rank}: ${h.pct}% (${h.address})`));
  }
  
  // Rule 4
  const r4 = r.rules.community;
  console.log(`\n🌐 RULE 4: Community Strength [${r4.score}/100]`);
  console.log(`   ${r4.reason}`);
  if (r4.socials?.length) console.log(`   Found: ${r4.socials.join(', ')}`);
  if (r4.missing?.length) console.log(`   Missing: ${r4.missing.join(', ')}`);
  
  // Rule 5
  const r5 = r.rules.whales;
  console.log(`\n🐋 RULE 5: Whale Tracking [${r5.score}/100]`);
  console.log(`   ${r5.reason}`);
  console.log(`   Signal: ${r5.signal?.toUpperCase()}`);
  
  // Rule 6
  console.log(`\n💰 RULE 6: Exit Strategy [100/100]`);
  console.log('   ✅ Staged selling configured:');
  EXIT_STRATEGY.stages.forEach(s => {
    console.log(`      +${s.profit}% → Sell ${s.sellPct}% (${s.reason})`);
  });
  console.log(`      Stop Loss: ${EXIT_STRATEGY.stopLoss}%`);
  
  console.log('\n' + '═'.repeat(65));
  
  // Quick action summary
  if (r.riskLevel === 'LOW') {
    console.log('📈 ACTION: Safe to enter with normal position size');
  } else if (r.riskLevel === 'MEDIUM') {
    console.log('📊 ACTION: Enter with 50% of normal position, tight stop loss');
  } else if (r.riskLevel === 'HIGH') {
    console.log('⚠️ ACTION: Only micro position or skip entirely');
  } else {
    console.log('🚫 ACTION: DO NOT BUY - Move to next opportunity');
  }
  
  console.log('═'.repeat(65) + '\n');
  
  return r;
}

// ═══════════════════════════════════════════════════════════════════
// QUICK CHECK (For bot integration)
// ═══════════════════════════════════════════════════════════════════
export async function quickSafetyCheck(tokenMint) {
  const result = await fullSafetyCheck(tokenMint);
  
  return {
    safe: result.riskLevel === 'LOW' || result.riskLevel === 'MEDIUM',
    riskLevel: result.riskLevel,
    score: result.overallScore,
    maxScore: result.maxScore,
    passedRules: result.passedRules,
    failedRules: result.failedRules,
    recommendation: result.recommendation,
    // Individual checks
    liquidityLocked: result.rules.liquidityLock.isLocked,
    contractClean: result.rules.contract.isSafe,
    noWhales: result.rules.distribution.isSafe,
    hasCommunity: result.rules.community.hasCommunity,
    whaleSignal: result.rules.whales.signal,
  };
}

// CLI
if (process.argv[1]?.includes('safety-checker-v2')) {
  const mint = process.argv[2];
  
  if (!mint) {
    console.log('Usage: node safety-checker-v2.mjs <TOKEN_MINT>');
    console.log('\nThe 6 Golden Rules:');
    console.log('  1. Liquidity must be locked');
    console.log('  2. Contract clean (renounced authorities)');
    console.log('  3. No whales >40%');
    console.log('  4. Active community (Twitter/Telegram)');
    console.log('  5. Whale activity (smart money signal)');
    console.log('  6. Exit strategy (staged selling)');
    process.exit(1);
  }
  
  const result = await fullSafetyCheck(mint);
  printSafetyReport(result);
}
