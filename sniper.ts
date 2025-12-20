#!/usr/bin/env node
/**
 * NEW TOKEN SNIPER
 * 
 * Run: npm run sniper
 * 
 * This finds brand new tokens on pump.fun/Raydium and catches
 * the initial price momentum. Works with small capital because:
 * 
 * 1. New tokens move 10-50%+ in first hour
 * 2. Your $5-8 trade can still capture that %
 * 3. No flash loan fees needed
 * 
 * RISK WARNING: This is high risk! New tokens can:
 * - Rug pull (developers dump and run)
 * - Have honeypot contracts (can't sell)
 * - Crash 90%+ in minutes
 * 
 * Only use what you can afford to lose.
 */

import { runSniper } from './src/strategies/sniper.js';

console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║           🎯 NEW TOKEN SNIPER 🎯                     ║');
console.log('║                                                       ║');
console.log('║  Hunts for newly launched tokens with momentum       ║');
console.log('║  Target: 10% gains | Stop Loss: 15%                  ║');
console.log('║                                                       ║');
console.log('║  ⚠️  HIGH RISK - New tokens can rug/crash!          ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

runSniper().catch(console.error);
