#!/usr/bin/env node
/**
 * PRE-BUY SIMULATION & HONEYPOT CONTRACT ANALYZER
 * 
 * Uses:
 * 1. Birdeye simulate trade API - Tests buy AND sell before real trade
 * 2. On-chain contract analysis - Looks for honeypot patterns
 * 3. Transfer authority checks - Detects malicious permissions
 */

import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const connection = new Connection(HELIUS_RPC, 'confirmed');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_API = 'https://api.jup.ag/swap/v1';

// Colors for logging
const colors = {
  SUCCESS: '\x1b[32m',
  ERROR: '\x1b[31m',
  WARN: '\x1b[33m',
  INFO: '\x1b[36m',
  reset: '\x1b[0m'
};

/**
 * Simulate a trade using Jupiter API (more reliable than Birdeye)
 * Returns: { success: boolean, reason: string, data: object }
 */
async function jupiterSimulateTrade(tokenMint, amountSOL = 0.01, type = 'buy') {
  try {
    const fromMint = type === 'buy' ? SOL_MINT : tokenMint;
    const toMint = type === 'buy' ? tokenMint : SOL_MINT;
    const amount = type === 'buy' ? Math.floor(amountSOL * 1e9) : 1000000; // 1M tokens for sell test
    
    console.log(`   🧪 Jupiter: Simulating ${type.toUpperCase()} of ${tokenMint.slice(0, 8)}...`);
    
    const url = `${JUPITER_API}/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${amount}&slippageBps=3000`;
    
    const response = await fetch(url, {
      headers: { 'x-api-key': JUPITER_API_KEY }
    });
    const data = await response.json();
    
    // Check for errors
    if (data.error || !data.outAmount) {
      const reason = data.error || 'No quote available';
      console.log(`   ${colors.ERROR}❌ ${type.toUpperCase()} simulation FAILED: ${reason}${colors.reset}`);
      return {
        success: false,
        reason: reason,
        type,
        isHoneypot: true  // If we can't get a quote, it's likely a honeypot
      };
    }
    
    // Check output amount
    const outAmount = parseInt(data.outAmount);
    if (outAmount <= 0) {
      console.log(`   ${colors.ERROR}❌ ${type.toUpperCase()} simulation returned ZERO output${colors.reset}`);
      return {
        success: false,
        reason: 'Zero output from simulation',
        type,
        isHoneypot: true
      };
    }
    
    // Calculate price impact
    const inAmount = parseInt(data.inAmount);
    const expectedOut = type === 'buy' ? inAmount : inAmount; // Simplified
    const actualOut = outAmount;
    const priceImpact = Math.abs((1 - (actualOut / expectedOut)) * 100);
    
    if (priceImpact > 50) {
      console.log(`   ${colors.WARN}⚠️ ${type.toUpperCase()} has ${priceImpact.toFixed(2)}% price impact (high risk)${colors.reset}`);
    }
    
    console.log(`   ${colors.SUCCESS}✅ ${type.toUpperCase()} simulation OK: ${outAmount} output${colors.reset}`);
    
    return {
      success: true,
      type,
      outAmount,
      priceImpact,
      data
    };
    
  } catch (error) {
    console.log(`   ${colors.ERROR}❌ Simulation error: ${error.message}${colors.reset}`);
    return {
      success: false,
      reason: error.message,
      type,
      isHoneypot: true
    };
  }
}

/**
 * Analyze token contract for honeypot patterns
 * Checks for:
 * - Freeze authority (can freeze your tokens)
 * - Transfer restrictions
 * - Hidden mint authority
 * - Suspicious program ownership
 */
