import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

// Load environment variables
dotenv.config();

async function testWallet() {
  console.log('🔍 Testing Wallet Configuration...\n');
  
  try {
    // Test environment variables
    const privateKeyEnv = process.env.WALLET_PRIVATE_KEY;
    const publicKeyEnv = process.env.WALLET_PUBLIC_KEY;
    
    if (!privateKeyEnv) {
      console.log('❌ WALLET_PRIVATE_KEY not found in environment');
      return;
    }
    
    if (!publicKeyEnv) {
      console.log('❌ WALLET_PUBLIC_KEY not found in environment');
      return;
    }
    
    console.log('✅ Environment variables found');
    
    // Test private key parsing
    let keypair;
    try {
      const privateKeyArray = JSON.parse(privateKeyEnv);
      keypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
      console.log('✅ Private key parsed successfully');
    } catch (error) {
      console.log('❌ Failed to parse private key:', error.message);
      return;
    }
    
    // Test public key match
    const expectedPublicKey = new PublicKey(publicKeyEnv);
    if (keypair.publicKey.toString() === expectedPublicKey.toString()) {
      console.log('✅ Private and public keys match');
    } else {
      console.log('❌ Private and public keys do NOT match');
      console.log('   Expected:', expectedPublicKey.toString());
      console.log('   Got:     ', keypair.publicKey.toString());
      return;
    }
    
    // Test RPC connection
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    console.log('✅ RPC connection created');
    
    // Check balance
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / 1e9;
    
    console.log('\n💰 WALLET STATUS:');
    console.log('━'.repeat(50));
    console.log(`Address: ${keypair.publicKey.toString()}`);
    console.log(`Balance: ${solBalance.toFixed(6)} SOL`);
    console.log(`USD Value: ~$${(solBalance * 150).toFixed(2)}`);
    
    if (solBalance === 0) {
      console.log('\n🚨 CRITICAL ISSUE:');
      console.log('Your wallet has 0 SOL! The bot cannot work without SOL for gas fees.');
      console.log('\n📋 TO FIX THIS:');
      console.log('1. Buy SOL on an exchange (Binance, Coinbase, etc.)');
      console.log('2. Send at least 0.1 SOL to this address:');
      console.log(`   ${keypair.publicKey.toString()}`);
      console.log('3. Wait for confirmation (1-2 minutes)');
      console.log('4. Run this test again');
      console.log('\n💡 RECOMMENDED AMOUNTS:');
      console.log('• Testing: 0.1 SOL (~$15)');
      console.log('• Production: 0.5-1 SOL (~$75-150)');
      console.log('• Aggressive: 2+ SOL (~$300+)');
    } else if (solBalance < 0.1) {
      console.log('\n⚠️  WARNING: Very low SOL balance');
      console.log('Consider adding more SOL for sustained operation');
    } else if (solBalance < 0.5) {
      console.log('\n✅ Minimal SOL for basic testing');
      console.log('Consider adding more SOL for better performance');
    } else {
      console.log('\n✅ Good SOL balance for trading!');
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

testWallet().catch(console.error);