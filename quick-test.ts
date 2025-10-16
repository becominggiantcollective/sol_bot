import dotenv from 'dotenv';
import { SolanaArbitrageBot } from './dist/index.js';

// Load environment variables
dotenv.config();

async function quickTest() {
  console.log('🤖 Quick Bot Test\n');
  
  try {
    const bot = new SolanaArbitrageBot();
    
    console.log('✅ Bot initialized successfully');
    
    // Check wallet balance
    const balance = await bot.getWalletBalance();
    const address = await bot.getWalletAddress();
    
    console.log(`📍 Wallet: ${address}`);
    console.log(`💰 Balance: ${balance.toFixed(6)} SOL (~$${(balance * 150).toFixed(2)})`);
    
    if (balance < 0.1) {
      console.log('\n⚠️  WARNING: Balance too low for meaningful trading');
      console.log('The bot needs at least 0.1 SOL to operate effectively');
      console.log('Current balance only allows for basic monitoring');
    }
    
    console.log('\n🔍 Testing bot functionality...');
    
    // Test for 30 seconds
    console.log('Starting bot for 30 seconds...');
    await bot.start();
    
    // Let it run for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log('\n📊 Stopping bot and checking metrics...');
    await bot.stop();
    
    const metrics = bot.getProfitMetrics();
    console.log('Profit Metrics:', metrics);
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

quickTest().catch(console.error);