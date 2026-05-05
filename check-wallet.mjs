#!/usr/bin/env node
import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';

const conn = new Connection(process.env.HELIUS_RPC_URL);
const wallet = new PublicKey('52chXL7rNGm5hFWXRK6VsxmRiVvjSq3YPC8LSUaMg6wS');

async function check() {
  // Get SOL balance
  const solBalance = await conn.getBalance(wallet);
  console.log('═══════════════════════════════════════════');
  console.log('YOUR CURRENT WALLET STATUS');
  console.log('═══════════════════════════════════════════');
  console.log(`SOL Balance: ${(solBalance / 1e9).toFixed(6)} SOL`);
  console.log(`USD Value:   $${((solBalance / 1e9) * 230).toFixed(2)}`);
  console.log('');
  
  // Get all token accounts
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(wallet, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });
  
  console.log('TOKEN HOLDINGS:');
  console.log('───────────────────────────────────────────');
  
  let hasTokens = false;
  let totalTokenValue = 0;
  
  for (const acc of tokenAccounts.value) {
    const info = acc.account.data.parsed.info;
    const balance = parseFloat(info.tokenAmount.uiAmount || 0);
    if (balance > 0) {
      hasTokens = true;
      const mint = info.mint;
      console.log(`Mint: ${mint.substring(0,8)}...`);
      console.log(`  Balance: ${balance.toLocaleString()}`);
      
      // Try to get price
      try {
        const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
        const priceData = await priceRes.json();
        const price = priceData.data?.[mint]?.price || 0;
        const value = balance * price;
        totalTokenValue += value;
        console.log(`  Price: $${price.toFixed(8)}`);
        console.log(`  Value: $${value.toFixed(4)}`);
      } catch(e) {
        console.log(`  Value: Unknown`);
      }
      console.log('');
    }
  }
  
  if (!hasTokens) {
    console.log('✅ No tokens with balance > 0');
    console.log('   (All previous tokens either sold or worthless)');
  }
  
  console.log('═══════════════════════════════════════════');
  console.log('TOTAL PORTFOLIO:');
  console.log(`  SOL:    $${((solBalance / 1e9) * 230).toFixed(2)}`);
  console.log(`  Tokens: $${totalTokenValue.toFixed(2)}`);
  console.log(`  TOTAL:  $${(((solBalance / 1e9) * 230) + totalTokenValue).toFixed(2)}`);
  console.log('═══════════════════════════════════════════');
}

check().catch(console.error);