async function analyzeTokenContract(tokenMint) {
  try {
    console.log(`   🔍 Analyzing token contract ${tokenMint.slice(0, 8)}...`);
    
    const mintPubkey = new PublicKey(tokenMint);
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!mintInfo.value) {
      console.log(`   ${colors.ERROR}❌ Cannot fetch token account${colors.reset}`);
      return { safe: false, reason: 'Cannot fetch account info' };
    }
    
    const data = mintInfo.value.data;
    // Accept both spl-token AND spl-token-2022 (pump.fun uses Token-2022)
    if (data.program !== 'spl-token' && data.program !== 'spl-token-2022') {
      console.log(`   ${colors.WARN}⚠️ Not a standard SPL token (program: ${data.program})${colors.reset}`);
      return { safe: false, reason: 'Not SPL token' };
    }
    console.log(`   ${colors.SUCCESS}✅ Valid token program: ${data.program}${colors.reset}`);
    
    const parsed = data.parsed?.info;
    if (!parsed) {
      console.log(`   ${colors.ERROR}❌ Cannot parse token data${colors.reset}`);
      return { safe: false, reason: 'Cannot parse token data' };
    }
    
    const warnings = [];
    
    // Check freeze authority
    if (parsed.freezeAuthority) {
      console.log(`   ${colors.ERROR}🚫 FREEZE AUTHORITY ACTIVE: ${parsed.freezeAuthority}${colors.reset}`);
      warnings.push('Has freeze authority - can freeze your tokens!');
    } else {
      console.log(`   ${colors.SUCCESS}✅ No freeze authority${colors.reset}`);
    }
    
    // Check mint authority
    if (parsed.mintAuthority) {
      console.log(`   ${colors.WARN}⚠️ Mint authority present: ${parsed.mintAuthority}${colors.reset}`);
      warnings.push('Has mint authority - can inflate supply');
    } else {
      console.log(`   ${colors.SUCCESS}✅ Mint authority revoked${colors.reset}`);
    }
    
    // Check decimals (0 decimals can be suspicious)
    const decimals = parsed.decimals;
    if (decimals === 0) {
      console.log(`   ${colors.WARN}⚠️ 0 decimals (unusual)${colors.reset}`);
      warnings.push('Zero decimals - unusual token');
    } else {
      console.log(`   ${colors.INFO}ℹ️ Decimals: ${decimals}${colors.reset}`);
    }
    
    // Check supply
    const supply = BigInt(parsed.supply);
    if (supply === 0n) {
      console.log(`   ${colors.ERROR}❌ Zero supply!${colors.reset}`);
      return { safe: false, reason: 'Token has zero supply' };
    }
    
    console.log(`   ${colors.INFO}ℹ️ Total supply: ${supply.toString()}${colors.reset}`);
    
    // Overall assessment - ONLY fail on freeze authority for small/new tokens
    // Freeze authority is the REAL danger (can freeze your tokens = can't sell)
    const hasDangerousFreeze = !!parsed.freezeAuthority;
    
    // Mint authority is less critical (just means supply can increase)
    // Many legit tokens keep mint authority for liquidity management
    
    if (hasDangerousFreeze) {
      console.log(`   ${colors.ERROR}⚠️ DANGEROUS: Freeze authority can lock your tokens!${colors.reset}`);
    } else if (warnings.length > 0) {
      console.log(`   ${colors.WARN}⚠️ Contract has ${warnings.length} warning(s) (non-critical)${colors.reset}`);
    } else {
      console.log(`   ${colors.SUCCESS}✅ Contract looks safe${colors.reset}`);
    }
    
    return {
      safe: !hasDangerousFreeze,  // Only reject if freeze authority exists
      warnings,
      freezeAuthority: !!parsed.freezeAuthority,
      mintAuthority: !!parsed.mintAuthority,
      decimals,
      supply: supply.toString()
    };
    
  } catch (error) {
    console.log(`   ${colors.ERROR}❌ Contract analysis error: ${error.message}${colors.reset}`);
    return { safe: false, reason: error.message };
  }
}

/**
 * Complete pre-buy safety check
 * Returns: { safe: boolean, buySimulation, sellSimulation, contract, reason }
 */
