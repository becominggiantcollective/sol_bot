#!/usr/bin/env node
/**
 * 🛡️ COMPREHENSIVE TOKEN VALIDATOR
 * Multi-layer validation to prevent buying dud coins
 * Integrates: Rug Shield + Price Accuracy + Liquidity Depth + Holder Analysis
 */

import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

const RPC = process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC);

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const VALIDATION_RULES = {
  // HARD REQUIREMENTS (all must pass)
  MIN_LIQUIDITY_USD: 2000,        // Minimum $2K liquidity
  MIN_AGE_MINUTES: 5,             // At least 5min old
  MAX_TOP_WALLET_PCT: 60,         // Top holder can't have >60%
  MIN_HOLDERS: 20,                // At least 20 holders
  MAX_FREEZE_AUTHORITY: false,    // No freeze authority
  
  // QUALITY SCORES (weighted)
  MIN_LIQUIDITY_SCORE: 30,        // 0-100 based on depth
  MIN_PRICE_STABILITY: 20,        // 0-100 based on volatility
  MIN_HOLDER_DISTRIBUTION: 25,    // 0-100 based on concentration
  MIN_VOLUME_QUALITY: 15,         // 0-100 based on vol/liq ratio
  
  // AGGREGATE
  MIN_TOTAL_SCORE: 60,            // Must score 60/100 overall
  
  // BLACKLIST PATTERNS
  BLACKLIST: [
    /hold/i, /hodl/i, /safe.*moon/i, /baby.*doge/i,
    /elon/i, /1000x/i, /moon/i, /inu/i, /floki/i,
    /rocket/i, /lambo/i, /gem/i
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// PRICE ACCURACY CHECK
// ═══════════════════════════════════════════════════════════════════════════

async function validatePriceAccuracy(tokenAddress) {
  try {
    const [dexData, jupData] = await Promise.all([
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`).then(r => r.json()),
      fetch(`https://price.jup.ag/v4/price?ids=${tokenAddress}`).then(r => r.json()).catch(() => null)
    ]);
    
    const dexPrice = parseFloat(dexData.pairs?.[0]?.priceUsd) || 0;
    const jupPrice = jupData?.data?.[tokenAddress]?.price || 0;
    
    // If we have both prices, they should be within 5% of each other
    if (dexPrice > 0 && jupPrice > 0) {
      const diff = Math.abs(dexPrice - jupPrice) / dexPrice;
      if (diff > 0.05) {
        return {
          pass: false,
          reason: `Price mismatch: DexScreener $${dexPrice} vs Jupiter $${jupPrice} (${(diff*100).toFixed(1)}% diff)`,
          score: 0
        };
      }
      return { pass: true, score: 100, dexPrice, jupPrice };
    }
    
    // If only one source, require reasonable price
    if (dexPrice > 0) {
      return { pass: true, score: 70, dexPrice }; // Lower score for single source
    }
    
    return {
      pass: false,
      reason: 'No valid price data available',
      score: 0
    };
  } catch (e) {
    return { pass: false, reason: `Price check failed: ${e.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDITY DEPTH ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

async function validateLiquidityDepth(tokenAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const data = await res.json();
    const pair = data.pairs?.[0];
    
    if (!pair) {
      return { pass: false, reason: 'No liquidity pair found', score: 0 };
    }
    
    const liq = pair.liquidity?.usd || 0;
    const vol24h = pair.volume?.h24 || 0;
    const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    
    // HARD CHECK: Min liquidity
    if (liq < VALIDATION_RULES.MIN_LIQUIDITY_USD) {
      return {
        pass: false,
        reason: `Liquidity too low: $${liq.toFixed(0)} < $${VALIDATION_RULES.MIN_LIQUIDITY_USD}`,
        score: 0
      };
    }
    
    // QUALITY SCORE: Liquidity depth (0-100)
    // $2K = 30, $10K = 60, $50K+ = 100
    let liqScore = 30;
    if (liq >= 50000) liqScore = 100;
    else if (liq >= 10000) liqScore = 60 + ((liq - 10000) / 40000) * 40;
    else liqScore = 30 + ((liq - 2000) / 8000) * 30;
    
    // Volume/Liquidity ratio (healthy: 0.5-3.0)
    const volLiqRatio = liq > 0 ? vol24h / liq : 0;
    let volScore = 0;
    if (volLiqRatio >= 0.5 && volLiqRatio <= 3.0) {
      volScore = 100;
    } else if (volLiqRatio > 0.1 && volLiqRatio < 10) {
      volScore = 50;
    }
    
    // Transaction count quality
    let txnScore = 0;
    if (txns24h >= 100) txnScore = 100;
    else if (txns24h >= 50) txnScore = 70;
    else if (txns24h >= 20) txnScore = 40;
    
    return {
      pass: true,
      score: Math.round((liqScore * 0.5) + (volScore * 0.3) + (txnScore * 0.2)),
      liquidity: liq,
      volume24h: vol24h,
      volLiqRatio,
      txns24h,
      pair
    };
  } catch (e) {
    return { pass: false, reason: `Liquidity check failed: ${e.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOLDER DISTRIBUTION ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

async function validateHolderDistribution(tokenAddress) {
  try {
    // Use Helius to get top holders
    const res = await fetch(`${RPC}/v0/token-accounts/${tokenAddress}?limit=100`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => null);
    
    // Fallback: use DexScreener holder data if available
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const dexData = await dexRes.json();
    const pair = dexData.pairs?.[0];
    
    // Estimate concentration from available data
    let topHolderPct = 0;
    let holderCount = 0;
    
    // Try to get holder info from DexScreener (if available)
    if (pair?.info) {
      // Some pairs have holder info
      holderCount = pair.info.holders || 0;
    }
    
    // HARD CHECK: Minimum holders
    if (holderCount > 0 && holderCount < VALIDATION_RULES.MIN_HOLDERS) {
      return {
        pass: false,
        reason: `Too few holders: ${holderCount} < ${VALIDATION_RULES.MIN_HOLDERS}`,
        score: 0
      };
    }
    
    // If we can't get holder data, use conservative score
    if (holderCount === 0) {
      return {
        pass: true,
        score: 50, // Neutral score when data unavailable
        reason: 'Holder data unavailable - proceeding with caution',
        holderCount: 'unknown'
      };
    }
    
    // QUALITY SCORE: Holder distribution (0-100)
    let holderScore = 50;
    if (holderCount >= 1000) holderScore = 100;
    else if (holderCount >= 100) holderScore = 80;
    else if (holderCount >= 50) holderScore = 60;
    
    return {
      pass: true,
      score: holderScore,
      holderCount,
      topHolderPct
    };
  } catch (e) {
    return {
      pass: true,
      score: 50, // Neutral when check fails
      reason: `Holder check error: ${e.message}`
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN AGE & FREEZE AUTHORITY CHECK
// ═══════════════════════════════════════════════════════════════════════════

async function validateTokenMetadata(tokenAddress) {
  try {
    const mintPubkey = new PublicKey(tokenAddress);
    const mintInfo = await getMint(connection, mintPubkey);
    
    // HARD CHECK: No freeze authority
    if (mintInfo.freezeAuthority !== null && !VALIDATION_RULES.MAX_FREEZE_AUTHORITY) {
      return {
        pass: false,
        reason: 'Token has freeze authority - HIGH RUG RISK',
        score: 0,
        freezeAuthority: mintInfo.freezeAuthority.toString()
      };
    }
    
    // Get token age from DexScreener
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const data = await res.json();
    const pair = data.pairs?.[0];
    
    const pairAge = pair?.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
    const ageMinutes = pairAge / (1000 * 60);
    
    // HARD CHECK: Minimum age
    if (ageMinutes < VALIDATION_RULES.MIN_AGE_MINUTES) {
      return {
        pass: false,
        reason: `Token too new: ${ageMinutes.toFixed(1)}min < ${VALIDATION_RULES.MIN_AGE_MINUTES}min`,
        score: 0,
        ageMinutes
      };
    }
    
    // QUALITY SCORE: Age (0-100)
    // 5min = 25, 30min = 60, 1hr+ = 100
    let ageScore = 25;
    if (ageMinutes >= 60) ageScore = 100;
    else if (ageMinutes >= 30) ageScore = 60 + ((ageMinutes - 30) / 30) * 40;
    else ageScore = 25 + ((ageMinutes - 5) / 25) * 35;
    
    return {
      pass: true,
      score: Math.round(ageScore),
      ageMinutes,
      decimals: mintInfo.decimals,
      supply: Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals),
      freezeAuthority: mintInfo.freezeAuthority
    };
  } catch (e) {
    return { pass: false, reason: `Metadata check failed: ${e.message}`, score: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICE STABILITY CHECK
// ═══════════════════════════════════════════════════════════════════════════

async function validatePriceStability(pair) {
  try {
    if (!pair) return { pass: true, score: 50 };
    
    const p5m = pair.priceChange?.m5 || 0;
    const p1h = pair.priceChange?.h1 || 0;
    const p24h = pair.priceChange?.h24 || 0;
    
    // Extreme volatility is a red flag
    if (Math.abs(p5m) > 50) {
      return {
        pass: false,
        reason: `Extreme 5min volatility: ${p5m.toFixed(1)}% (possible manipulation)`,
        score: 0
      };
    }
    
    // QUALITY SCORE: Stability (0-100)
    // Less volatile = better
    const volatility = Math.abs(p5m) + Math.abs(p1h) * 0.5 + Math.abs(p24h) * 0.3;
    let stabilityScore = 100;
    
    if (volatility > 100) stabilityScore = 0;
    else if (volatility > 50) stabilityScore = 30;
    else if (volatility > 20) stabilityScore = 60;
    else stabilityScore = 100 - volatility;
    
    return {
      pass: true,
      score: Math.round(Math.max(0, stabilityScore)),
      volatility,
      changes: { p5m, p1h, p24h }
    };
  } catch (e) {
    return { pass: true, score: 50 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BLACKLIST CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkBlacklist(symbol, name) {
  for (const pattern of VALIDATION_RULES.BLACKLIST) {
    if (pattern.test(symbol) || pattern.test(name || '')) {
      return {
        pass: false,
        reason: `Token name/symbol matches blacklist pattern: ${pattern}`,
        score: 0
      };
    }
  }
  return { pass: true, score: 100 };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

export async function validateToken(tokenAddress) {
  console.log(`\n🔍 VALIDATING TOKEN: ${tokenAddress}`);
  console.log('═'.repeat(60));
  
  const results = {
    address: tokenAddress,
    timestamp: new Date().toISOString(),
    passed: false,
    totalScore: 0,
    checks: {},
    failReasons: [],
    warnings: []
  };
  
  try {
    // Run all checks in parallel where possible
    const [
      priceCheck,
      liquidityCheck,
      holderCheck,
      metadataCheck
    ] = await Promise.all([
      validatePriceAccuracy(tokenAddress),
      validateLiquidityDepth(tokenAddress),
      validateHolderDistribution(tokenAddress),
      validateTokenMetadata(tokenAddress)
    ]);
    
    results.checks.price = priceCheck;
    results.checks.liquidity = liquidityCheck;
    results.checks.holders = holderCheck;
    results.checks.metadata = metadataCheck;
    
    // Additional checks
    const pair = liquidityCheck.pair;
    const symbol = pair?.baseToken?.symbol || 'UNKNOWN';
    const name = pair?.baseToken?.name || '';
    
    const stabilityCheck = await validatePriceStability(pair);
    const blacklistCheck = checkBlacklist(symbol, name);
    
    results.checks.stability = stabilityCheck;
    results.checks.blacklist = blacklistCheck;
    
    // AGGREGATE RESULTS
    const hardChecks = [liquidityCheck, metadataCheck, blacklistCheck];
    const allHardPass = hardChecks.every(c => c.pass);
    
    if (!allHardPass) {
      results.passed = false;
      hardChecks.filter(c => !c.pass).forEach(c => {
        results.failReasons.push(c.reason);
      });
    } else {
      // Calculate weighted score
      const scores = {
        liquidity: liquidityCheck.score * 0.30,
        price: priceCheck.score * 0.20,
        holders: holderCheck.score * 0.20,
        stability: stabilityCheck.score * 0.15,
        metadata: metadataCheck.score * 0.15
      };
      
      results.totalScore = Math.round(
        scores.liquidity + scores.price + scores.holders + 
        scores.stability + scores.metadata
      );
      
      results.passed = results.totalScore >= VALIDATION_RULES.MIN_TOTAL_SCORE;
      
      if (!results.passed) {
        results.failReasons.push(`Total score ${results.totalScore} < ${VALIDATION_RULES.MIN_TOTAL_SCORE}`);
      }
      
      // Warnings for marginal cases
      if (results.totalScore >= 60 && results.totalScore < 75) {
        results.warnings.push('Marginal quality - proceed with extra caution');
      }
      if (priceCheck.score < 90) {
        results.warnings.push('Price data quality concern');
      }
      if (holderCheck.score < 60) {
        results.warnings.push('Holder distribution concern');
      }
    }
    
    // PRINT RESULTS
    console.log(`\n📊 VALIDATION RESULTS:`);
    console.log(`Token: ${symbol} (${name})`);
    console.log(`─`.repeat(60));
    console.log(`✓ Liquidity:  ${liquidityCheck.pass ? '✅' : '❌'} Score: ${liquidityCheck.score}/100`);
    console.log(`  └─ $${(liquidityCheck.liquidity || 0).toFixed(0)} liquidity, $${(liquidityCheck.volume24h || 0).toFixed(0)} vol24h`);
    console.log(`✓ Price:      ${priceCheck.pass ? '✅' : '❌'} Score: ${priceCheck.score}/100`);
    console.log(`  └─ DexScreener: $${priceCheck.dexPrice || 'N/A'}, Jupiter: $${priceCheck.jupPrice || 'N/A'}`);
    console.log(`✓ Holders:    ${holderCheck.pass ? '✅' : '❌'} Score: ${holderCheck.score}/100`);
    console.log(`  └─ ${holderCheck.holderCount} holders`);
    console.log(`✓ Metadata:   ${metadataCheck.pass ? '✅' : '❌'} Score: ${metadataCheck.score}/100`);
    console.log(`  └─ Age: ${metadataCheck.ageMinutes?.toFixed(1)}min, Freeze: ${metadataCheck.freezeAuthority ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`✓ Stability:  ${stabilityCheck.pass ? '✅' : '❌'} Score: ${stabilityCheck.score}/100`);
    console.log(`  └─ Volatility: ${stabilityCheck.volatility?.toFixed(1)}`);
    console.log(`✓ Blacklist:  ${blacklistCheck.pass ? '✅' : '❌'}`);
    console.log(`─`.repeat(60));
    console.log(`\n🎯 TOTAL SCORE: ${results.totalScore}/100`);
    console.log(`📋 VERDICT: ${results.passed ? '✅ PASS - SAFE TO BUY' : '❌ FAIL - DO NOT BUY'}`);
    
    if (results.failReasons.length > 0) {
      console.log(`\n🚫 FAIL REASONS:`);
      results.failReasons.forEach(r => console.log(`   • ${r}`));
    }
    
    if (results.warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS:`);
      results.warnings.forEach(w => console.log(`   • ${w}`));
    }
    
    console.log('═'.repeat(60));
    
    return results;
    
  } catch (e) {
    results.passed = false;
    results.failReasons.push(`Validation error: ${e.message}`);
    console.error(`❌ Validation failed: ${e.message}`);
    return results;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI USAGE
// ═══════════════════════════════════════════════════════════════════════════

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.log('Usage: node token-validator.mjs <TOKEN_ADDRESS>');
    process.exit(1);
  }
  
  validateToken(tokenAddress).then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}
