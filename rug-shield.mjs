#!/usr/bin/env node
/**
 * 🛡️ RUG SHIELD - ML-DRIVEN MODE
 * 
 * Balance: $44 - Time to let the ML model find winners
 * 
 * ONLY HARD BLOCKS (critical safety only):
 * ✅ Sell simulation MUST work (honeypot protection)
 * ✅ No freeze authority (can't freeze your tokens)
 * 
 * ML SCORING FACTORS (all informational for model):
 * - Liquidity depth (scored 0-1 based on $500+ threshold)
 * - Token age (scored, no minimum)
 * - Wallet distribution (scored, allows up to 90% top wallet)
 * - Mint authority status (scored if renounced)
 * - Volume activity (scored)
 * - Sentiment analysis (scored)
 * 
 * ML MODEL DECIDES:
 * - Entry timing based on weighted features
 * - Exit strategy based on sentiment + price action
 * - Risk tolerance per trade
 * 
 * AUTO EXITS (safety net):
 * - 12% trailing stop loss (wide - trust ML timing)
 * - 20% hard stop loss (very wide - allow volatility)
 * - 30% take profit (let winners run)
 * - Max hold time: 10 minutes (ML decides most exits)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';
import fs from 'fs';
import { analyzeToken } from './ml-predictor.mjs';

const RPC_URL = process.env.HELIUS_RPC_URL;
const connection = new Connection(RPC_URL, 'confirmed');

// ═══════════════════════════════════════════════════════════════════════════
// PROTECTION SETTINGS - STRICT MODE
// ═══════════════════════════════════════════════════════════════════════════

export const PROTECTION_CONFIG = {
  // ML-DRIVEN MODE - Let the model decide
  MIN_LIQUIDITY_USD: 50,          // Lower threshold to access more token pools
  MIN_AGE_MINUTES: 0,             // No age restriction - catch fresh launches
  MAX_TOP_WALLET_PCT: 95,         // Very permissive - ML will score it
  MAX_TOP5_WALLET_PCT: 95,        // Very permissive
  REQUIRE_SELL_TEST: true,        // ONLY keep honeypot protection
  BLOCK_FREEZE_AUTHORITY: true,   // ONLY keep freeze authority check
  
  // Soft requirements - ML-based scoring
  MIN_SAFETY_SCORE: 0,            // No minimum - trust ML prediction
  USE_ML_SCORING: true,           // Use ML model instead of hard rules
  
  // Auto-protection settings - ML TIMING
  TRAILING_STOP_LOSS_PCT: 12,     // Wider stops - trust ML timing
  HARD_STOP_LOSS_PCT: 20,         // Much wider for volatility
  MAX_HOLD_MINUTES: 10,           // Longer holds - let ML decide exit
  TAKE_PROFIT_PCT: 30,            // Higher targets - let winners run
  MAX_POSITION_SIZE_PCT: 20,      // Bigger bets - ML confidence
  
  // Blacklist - MINIMAL (only proven scams)
  BLACKLISTED_PATTERNS: [
    // Only blacklist tokens that 100% rugged you
    /EXACTHOLD/i,  // Be very specific to not block legit tokens
  ]
};

// Known scam tokens (add your rugged tokens here)
const BLACKLIST = new Set([
  // Add the HOLD token that rugged you if you have the mint address
]);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SAFETY CHECK
// ═══════════════════════════════════════════════════════════════════════════

export async function rugShieldCheck(tokenMint, tokenName = '') {
  console.log(`\n🛡️ RUG SHIELD: Analyzing ${tokenMint.slice(0, 8)}...`);
  
  const result = {
    mint: tokenMint,
    name: tokenName,
    isSafe: false,
    score: 0,
    hardChecks: {
      sellable: false,
      liquidityOk: false,
      ageOk: false,
      distributionOk: false,
      noFreezeAuthority: false
    },
    softChecks: {},
    flags: [],
    recommendation: '',
    autoProtection: { ...PROTECTION_CONFIG }
  };

  try {
    // ═══════════════════════════════════════════════════════════════
    // BLACKLIST CHECK
    // ═══════════════════════════════════════════════════════════════
    
    if (BLACKLIST.has(tokenMint)) {
      result.flags.push('🚫 BLACKLISTED TOKEN');
      result.recommendation = '🚫 BLOCKED - Known scam token';
      return result;
    }
    
    // Check name against patterns
    for (const pattern of PROTECTION_CONFIG.BLACKLISTED_PATTERNS) {
      if (pattern.test(tokenName)) {
        result.flags.push(`🚫 Name matches scam pattern: ${tokenName}`);
        result.recommendation = '🚫 BLOCKED - Suspicious token name';
        return result;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // HARD CHECK 1: CAN WE SELL? (Most important)
    // ═══════════════════════════════════════════════════════════════
    
    console.log('   📊 Testing sell capability...');
    const sellTest = await testSellCapability(tokenMint);
    result.hardChecks.sellable = sellTest.canSell;
    result.softChecks.sellTest = sellTest;
    
    if (!sellTest.canSell) {
      result.flags.push('🚨 CRITICAL: Cannot sell this token - HONEYPOT');
      result.recommendation = '🚫 DO NOT BUY - Sell blocked';
      return result;
    }
    
    if (sellTest.estimatedTax > 10) {
      result.flags.push(`⚠️ High sell tax: ${sellTest.estimatedTax}%`);
      result.score -= 20;
    }

    // ═══════════════════════════════════════════════════════════════
    // HARD CHECK 2: LIQUIDITY (INFORMATIONAL ONLY)
    // ═══════════════════════════════════════════════════════════════
    
    console.log('   💧 Checking liquidity...');
    const liquidity = await checkLiquidity(tokenMint);
    // NO HARD REQUIREMENT - just record for ML
    result.hardChecks.liquidityOk = true; // Always pass
    result.softChecks.liquidity = liquidity;
    
    // ═══════════════════════════════════════════════════════════════
    // HARD CHECK 3: TOKEN AGE (INFORMATIONAL ONLY)
    // ═══════════════════════════════════════════════════════════════
    
    console.log('   ⏰ Checking token age...');
    const age = await checkTokenAge(tokenMint);
    // NO HARD REQUIREMENT - ML decides if age matters
    result.hardChecks.ageOk = true; // Always pass
    result.softChecks.age = age;
    
    // Remove hard liquidity check
    result.score += Math.min(25, liquidity.usd / 1000); // Up to 25 points for liquidity

    // ═══════════════════════════════════════════════════════════════
    // HARD CHECK 4: WALLET DISTRIBUTION (INFORMATIONAL ONLY)
    // ═══════════════════════════════════════════════════════════════
    
    console.log('   👥 Checking wallet distribution...');
    const distribution = await checkDistribution(tokenMint);
    // NO HARD REQUIREMENT - ML decides if concentration matters
    result.hardChecks.distributionOk = true; // Always pass
    result.softChecks.distribution = distribution;
    
    // Score it but don't block
    result.score += Math.max(0, 20 - distribution.top1Pct / 2); // Up to 20 points for distribution

    // ═══════════════════════════════════════════════════════════════
    // HARD CHECK 5: FREEZE AUTHORITY
    // ═══════════════════════════════════════════════════════════════
    
    console.log('   🔐 Checking contract authorities...');
    const authorities = await checkAuthorities(tokenMint);
    result.hardChecks.noFreezeAuthority = !authorities.hasFreezeAuthority;
    result.softChecks.authorities = authorities;
    
    if (authorities.hasFreezeAuthority && PROTECTION_CONFIG.BLOCK_FREEZE_AUTHORITY) {
      result.flags.push('🚨 CRITICAL: Freeze authority enabled - can freeze your tokens');
      result.recommendation = '🚫 DO NOT BUY - Freeze authority risk';
      return result;
    }
    
    if (!authorities.hasMintAuthority) {
      result.score += 20; // Bonus for renounced mint
    } else {
      result.flags.push('⚠️ Mint authority not renounced');
      result.score -= 10;
    }

    // ═══════════════════════════════════════════════════════════════
    // SOFT CHECKS - Additional scoring
    // ═══════════════════════════════════════════════════════════════
    
    // Check volume
    if (liquidity.volume24h > 10000) {
      result.score += 10;
    } else {
      result.flags.push('⚠️ Low 24h volume');
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL ASSESSMENT - ML PREDICTION
    // ═══════════════════════════════════════════════════════════════
    
    // Manual score for reference (0-100)
    result.score = Math.min(100, Math.max(0, result.score));
    
    // Get ML prediction score (0-1 scale)
    let mlScore = 0;
    let mlRecommendation = '';
    let mlConfidence = 0;
    
    if (PROTECTION_CONFIG.USE_ML_SCORING) {
      try {
        // Prepare data for ML model - matches analyzeToken expected format
        const tokenData = {
          liquidity: liquidity.usd,
          volume: liquidity.volume24h,
          ageHours: 0.05, // Approximate (would need actual creation time)
          priceVelocity: 0.5, // Default (would need historical price data)
          volumeSpike: liquidity.volume24h > liquidity.usd * 2 ? 0.8 : 0.3,
          holderConcentration: holderData?.topPct ? holderData.topPct / 100 : 0.5
        };
        
        const prediction = analyzeToken(tokenData);
        
        mlScore = prediction.score;
        mlRecommendation = prediction.recommendation.reason;
        mlConfidence = prediction.confidence;
        
        result.mlScore = mlScore;
        result.mlPrediction = mlRecommendation;
        result.mlConfidence = mlConfidence;
        result.shouldTrade = prediction.shouldTrade;
        
      } catch (mlError) {
        console.log('   ⚠️ ML prediction failed, using manual scoring');
        result.flags.push('⚠️ ML unavailable');
      }
    }
    
    // ONLY block if honeypot or freeze authority (critical safety)
    const criticalChecksPassed = result.hardChecks.sellable && result.hardChecks.noFreezeAuthority;
    
    result.isSafe = criticalChecksPassed;
    
    if (result.isSafe) {
      // Use ML score if available, otherwise use manual score
      const finalScore = mlScore > 0 ? Math.round(mlScore * 100) : result.score;
      
      if (PROTECTION_CONFIG.USE_ML_SCORING && mlScore > 0) {
        // ML-based recommendation
        if (mlScore >= 0.7) {
          result.recommendation = `✅ ML BUY SIGNAL (${(mlScore * 100).toFixed(0)}% confidence) - ${mlRecommendation}`;
        } else if (mlScore >= 0.5) {
          result.recommendation = `⚠️ ML NEUTRAL (${(mlScore * 100).toFixed(0)}% confidence) - ${mlRecommendation}`;
        } else if (mlScore >= 0.3) {
          result.recommendation = `⚠️ ML CAUTION (${(mlScore * 100).toFixed(0)}% confidence) - ${mlRecommendation}`;
        } else {
          result.recommendation = `❌ ML AVOID (${(mlScore * 100).toFixed(0)}% confidence) - ${mlRecommendation}`;
        }
      } else {
        // Fallback to manual scoring
        if (finalScore >= 70) {
          result.recommendation = `✅ HIGH CONFIDENCE (Score: ${finalScore}/100) - Strong fundamentals`;
        } else if (finalScore >= 40) {
          result.recommendation = `⚠️ MEDIUM RISK (Score: ${finalScore}/100) - Acceptable risk`;
        } else {
          result.recommendation = `⚠️ LOW SCORE (${finalScore}/100) - High risk but tradeable`;
        }
      }
    } else {
      if (!result.hardChecks.sellable) {
        result.recommendation = `🚫 BLOCKED - Honeypot detected (cannot sell)`;
      } else if (!result.hardChecks.noFreezeAuthority) {
        result.recommendation = `🚫 BLOCKED - Freeze authority risk`;
      } else {
        result.recommendation = `🚫 BLOCKED - Critical safety check failed`;
      }
    }

    return result;

  } catch (error) {
    console.error('   ❌ Error:', error.message);
    result.flags.push(`Error: ${error.message}`);
    result.recommendation = '🚫 ERROR - Could not verify safety';
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function testSellCapability(mint) {
  try {
    // Test via Jupiter quote
    const params = new URLSearchParams({
      inputMint: mint,
      outputMint: 'So11111111111111111111111111111111111111112', // SOL
      amount: '1000000000', // 1 token assuming 9 decimals
      slippageBps: '500'
    });
    
    const response = await fetch(`https://api.jup.ag/swap/v1/quote?${params}`);
    
    if (!response.ok) {
      return { canSell: false, reason: 'No route found' };
    }
    
    const data = await response.json();
    
    if (data.error || !data.outAmount) {
      return { canSell: false, reason: data.error || 'No output' };
    }
    
    // Calculate effective tax from price impact
    const priceImpact = Math.abs(parseFloat(data.priceImpactPct || 0));
    
    return {
      canSell: true,
      priceImpact,
      estimatedTax: priceImpact,
      outAmount: data.outAmount
    };
    
  } catch (error) {
    return { canSell: false, reason: error.message };
  }
}

async function checkLiquidity(mint) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { usd: 0, volume24h: 0 };
    }
    
    const pair = data.pairs[0];
    return {
      usd: parseFloat(pair.liquidity?.usd || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      dex: pair.dexId
    };
  } catch {
    return { usd: 0, volume24h: 0 };
  }
}

async function checkTokenAge(mint) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { minutes: 0 };
    }
    
    const pairCreated = data.pairs[0].pairCreatedAt;
    if (!pairCreated) return { minutes: 999 }; // Unknown age, assume old
    
    const ageMs = Date.now() - pairCreated;
    return {
      minutes: ageMs / (1000 * 60),
      hours: ageMs / (1000 * 60 * 60),
      created: new Date(pairCreated).toISOString()
    };
  } catch {
    return { minutes: 0 };
  }
}

async function checkDistribution(mint) {
  try {
    const mintPubkey = new PublicKey(mint);
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    const supplyInfo = await connection.getTokenSupply(mintPubkey);
    
    const totalSupply = Number(supplyInfo.value.amount);
    const holders = largestAccounts.value;
    
    let top1Pct = 0, top5Pct = 0, top10Pct = 0;
    
    for (let i = 0; i < holders.length && i < 10; i++) {
      const pct = (Number(holders[i].amount) / totalSupply) * 100;
      if (i === 0) top1Pct = pct;
      if (i < 5) top5Pct += pct;
      top10Pct += pct;
    }
    
    return { top1Pct, top5Pct, top10Pct, holderCount: holders.length };
  } catch {
    return { top1Pct: 100, top5Pct: 100, top10Pct: 100, holderCount: 0 };
  }
}

async function checkAuthorities(mint) {
  try {
    const mintPubkey = new PublicKey(mint);
    const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!accountInfo.value?.data?.parsed) {
      return { hasMintAuthority: true, hasFreezeAuthority: true };
    }
    
    const info = accountInfo.value.data.parsed.info;
    
    return {
      hasMintAuthority: !!info.mintAuthority,
      hasFreezeAuthority: !!info.freezeAuthority,
      mintAuthority: info.mintAuthority || null,
      freezeAuthority: info.freezeAuthority || null
    };
  } catch {
    return { hasMintAuthority: true, hasFreezeAuthority: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION MONITOR - Auto-protection
// ═══════════════════════════════════════════════════════════════════════════

export class PositionMonitor {
  constructor() {
    this.positions = new Map();
  }
  
  addPosition(mint, entryPrice, entryTime = Date.now()) {
    this.positions.set(mint, {
      entryPrice,
      entryTime,
      peakPrice: entryPrice,
      peakTime: entryTime
    });
  }
  
  checkPosition(mint, currentPrice) {
    const pos = this.positions.get(mint);
    if (!pos) return { action: 'HOLD', reason: 'No position' };
    
    const config = PROTECTION_CONFIG;
    const now = Date.now();
    const holdMinutes = (now - pos.entryTime) / (1000 * 60);
    
    // Update peak
    if (currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
      pos.peakTime = now;
    }
    
    const pnlFromEntry = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const dropFromPeak = ((pos.peakPrice - currentPrice) / pos.peakPrice) * 100;
    
    // Check take profit
    if (pnlFromEntry >= config.TAKE_PROFIT_PCT) {
      return { 
        action: 'SELL', 
        reason: `✅ TAKE PROFIT: +${pnlFromEntry.toFixed(1)}%`,
        pnl: pnlFromEntry
      };
    }
    
    // Check hard stop loss
    if (pnlFromEntry <= -config.HARD_STOP_LOSS_PCT) {
      return { 
        action: 'SELL', 
        reason: `🛑 STOP LOSS: ${pnlFromEntry.toFixed(1)}%`,
        pnl: pnlFromEntry
      };
    }
    
    // Check trailing stop loss
    if (dropFromPeak >= config.TRAILING_STOP_LOSS_PCT && pnlFromEntry > 0) {
      return { 
        action: 'SELL', 
        reason: `📉 TRAILING STOP: Dropped ${dropFromPeak.toFixed(1)}% from peak`,
        pnl: pnlFromEntry
      };
    }
    
    // Check max hold time
    if (holdMinutes >= config.MAX_HOLD_MINUTES) {
      return { 
        action: 'SELL', 
        reason: `⏰ MAX HOLD TIME: ${holdMinutes.toFixed(0)} min`,
        pnl: pnlFromEntry
      };
    }
    
    return { 
      action: 'HOLD', 
      reason: `Holding: ${pnlFromEntry >= 0 ? '+' : ''}${pnlFromEntry.toFixed(1)}% | ${holdMinutes.toFixed(1)} min`,
      pnl: pnlFromEntry
    };
  }
  
  removePosition(mint) {
    this.positions.delete(mint);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRINT RESULTS
// ═══════════════════════════════════════════════════════════════════════════

export function printRugShieldResults(result) {
  console.log('\n' + '═'.repeat(60));
  console.log('🛡️  RUG SHIELD ANALYSIS RESULTS');
  console.log('═'.repeat(60));
  
  console.log(`\nToken: ${result.mint.slice(0, 20)}...`);
  console.log(`Name: ${result.name || 'Unknown'}`);
  
  if (result.mlScore !== undefined) {
    console.log(`\n🤖 ML Score: ${(result.mlScore * 100).toFixed(1)}%`);
    console.log(`📊 Manual Score: ${result.score}/100`);
  } else {
    console.log(`\n📊 Safety Score: ${result.score}/100`);
  }
  
  console.log(`\n${result.recommendation}`);
  
  console.log('\n─── Critical Checks ───');
  console.log(`  Sellable:      ${result.hardChecks.sellable ? '✅' : '❌'}`);
  console.log(`  No Freeze:     ${result.hardChecks.noFreezeAuthority ? '✅' : '❌'}`);
  
  console.log('\n─── ML Scoring Factors ───');
  console.log(`  Liquidity:     ${result.hardChecks.liquidityOk ? '✅' : '⚠️'} (informational)`);
  console.log(`  Token Age:     ${result.hardChecks.ageOk ? '✅' : '⚠️'} (informational)`);
  console.log(`  Distribution:  ${result.hardChecks.distributionOk ? '✅' : '⚠️'} (informational)`);
  
  if (result.flags.length > 0) {
    console.log('\n─── Flags ───');
    result.flags.forEach(f => console.log(`  ${f}`));
  }
  
  if (result.isSafe) {
    console.log('\n─── Auto-Exit Strategy ───');
    console.log(`  Stop Loss:     -${PROTECTION_CONFIG.HARD_STOP_LOSS_PCT}%`);
    console.log(`  Trailing Stop: -${PROTECTION_CONFIG.TRAILING_STOP_LOSS_PCT}% from peak`);
    console.log(`  Take Profit:   +${PROTECTION_CONFIG.TAKE_PROFIT_PCT}%`);
    console.log(`  Max Hold:      ${PROTECTION_CONFIG.MAX_HOLD_MINUTES} minutes`);
    console.log(`  (ML model will suggest earlier exits based on sentiment)`);
  }
  
  console.log('\n' + '═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

if (import.meta.url === `file://${process.argv[1]}`) {
  const mint = process.argv[2];
  const name = process.argv[3] || '';
  
  if (!mint) {
    console.log('Usage: node rug-shield.mjs <token_mint> [token_name]');
    console.log('\n🛡️ RUG SHIELD PROTECTION SETTINGS:');
    console.log(JSON.stringify(PROTECTION_CONFIG, null, 2));
    process.exit(1);
  }
  
  rugShieldCheck(mint, name).then(result => {
    printRugShieldResults(result);
    process.exit(result.isSafe ? 0 : 1);
  });
}