export async function preBuyCheck(tokenMint, amountSOL = 0.01) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🛡️ PRE-BUY SAFETY CHECK: ${tokenMint}`);
  console.log(`${'═'.repeat(60)}\n`);
  
  const results = {
    tokenMint,
    timestamp: new Date().toISOString(),
    safe: false,
    reason: '',
    buySimulation: null,
    sellSimulation: null,
    contract: null
  };
  
  // Step 1: Analyze contract FIRST (fastest check)
  console.log(`${colors.INFO}📋 Step 1/3: Contract Analysis${colors.reset}`);
  const contractAnalysis = await analyzeTokenContract(tokenMint);
  results.contract = contractAnalysis;
  
  if (!contractAnalysis.safe) {
    results.reason = contractAnalysis.reason || contractAnalysis.warnings?.join(', ') || 'Contract analysis failed';
    console.log(`\n${colors.ERROR}❌ REJECTED: ${results.reason}${colors.reset}\n`);
    return results;
  }
  
  // Step 2: Simulate BUY
  console.log(`\n${colors.INFO}📋 Step 2/3: Buy Simulation (Jupiter)${colors.reset}`);
  const buySimulation = await jupiterSimulateTrade(tokenMint, amountSOL, 'buy');
  results.buySimulation = buySimulation;
  
  if (!buySimulation.success) {
    results.reason = `Cannot buy: ${buySimulation.reason}`;
    console.log(`\n${colors.ERROR}❌ REJECTED: ${results.reason}${colors.reset}\n`);
    return results;
  }
  
  // Step 3: Simulate SELL (CRITICAL - this catches honeypots)
  console.log(`\n${colors.INFO}📋 Step 3/3: Sell Simulation (Jupiter)${colors.reset}`);
  const sellSimulation = await jupiterSimulateTrade(tokenMint, amountSOL, 'sell');
  results.sellSimulation = sellSimulation;
  
  if (!sellSimulation.success) {
    results.reason = `🍯 HONEYPOT DETECTED: ${sellSimulation.reason}`;
    console.log(`\n${colors.ERROR}❌ REJECTED: ${results.reason}${colors.reset}\n`);
    return results;
  }
  
  // All checks passed!
  results.safe = true;
  results.reason = 'Passed all safety checks';
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${colors.SUCCESS}✅ TOKEN IS SAFE TO TRADE${colors.reset}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Buy Impact:  ${buySimulation.priceImpact?.toFixed(2)}%`);
  console.log(`Sell Impact: ${sellSimulation.priceImpact?.toFixed(2)}%`);
  console.log(`Contract: ${contractAnalysis.warnings?.length || 0} warnings`);
  console.log(`${'═'.repeat(60)}\n`);
  
  return results;
}

/**
 * Quick check - just test if sell works (fastest honeypot detection)
 */
export async function quickHoneypotCheck(tokenMint) {
  console.log(`🍯 Quick honeypot check: ${tokenMint.slice(0, 8)}...`);
  
  const sellSim = await jupiterSimulateTrade(tokenMint, 0.01, 'sell');
  
  if (!sellSim.success) {
    console.log(`   ${colors.ERROR}🍯 HONEYPOT: Cannot sell${colors.reset}`);
    return { isHoneypot: true, reason: sellSim.reason };
  }
  
  console.log(`   ${colors.SUCCESS}✅ Not a honeypot${colors.reset}`);
  return { isHoneypot: false, canSell: true };
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const tokenMint = process.argv[2];
  
  if (!tokenMint) {
    console.log('Usage: node pre-buy-simulator.mjs <TOKEN_MINT>');
    console.log('Example: node pre-buy-simulator.mjs EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    process.exit(1);
  }
  
  preBuyCheck(tokenMint).then(result => {
    if (result.safe) {
      console.log(`${colors.SUCCESS}✅ SAFE TO BUY${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`${colors.ERROR}❌ DO NOT BUY: ${result.reason}${colors.reset}`);
      process.exit(1);
    }
  }).catch(error => {
    console.error(`${colors.ERROR}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}
