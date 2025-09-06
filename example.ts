import { SolanaArbitrageBot } from './src/index';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🚀 Starting Solana Arbitrage Bot Example...');
  
  // Check if environment variables are set
  if (!process.env.WALLET_PRIVATE_KEY) {
    console.error('❌ Please set WALLET_PRIVATE_KEY in your .env file');
    console.log('💡 Copy .env.example to .env and configure your settings');
    return;
  }
  
  try {
    // Create bot instance
    const bot = new SolanaArbitrageBot();
    
    // Get wallet info
    const walletAddress = await bot.getWalletAddress();
    const balance = await bot.getWalletBalance();
    
    console.log(`📍 Wallet Address: ${walletAddress}`);
    console.log(`💰 Wallet Balance: ${balance} SOL`);
    
    if (balance < 0.1) {
      console.warn('⚠️  Low wallet balance. Add more SOL for transaction fees.');
    }
    
    console.log('🔍 Bot Status:', bot.isActive() ? 'Active' : 'Inactive');
    console.log('📊 Bot is ready to start monitoring for arbitrage opportunities!');
    console.log('💡 To start trading, call bot.start()');
    
    // Note: In a real scenario, you would call bot.start() to begin trading
    // For this example, we're just showing the setup
    
  } catch (error) {
    console.error('❌ Error initializing bot:', error);
    console.log('💡 Make sure your environment variables are correctly configured');
  }
}

if (require.main === module) {
  main().catch(console.error);
}