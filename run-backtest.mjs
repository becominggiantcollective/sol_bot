#!/usr/bin/env node

// Load dotenv first
import('dotenv').then((dotenv) => {
  dotenv.default.config();
  
  // Now run the backtest
  return import('./backtest-example.ts');
}).then((module) => {
  return module.runBacktest();
}).catch((err) => {
  console.error('Error running backtest:', err);
  process.exit(1);
});
