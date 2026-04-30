#!/usr/bin/env node
/**
 * POSITION CLEANUP & DIAGNOSTICS
 * Checks current positions and identifies honeypots
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';

const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

async function checkPosition(mint, position) {
  console.log(`\n🔍 Checking ${position.symbol} (${mint.slice(0, 8)}...)`);
  console.log(`   Entry: ${position.entryAmountSol} SOL at ${new Date(position.entryTime).toLocaleString()}`);
  console.log(`   Hold time: ${((Date.now() - position.entryTime) / 60000).toFixed(1)} minutes`);
  
  try {
    // Try to get sell quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${position.tokenAmount}&slippageBps=3000`;
    const res = await fetch(quoteUrl, {
      headers: { 'x-api-key': process.env.JUPITER_API_KEY }
    });
    const quote = await res.json();
    
    if (quote.error || !quote.outAmount) {
      console.log(`   🍯 HONEYPOT: Cannot get sell quote`);
      console.log(`   Error: ${quote.error || 'No quote available'}`);
      console.log(`   ❌ This token CANNOT be sold - you are stuck!`);
      return { sellable: false, mint, reason: quote.error };
    }
    
    const currentValue = parseInt(quote.outAmount) / 1e9;
    const pnl = ((currentValue / position.entryAmountSol) - 1) * 100;
    const profitSOL = currentValue - position.entryAmountSol;
    
    console.log(`   ✅ SELLABLE: Can get quote`);
    console.log(`   Current value: ${currentValue.toFixed(6)} SOL`);
    console.log(`   P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% (${profitSOL >= 0 ? '+' : ''}${profitSOL.toFixed(6)} SOL)`);
    
    return { sellable: true, currentValue, pnl, profitSOL };
    
  } catch (error) {
    console.log(`   ⚠️ Error checking: ${error.message}`);
    return { sellable: false, mint, reason: error.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔧 POSITION CLEANUP & DIAGNOSTICS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Load positions
  let positions;
  try {
    const data = JSON.parse(fs.readFileSync('positions-safe.json', 'utf-8'));
    positions = new Map(data.positions || []);
    console.log(`📂 Loaded ${positions.size} position(s)\n`);
  } catch {
    console.log('❌ No positions file found\n');
    return;
  }
  
  if (positions.size === 0) {
    console.log('✅ No open positions - all clear!\n');
    return;
  }
  
  const results = [];
  
  for (const [mint, pos] of positions) {
    const result = await checkPosition(mint, pos);
    results.push({ mint, position: pos, ...result });
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
  }
  
  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const honeypots = results.filter(r => !r.sellable);
  const sellable = results.filter(r => r.sellable);
  
  console.log(`Total positions: ${results.length}`);
  console.log(`✅ Sellable: ${sellable.length}`);
  console.log(`🍯 Honeypots (stuck): ${honeypots.length}`);
  
  if (honeypots.length > 0) {
    console.log('\n🍯 HONEYPOT POSITIONS (Cannot Sell):');
    console.log('─────────────────────────────────────────────────────────\n');
    
    let totalLocked = 0;
    for (const hp of honeypots) {
      console.log(`${hp.position.symbol}: ${hp.position.entryAmountSol} SOL (~$${(hp.position.entryAmountSol * 230).toFixed(2)})`);
      console.log(`   Mint: ${hp.mint}`);
      console.log(`   Reason: ${hp.reason}`);
      totalLocked += hp.position.entryAmountSol;
    }
    
    console.log(`\nTotal locked in honeypots: ${totalLocked.toFixed(6)} SOL (~$${(totalLocked * 230).toFixed(2)})`);
    console.log('\n💡 Recommendation: Remove these positions from positions-safe.json');
    console.log('   They cannot be sold and will continue to cause errors.');
  }
  
  if (sellable.length > 0) {
    console.log('\n✅ SELLABLE POSITIONS:');
    console.log('─────────────────────────────────────────────────────────\n');
    
    for (const s of sellable) {
      const symbol = pnl >= 0 ? '📈' : '📉';
      console.log(`${symbol} ${s.position.symbol}: ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}% (${s.currentValue.toFixed(6)} SOL)`);
    }
  }
  
  // Cleanup option
  if (honeypots.length > 0) {
    console.log('\n\n💡 To automatically remove honeypots, run:');
    console.log('   node cleanup-positions.mjs --remove-honeypots');
  }
}

main().catch(console.error);
