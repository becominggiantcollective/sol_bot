#!/usr/bin/env node
/**
 * 🧪 Test Honeypot Detector
 * Tests the honeypot detector with known tokens
 */

import { detectHoneypot, quickCheck, printResults } from './honeypot-detector.mjs';

// Test cases
const TEST_TOKENS = {
  // Known safe tokens (whitelisted)
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',

  // You can add suspicious tokens here to test
  // SUSPICIOUS: 'token_address_here'
};

async function runTests() {
  console.log('🧪 Starting Honeypot Detector Tests\n');
  console.log('═'.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const [name, mint] of Object.entries(TEST_TOKENS)) {
    console.log(`\n\n🧪 Testing: ${name}`);
    console.log('─'.repeat(60));

    try {
      // Test full detection
      const fullResult = await detectHoneypot(mint);
      printResults(fullResult);

      // Test quick check
      console.log('\n📊 Quick Check Result:');
      const quickResult = await quickCheck(mint, 40);
      console.log(`   Safe: ${quickResult.safe ? '✅' : '❌'}`);
      console.log(`   Risk Score: ${quickResult.riskScore}/100`);
      console.log(`   Is Honeypot: ${quickResult.isHoneypot ? '🍯 YES' : '✅ NO'}`);
      console.log(`   Can Sell: ${quickResult.canSell ? '✅ YES' : '❌ NO'}`);

      // Expected results for whitelisted tokens
      if (['SOL', 'USDC', 'BONK'].includes(name)) {
        if (quickResult.safe && !quickResult.isHoneypot && quickResult.riskScore === 0) {
          console.log('\n✅ TEST PASSED - Whitelisted token correctly identified as safe');
          passed++;
        } else {
          console.log('\n❌ TEST FAILED - Whitelisted token should be safe with 0 risk');
          failed++;
        }
      } else {
        console.log('\n✅ TEST COMPLETED - Manual verification needed for non-whitelisted tokens');
        passed++;
      }

    } catch (error) {
      console.error(`\n❌ TEST FAILED - Error: ${error.message}`);
      console.error(error.stack);
      failed++;
    }

    // Small delay between tests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n\n' + '═'.repeat(60));
  console.log('🧪 TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  console.log('═'.repeat(60) + '\n');

  return failed === 0;
}

// Run tests
runTests()
  .then(success => {
    if (success) {
      console.log('✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  });
