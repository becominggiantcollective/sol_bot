#!/usr/bin/env node
/**
 * 🚀 Pre-Flight Check
 * Verifies the bot is ready to run safely
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';

console.log('🚀 PRE-FLIGHT CHECK\n');
console.log('═'.repeat(60));

let checks = { passed: 0, failed: 0, warnings: 0 };

// Check 1: Environment Variables
console.log('\n1️⃣ Checking Environment Variables...');
const hasEnv = fs.existsSync('.env');
if (hasEnv) {
  console.log('   ✅ .env file exists');
  checks.passed++;
} else {
  console.log('   ⚠️ .env file not found (using defaults)');
  checks.warnings++;
}

// Check 2: Required Files
console.log('\n2️⃣ Checking Required Files...');
const requiredFiles = [
  'honeypot-detector.mjs',
  'sniper-safe.mjs',
  'package.json'
];

for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    console.log(`   ✅ ${file} exists`);
    checks.passed++;
  } else {
    console.log(`   ❌ ${file} MISSING`);
    checks.failed++;
  }
}

// Check 3: Node Modules
console.log('\n3️⃣ Checking Dependencies...');
const hasNodeModules = fs.existsSync('node_modules');
if (hasNodeModules) {
  console.log('   ✅ node_modules exists');
  checks.passed++;
} else {
  console.log('   ❌ node_modules missing - run: npm install');
  checks.failed++;
}

// Check 4: RPC Connection
console.log('\n4️⃣ Testing RPC Connection...');
try {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  const connection = new Connection(rpcUrl, 'confirmed');

  const startTime = Date.now();
  const slot = await connection.getSlot();
  const latency = Date.now() - startTime;

  console.log(`   ✅ RPC connected (slot: ${slot})`);
  console.log(`   ⚡ Latency: ${latency}ms`);

  if (latency < 500) {
    console.log('   ✅ Good latency');
    checks.passed++;
  } else if (latency < 1000) {
    console.log('   ⚠️ Moderate latency (consider faster RPC)');
    checks.warnings++;
  } else {
    console.log('   ⚠️ High latency (may impact performance)');
    checks.warnings++;
  }
} catch (error) {
  console.log(`   ❌ RPC connection failed: ${error.message}`);
  checks.failed++;
}

// Check 5: Wallet
console.log('\n5️⃣ Checking Wallet...');
try {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

  console.log(`   ✅ Wallet loaded`);
  console.log(`   📍 Address: ${wallet.publicKey.toString()}`);
  checks.passed++;

  // Check balance
  const rpcUrl = process.env.HELIUS_RPC_URL;
  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  const solBalance = balance / 1e9;

  console.log(`   💰 Balance: ${solBalance.toFixed(6)} SOL`);

  if (solBalance >= 0.01) {
    console.log('   ✅ Sufficient balance for trading');
    checks.passed++;
  } else if (solBalance >= 0.005) {
    console.log('   ⚠️ Low balance - can only make a few trades');
    checks.warnings++;
  } else {
    console.log('   ❌ Insufficient balance - need at least 0.005 SOL');
    checks.failed++;
  }
} catch (error) {
  console.log(`   ❌ Wallet error: ${error.message}`);
  checks.failed++;
}

// Check 6: Jupiter API
console.log('\n6️⃣ Testing Jupiter API...');
try {
  const response = await fetch('https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50', {
    headers: { 'x-api-key': process.env.JUPITER_API_KEY },
    timeout: 10000
  });

  if (response.ok) {
    const data = await response.json();
    if (data.outAmount) {
      console.log('   ✅ Jupiter API working');
      checks.passed++;
    } else {
      console.log('   ⚠️ Jupiter API returned unexpected data');
      checks.warnings++;
    }
  } else {
    console.log(`   ❌ Jupiter API error: HTTP ${response.status}`);
    checks.failed++;
  }
} catch (error) {
  console.log(`   ❌ Jupiter API failed: ${error.message}`);
  checks.failed++;
}

// Check 7: DexScreener API
console.log('\n7️⃣ Testing DexScreener API...');
try {
  const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', {
    timeout: 10000
  });

  if (response.ok) {
    const data = await response.json();
    if (data.pairs) {
      console.log('   ✅ DexScreener API working');
      checks.passed++;
    } else {
      console.log('   ⚠️ DexScreener API returned unexpected data');
      checks.warnings++;
    }
  } else {
    console.log(`   ⚠️ DexScreener API error: HTTP ${response.status}`);
    checks.warnings++;
  }
} catch (error) {
  console.log(`   ⚠️ DexScreener API failed: ${error.message}`);
  checks.warnings++;
}

// Check 8: Honeypot Detector
console.log('\n8️⃣ Testing Honeypot Detector...');
try {
  const { quickCheck } = await import('./honeypot-detector.mjs');

  // Test with SOL (should be whitelisted and safe)
  const result = await quickCheck('So11111111111111111111111111111111111111112', 40);

  if (result.safe && !result.isHoneypot && result.riskScore === 0) {
    console.log('   ✅ Honeypot detector working');
    console.log('   ✅ Whitelisting working');
    checks.passed++;
  } else {
    console.log('   ⚠️ Honeypot detector returned unexpected result');
    console.log(`   Risk Score: ${result.riskScore} (expected: 0)`);
    checks.warnings++;
  }
} catch (error) {
  console.log(`   ❌ Honeypot detector failed: ${error.message}`);
  checks.failed++;
}

// Check 9: Configuration
console.log('\n9️⃣ Checking Bot Configuration...');
try {
  const sniperCode = fs.readFileSync('sniper-safe.mjs', 'utf-8');

  // Extract config
  const maxRiskMatch = sniperCode.match(/maxRiskScore:\s*(\d+)/);
  const tradeAmountMatch = sniperCode.match(/tradeAmountSol:\s*([\d.]+)/);
  const maxPositionsMatch = sniperCode.match(/maxPositions:\s*(\d+)/);

  if (maxRiskMatch) {
    const maxRisk = parseInt(maxRiskMatch[1]);
    console.log(`   ⚙️ maxRiskScore: ${maxRisk}`);

    if (maxRisk <= 40) {
      console.log('   ✅ Conservative/Balanced threshold');
      checks.passed++;
    } else if (maxRisk <= 50) {
      console.log('   ⚠️ Aggressive threshold (higher risk)');
      checks.warnings++;
    } else {
      console.log('   ⚠️ Very aggressive threshold (not recommended)');
      checks.warnings++;
    }
  }

  if (tradeAmountMatch) {
    const tradeAmount = parseFloat(tradeAmountMatch[1]);
    console.log(`   ⚙️ tradeAmountSol: ${tradeAmount}`);

    if (tradeAmount <= 0.001) {
      console.log('   ✅ Safe trade amount');
    } else if (tradeAmount <= 0.01) {
      console.log('   ⚠️ Moderate trade amount');
    } else {
      console.log('   ⚠️ Large trade amount (high risk)');
    }
  }

  if (maxPositionsMatch) {
    const maxPos = parseInt(maxPositionsMatch[1]);
    console.log(`   ⚙️ maxPositions: ${maxPos}`);

    if (maxPos <= 3) {
      console.log('   ✅ Conservative position limit');
    }
  }

} catch (error) {
  console.log(`   ⚠️ Could not read configuration: ${error.message}`);
  checks.warnings++;
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 PRE-FLIGHT CHECK SUMMARY');
console.log('═'.repeat(60));
console.log(`✅ Passed:   ${checks.passed}`);
console.log(`⚠️  Warnings: ${checks.warnings}`);
console.log(`❌ Failed:   ${checks.failed}`);
console.log('═'.repeat(60));

if (checks.failed === 0) {
  if (checks.warnings === 0) {
    console.log('\n🚀 ALL SYSTEMS GO! Ready to launch!');
    console.log('\nTo start the bot:');
    console.log('  node sniper-safe.mjs\n');
  } else {
    console.log('\n⚠️ READY WITH WARNINGS - Review warnings above');
    console.log('\nTo start the bot:');
    console.log('  node sniper-safe.mjs\n');
  }
} else {
  console.log('\n❌ NOT READY - Fix failed checks before launching');
  console.log('\nCommon fixes:');
  console.log('  - Run: npm install');
  console.log('  - Create .env file from .env.example');
  console.log('  - Add SOL to wallet for trading\n');
}

process.exit(checks.failed > 0 ? 1 : 0);
