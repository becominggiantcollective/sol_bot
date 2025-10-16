// Direct bot test with logging
import dotenv from 'dotenv';
dotenv.config();

console.log('🚀 Initializing bot test...');

try {
  const { SolanaArbitrageBot } = await import('./dist/index.js');
  console.log('✅ Bot class imported successfully');
  
  const bot = new SolanaArbitrageBot();
  console.log('✅ Bot instance created');
  
  console.log('🔄 Starting bot...');
  await bot.start();
  console.log('✅ Bot started successfully');
  
  // Let it run for 30 seconds
  console.log('⏱️  Letting bot run for 30 seconds...');
  setTimeout(async () => {
    console.log('⏹️  Stopping bot...');
    await bot.stop();
    console.log('✅ Test completed');
    process.exit(0);
  }, 30000);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}