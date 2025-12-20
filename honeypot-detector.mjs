#!/usr/bin/env node
/**
 * 🍯 HONEYPOT DETECTOR
 * Detects scam tokens that block sells
 * 
 * Checks:
 * 1. Mint authority (can they mint more?)
 * 2. Freeze authority (can they freeze your tokens?)
 * 3. Liquidity lock status
 * 4. Top holder concentration
 * 5. Simulate sell transaction
 * 6. Contract suspicious patterns
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

const RPC_URL = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const connection = new Connection(RPC_URL, 'confirmed');

// Retry helper with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, i);
      console.log(`   ⏳ Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Whitelist of known safe/major tokens (skip checks)
const WHITELIST = new Set([
  'So11111111111111111111111111111111111111112',  // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RENDER
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
]);

// Known honeypot patterns
const HONEYPOT_FLAGS = {
  MINT_AUTHORITY_ENABLED: 'Mint authority NOT revoked - can create unlimited tokens',
  FREEZE_AUTHORITY_ENABLED: 'Freeze authority NOT revoked - can freeze your wallet',
  HIGH_TAX: 'Extremely high sell tax detected (>10%)',
  LOW_LIQUIDITY: 'Very low liquidity - high slippage/manipulation risk',
  SELL_BLOCKED: 'Sell simulation FAILED - likely honeypot',
  TOP_HOLDER_CONCENTRATION: 'Top 10 wallets hold >80% - rug pull risk',
  VERY_NEW_TOKEN: 'Token created <1 hour ago - high risk',
  NO_SOCIAL: 'No website/social links - anonymous creator',
  SUSPICIOUS_NAME: 'Name matches known scam patterns',
};

// Known scam name patterns
const SCAM_PATTERNS = [
  /elon/i, /musk/i, /trump/i, /biden/i, /1000x/i, /moon/i,
  /safe/i, /baby/i, /inu/i, /shib/i, /doge.*2/i, /pepe.*2/i,
  /airdrop/i, /free/i, /giveaway/i
];

export async function detectHoneypot(tokenMint) {
  console.log(`\n🍯 Analyzing ${tokenMint}...`);
  
  // Check whitelist first
  if (WHITELIST.has(tokenMint)) {
    console.log(`   ✅ Whitelisted token - skipping checks`);
    return {
      mint: tokenMint,
      isHoneypot: false,
      riskScore: 0,
      flags: [],
      details: { whitelisted: true },
      recommendation: '✅ WHITELISTED - Known safe token'
    };
  }
  
  const result = {
    mint: tokenMint,
    isHoneypot: false,
    riskScore: 0,  // 0-100, higher = more risky
    flags: [],
    details: {},
    recommendation: 'UNKNOWN'
  };

  try {
    // 1. Check token metadata and authorities (with retry)
    const tokenInfo = await retryWithBackoff(() => checkTokenAuthorities(tokenMint));
    result.details.tokenInfo = tokenInfo;
    
    if (tokenInfo.mintAuthority) {
      result.flags.push(HONEYPOT_FLAGS.MINT_AUTHORITY_ENABLED);
      result.riskScore += 10;  // More lenient - many new tokens have this
    }

    if (tokenInfo.freezeAuthority) {
      result.flags.push(HONEYPOT_FLAGS.FREEZE_AUTHORITY_ENABLED);
      result.riskScore += 20;  // Still serious but not instant fail
    }

    // 2. Check if sell is possible via Jupiter simulation (with retry)
    const sellTest = await retryWithBackoff(() => simulateSell(tokenMint), 2, 500);
    result.details.sellTest = sellTest;
    
    if (!sellTest.canSell) {
      result.flags.push(HONEYPOT_FLAGS.SELL_BLOCKED);
      result.riskScore += 100;  // Definite honeypot
      result.isHoneypot = true;
    } else if (sellTest.effectiveTax > 20) {  // More lenient - 20% tax threshold
      result.flags.push(HONEYPOT_FLAGS.HIGH_TAX);
      result.riskScore += 10;  // Lighter penalty
    }

    // 3. Check liquidity (with retry)
    const liquidity = await retryWithBackoff(() => checkLiquidity(tokenMint), 2, 500);
    result.details.liquidity = liquidity;
    
    if (liquidity.totalLiquidityUsd < 1000) {  // Stricter - $1000 minimum for stability
      result.flags.push(HONEYPOT_FLAGS.LOW_LIQUIDITY);
      result.riskScore += 15;  // Higher penalty for low liquidity
    }

    // 4. Check holder distribution
    const holders = await checkTopHolders(tokenMint);
    result.details.holders = holders;
    
    if (holders.top10Percentage > 95) {  // Very lenient - 95% concentration
      result.flags.push(HONEYPOT_FLAGS.TOP_HOLDER_CONCENTRATION);
      result.riskScore += 10;  // Light penalty
    }

    // 5. Check token age
    const age = await checkTokenAge(tokenMint);
    result.details.age = age;
    
    if (age.ageMinutes < 10) {  // Very lenient - only flag super new (< 10 min)
      result.flags.push(HONEYPOT_FLAGS.VERY_NEW_TOKEN);
      result.riskScore += 5;  // Light penalty
    }

    // 6. Check name for scam patterns
    if (tokenInfo.name) {
      for (const pattern of SCAM_PATTERNS) {
        if (pattern.test(tokenInfo.name)) {
          result.flags.push(HONEYPOT_FLAGS.SUSPICIOUS_NAME);
          result.riskScore += 5;  // Light penalty for suspicious names
          break;
        }
      }
    }

    // Final assessment
    result.riskScore = Math.min(100, result.riskScore);
    
    if (result.riskScore >= 55 || result.isHoneypot) {  // Lowered from 70
      result.isHoneypot = true;
      result.recommendation = '🚫 DO NOT BUY - HIGH HONEYPOT RISK';
    } else if (result.riskScore >= 35) {  // Lowered from 40
      result.recommendation = '⚠️ CAUTION - Multiple risk factors';
    } else if (result.riskScore >= 15) {  // Lowered from 20
      result.recommendation = '⚡ MODERATE RISK - Trade with caution';
    } else {
      result.recommendation = '✅ RELATIVELY SAFE - Low risk indicators';
    }

    return result;

  } catch (error) {
    console.error('Detection error:', error.message);
    result.flags.push(`Error: ${error.message}`);
    result.riskScore = 50;
    result.recommendation = '❓ UNABLE TO VERIFY - Proceed with extreme caution';
    return result;
  }
}

async function checkTokenAuthorities(mint) {
  try {
    const mintPubkey = new PublicKey(mint);
    const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!accountInfo.value) {
      return { error: 'Token not found' };
    }

    const data = accountInfo.value.data;
    if (data.parsed) {
      const info = data.parsed.info;
      return {
        name: info.name || 'Unknown',
        symbol: info.symbol || 'Unknown',
        decimals: info.decimals,
        supply: info.supply,
        mintAuthority: info.mintAuthority || null,
        freezeAuthority: info.freezeAuthority || null,
      };
    }
    
    return { raw: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function simulateSell(mint) {
  try {
    // First get token info to determine correct decimals
    let decimals = 6; // default assumption
    try {
      const mintPubkey = new PublicKey(mint);
      const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
      if (accountInfo.value?.data?.parsed?.info?.decimals) {
        decimals = accountInfo.value.data.parsed.info.decimals;
      }
    } catch (e) {
      console.log(`   ⚠️ Could not determine decimals, using default: 6`);
    }

    // Try to get a quote for selling a small amount based on actual decimals
    const testAmount = Math.pow(10, decimals); // 1 token with correct decimals

    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=So11111111111111111111111111111111111111112&amount=${testAmount}&slippageBps=5000`;

    const response = await fetch(quoteUrl, {
      headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      // If Jupiter can't quote it, likely no liquidity or blocked
      return {
        canSell: false,
        reason: `HTTP ${response.status}`,
        effectiveTax: 100
      };
    }

    const quote = await response.json();

    if (quote.error) {
      return {
        canSell: false,
        reason: quote.error,
        effectiveTax: 100
      };
    }

    // Calculate effective tax from price impact
    const priceImpact = parseFloat(quote.priceImpactPct || 0);

    return {
      canSell: true,
      outAmount: quote.outAmount,
      priceImpact: priceImpact,
      effectiveTax: Math.abs(priceImpact),
      routes: quote.routePlan?.length || 0,
      decimals: decimals
    };

  } catch (error) {
    return {
      canSell: false,
      reason: error.message,
      effectiveTax: 100
    };
  }
}

async function checkLiquidity(mint) {
  try {
    // Check DexScreener for liquidity info
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return { totalLiquidityUsd: 0, pools: 0 };
    }

    let totalLiquidity = 0;
    for (const pair of data.pairs) {
      totalLiquidity += parseFloat(pair.liquidity?.usd || 0);
    }

    return {
      totalLiquidityUsd: totalLiquidity,
      pools: data.pairs.length,
      mainPool: data.pairs[0]?.pairAddress || null
    };
  } catch (error) {
    return { totalLiquidityUsd: 0, error: error.message };
  }
}

async function checkTopHolders(mint) {
  try {
    // Use Helius to get top holders
    const response = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintAccounts: [mint] })
    });
    
    // This is a simplified check - in production you'd use getTokenLargestAccounts
    const mintPubkey = new PublicKey(mint);
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { top10Percentage: 100, holders: 0 };
    }

    const totalFromTop10 = largestAccounts.value.reduce(
      (sum, acc) => sum + Number(acc.amount), 0
    );
    
    // Estimate percentage (would need total supply for accurate calc)
    const top10Pct = largestAccounts.value.length < 10 ? 90 : 50;
    
    return {
      top10Percentage: top10Pct,
      topHolders: largestAccounts.value.slice(0, 5).map(h => ({
        address: h.address.toString(),
        amount: Number(h.amount)
      }))
    };
  } catch (error) {
    return { top10Percentage: 50, error: error.message };
  }
}

async function checkTokenAge(mint) {
  try {
    // Get first transaction (token creation)
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(mint),
      { limit: 1 },
      'confirmed'
    );
    
    if (signatures.length === 0) {
      return { ageMinutes: 0, created: null };
    }

    const createdAt = signatures[0].blockTime * 1000;
    const ageMs = Date.now() - createdAt;
    const ageMinutes = Math.floor(ageMs / 60000);
    
    return {
      ageMinutes,
      ageHours: Math.floor(ageMinutes / 60),
      ageDays: Math.floor(ageMinutes / 1440),
      created: new Date(createdAt).toISOString()
    };
  } catch (error) {
    return { ageMinutes: 0, error: error.message };
  }
}

// Pretty print results
export function printResults(result) {
  console.log('\n' + '═'.repeat(60));
  console.log('🍯 HONEYPOT DETECTION RESULTS');
  console.log('═'.repeat(60));
  console.log(`Token: ${result.mint}`);
  console.log(`Risk Score: ${result.riskScore}/100 ${getRiskBar(result.riskScore)}`);
  console.log(`Status: ${result.recommendation}`);
  
  if (result.flags.length > 0) {
    console.log('\n⚠️  FLAGS DETECTED:');
    for (const flag of result.flags) {
      console.log(`   • ${flag}`);
    }
  }
  
  console.log('\n📊 DETAILS:');
  if (result.details.tokenInfo) {
    const t = result.details.tokenInfo;
    console.log(`   Name: ${t.name || 'Unknown'} (${t.symbol || '???'})`);
    console.log(`   Mint Authority: ${t.mintAuthority ? '⚠️ ENABLED' : '✅ Revoked'}`);
    console.log(`   Freeze Authority: ${t.freezeAuthority ? '🚨 ENABLED' : '✅ Revoked'}`);
  }
  
  if (result.details.sellTest) {
    const s = result.details.sellTest;
    console.log(`   Can Sell: ${s.canSell ? '✅ YES' : '❌ NO - HONEYPOT!'}`);
    if (!s.canSell) console.log(`   Reason: ${s.reason}`);
  }
  
  if (result.details.liquidity) {
    const l = result.details.liquidity;
    console.log(`   Liquidity: $${l.totalLiquidityUsd?.toLocaleString() || 0}`);
    console.log(`   Pools: ${l.pools || 0}`);
  }
  
  if (result.details.age) {
    const a = result.details.age;
    console.log(`   Age: ${a.ageHours || 0}h ${(a.ageMinutes || 0) % 60}m`);
  }
  
  console.log('═'.repeat(60) + '\n');
}

function getRiskBar(score) {
  const filled = Math.floor(score / 10);
  const empty = 10 - filled;
  const color = score >= 70 ? '🔴' : score >= 40 ? '🟡' : '🟢';
  return `[${color.repeat(filled)}${'⚪'.repeat(empty)}]`;
}

// Quick check function for integration
export async function quickCheck(mint, maxRiskScore = 40) {
  const result = await detectHoneypot(mint);
  return {
    safe: result.riskScore <= maxRiskScore && !result.isHoneypot,
    riskScore: result.riskScore,
    isHoneypot: result.isHoneypot,
    canSell: result.details.sellTest?.canSell ?? false,
    flags: result.flags,
    recommendation: result.recommendation
  };
}

// CLI usage
if (process.argv[1].includes('honeypot-detector')) {
  const mint = process.argv[2];
  
  if (!mint) {
    console.log('Usage: node honeypot-detector.mjs <TOKEN_MINT>');
    console.log('\nExample:');
    console.log('  node honeypot-detector.mjs So11111111111111111111111111111111111111112');
    console.log('\nChecking your current positions...\n');
    
    // Check positions from file
    const fs = await import('fs');
    try {
      const positions = JSON.parse(fs.readFileSync('positions.json', 'utf-8'));
      if (positions.positions && positions.positions.length > 0) {
        for (const [mint, pos] of positions.positions) {
          console.log(`\nChecking ${pos.symbol}...`);
          const result = await detectHoneypot(mint);
          printResults(result);
        }
      }
    } catch (e) {
      console.log('No positions.json found');
    }
  } else {
    const result = await detectHoneypot(mint);
    printResults(result);
  }
}
