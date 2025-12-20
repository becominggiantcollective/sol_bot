const rust = require('./native/sol_bot.node');
console.log('✅ Rust module loaded');
console.log('📦 Exports:', Object.keys(rust));
console.log('🔧 Has JsLowFeeRouter:', !!rust.JsLowFeeRouter);

if (rust.JsLowFeeRouter) {
  const router = new rust.JsLowFeeRouter();
  console.log('🚀 Rust low-fee router instantiated successfully');
  
  // Test a quote
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const amount = '1000000000'; // 1 USDC (6 decimals)
  
  const quote = router.getBestQuote(USDC, USDT, amount);
  console.log('💎 Test quote:', quote);
} else {
  console.log('⚠️  JsLowFeeRouter not found in Rust module');
}
