import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

// Load environment variables
dotenv.config();

async function runBotWithMonitoring() {
  console.log('🤖 Solana Arbitrage Bot - Detailed Monitoring Mode');
  console.log('============================================================');
  
  try {
    // Check wallet first
    console.log('\n💰 WALLET CHECK:');
    const privateKeyEnv = process.env.WALLET_PRIVATE_KEY;
    const publicKeyEnv = process.env.WALLET_PUBLIC_KEY;
    
    if (!privateKeyEnv || !publicKeyEnv) {
      throw new Error('Wallet configuration missing in environment');
    }
    
    const privateKeyArray = JSON.parse(privateKeyEnv);
    const keypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / 1e9;
    
    console.log(`Address: ${keypair.publicKey.toString()}`);
    console.log(`Balance: ${solBalance.toFixed(6)} SOL (~$${(solBalance * 150).toFixed(2)})`);
    
    // Check if we have minimum operational balance
    if (solBalance < 0.001) {
      console.log('\n🚨 CRITICAL: Insufficient SOL for any operations');
      console.log('Need at least 0.001 SOL for basic transactions');
      return;
    } else if (solBalance < 0.01) {
      console.log('\n⚠️  WARNING: Very low SOL - limited operations possible');
    } else if (solBalance < 0.1) {
      console.log('\n⚠️  WARNING: Low SOL - reduced trading capacity');
    } else {
      console.log('\n✅ Sufficient SOL for trading operations');
    }
    
    // Now try to import and run the bot
    console.log('\n🔧 INITIALIZING BOT:');
    
    const { SolanaArbitrageBot } = await import('./dist/index.js');
    
    console.log('✅ Bot module loaded');
    
    const bot = new SolanaArbitrageBot();
    console.log('✅ Bot instance created');
    
    // Add signal handlers
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down...');
      await bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await bot.stop();
      process.exit(0);
    });
    
    console.log('\n🚀 STARTING BOT:');
    console.log('Press Ctrl+C to stop');
    console.log('Monitoring for arbitrage opportunities...\n');
    
    // Start the bot
    await bot.start();
    
    // Monitor for opportunities
    let monitorCount = 0;
    const monitorInterval = setInterval(async () => {
      monitorCount++;
      console.log(`[${new Date().toLocaleTimeString()}] Monitoring cycle ${monitorCount} - Bot running...`);
      
      // Show basic stats every 10 cycles (50 seconds)
      if (monitorCount % 10 === 0) {
        try {
          const metrics = bot.getProfitMetrics();
          console.log(`📊 Metrics: ${JSON.stringify(metrics, null, 2)}`);
        } catch (e) {
          console.log('📊 Metrics not available yet');
        }
      }
    }, 5000); // Every 5 seconds
    
    // Keep running
    await new Promise(resolve => {
      // This will run indefinitely until interrupted
    });
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

runBotWithMonitoring().catch(console.error);