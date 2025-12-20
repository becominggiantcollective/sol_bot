#!/usr/bin/env node
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkBalance() {
  try {
    // RPC endpoint selection
    const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Wallet selection
    const walletPubkey = process.env.WALLET_IDK_PUBLIC_KEY || process.env.WALLET_PUBLIC_KEY;
    
    if (!walletPubkey) {
      console.error('❌ No wallet public key found in .env file');
      console.error('Please set WALLET_IDK_PUBLIC_KEY or WALLET_PUBLIC_KEY');
      process.exit(1);
    }
    
    console.log('\n🔍 Checking Bot Balance...\n');
    console.log('RPC Endpoint:', rpcUrl);
    console.log('Wallet:', walletPubkey);
    console.log('─'.repeat(60));
    
    const publicKey = new PublicKey(walletPubkey);
    
    // Get SOL balance
    const lamports = await connection.getBalance(publicKey);
    const sol = lamports / LAMPORTS_PER_SOL;
    
    console.log(`\n💰 SOL Balance: ${sol.toFixed(9)} SOL (${lamports.toLocaleString()} lamports)`);
    
    // Get token accounts
    console.log('\n🪙 Token Accounts:');
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    });
    
    if (tokenAccounts.value.length === 0) {
      console.log('   No token accounts found');
    } else {
      let totalValue = 0;
      for (const account of tokenAccounts.value) {
        const data = account.account.data.parsed.info;
        const balance = data.tokenAmount.uiAmount;
        const mint = data.mint;
        
        if (balance > 0) {
          console.log(`   ${mint.substring(0, 8)}... : ${balance.toFixed(6)}`);
        }
      }
      console.log(`\n   Total token accounts: ${tokenAccounts.value.length}`);
      console.log(`   Non-zero balances: ${tokenAccounts.value.filter(a => a.account.data.parsed.info.tokenAmount.uiAmount > 0).length}`);
    }
    
    console.log('\n' + '─'.repeat(60));
    
    // Balance status
    if (sol < 0.01) {
      console.log('⚠️  WARNING: Low balance! Consider adding more SOL for gas fees');
    } else if (sol < 0.1) {
      console.log('⚡ Balance adequate for testing');
    } else {
      console.log('✅ Balance looks good!');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
    process.exit(1);
  }
}

checkBalance();
