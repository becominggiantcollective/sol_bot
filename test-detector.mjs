#!/usr/bin/env node
/**
 * 🧪 HONEYPOT DETECTOR INTEGRATION TEST
 * Tests detector against known honeypots and safe tokens
 */

import { detectHoneypot, printResults, quickCheck } from './honeypot-detector.mjs';

// Known honeypots your bot got trapped in
const KNOWN_HONEYPOTS = [
  { mint: 'dX2UgSnfrW4BktiYcDFepiaiHTZcushT4NpLFaksrxA', name: 'Dusty (trapped)' },
  { mint: '6fGeMYeT4ZJsWcZnT3Y1neDRSZFThYYa28uWoKbTsgHd', name: 'Sports (trapped)' },
];

// Known safe/legit tokens
const KNOWN_SAFE = [
  { mint: 'So11111111111111111111111111111111111111112', name: 'SOL (wrapped)' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK' },
];

async function runIntegrationTests() {
  console.log('═'.repeat(60));
  console.log('🧪 HONEYPOT DETECTOR INTEGRATION TEST');
  console.log('═'.repeat(60));
  
  let passed = 0;
  let failed = 0;

  // Test known honeypots - should detect as unsafe
  console.log('\n📍 Testing KNOWN HONEYPOTS (should detect as unsafe):');
  console.log('─'.repeat(60));
  
  for (const token of KNOWN_HONEYPOTS) {
    try {
      console.log(`\nTesting ${token.name}...`);
      const result = await quickCheck(token.mint);
      
      if (result.riskScore >= 50 || result.isHoneypot || !result.canSell) {
        console.log(`✅ PASSED - Detected as risky (score: ${result.riskScore}, honeypot: ${result.isHoneypot})`);
        passed++;
      } else {
        console.log(`❌ FAILED - Did NOT detect honeypot (score: ${result.riskScore})`);
        failed++;
      }
    } catch (error) {
      console.log(`⚠️ Error testing: ${error.message}`);
    }
    await sleep(1000);
  }

  // Test known safe tokens - should pass
  console.log('\n\n📍 Testing KNOWN SAFE TOKENS (should pass):');
  console.log('─'.repeat(60));
  
  for (const token of KNOWN_SAFE) {
    try {
      console.log(`\nTesting ${token.name}...`);
      const result = await quickCheck(token.mint);
      
      if (result.safe || result.riskScore < 40) {
        console.log(`✅ PASSED - Detected as safe (score: ${result.riskScore})`);
        passed++;
      } else {
        console.log(`❌ FAILED - False positive! Marked safe token as risky (score: ${result.riskScore})`);
        failed++;
      }
    } catch (error) {
      console.log(`⚠️ Error testing: ${error.message}`);
    }
    await sleep(1000);
  }

  // Summary
  console.log('\n\n' + '═'.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Accuracy: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('═'.repeat(60));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runIntegrationTests().catch(console.error);
