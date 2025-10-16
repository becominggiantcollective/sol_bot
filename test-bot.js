// Simple test to check bot initialization
console.log('🚀 Starting bot test...');

import('./dist/index.js')
  .then(() => {
    console.log('✅ Bot module loaded successfully');
  })
  .catch((error) => {
    console.error('❌ Bot failed to load:', error.message);
    console.error('Stack:', error.stack);
  });

// Add timeout to prevent hanging
setTimeout(() => {
  console.log('⏰ Test timeout reached');
  process.exit(0);
}, 5000);