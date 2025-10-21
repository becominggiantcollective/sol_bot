import dotenv from 'dotenv';
dotenv.config();

import { Connection } from '@solana/web3.js';
import { PythPriceOracle, PYTH_PRICE_FEEDS } from './src/core/oracle';

async function testPythOracle() {
  console.log('🔮 Testing Pyth Price Oracle');
  console.log('============================\n');

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('✅ Connected to:', rpcUrl);

  const oracle = new PythPriceOracle(connection);

  console.log('\n📊 Fetching prices from Pyth on-chain...\n');

  // Test SOL price
  console.log('Testing SOL/USD price feed...');
  const solPrice = await oracle.getSolPrice();
  if (solPrice) {
    console.log('✅ SOL Price: $' + solPrice.toFixed(2));
  } else {
    console.log('❌ Failed to fetch SOL price');
  }

  // Test USDC price
  console.log('\nTesting USDC/USD price feed...');
  const usdcPrice = await oracle.getUsdcPrice();
  if (usdcPrice) {
    console.log('✅ USDC Price: $' + usdcPrice.toFixed(4));
  } else {
    console.log('❌ Failed to fetch USDC price');
  }

  // Test price ratio
  console.log('\nTesting SOL/USDC price ratio...');
  const ratio = await oracle.getPriceRatio(PYTH_PRICE_FEEDS.SOL, PYTH_PRICE_FEEDS.USDC);
  if (ratio) {
    console.log('✅ SOL/USDC Ratio:', ratio.toFixed(6));
    console.log('   (1 SOL = ' + ratio.toFixed(2) + ' USDC)');
  } else {
    console.log('❌ Failed to calculate ratio');
  }

  // Test multiple prices in parallel
  console.log('\nFetching all prices in parallel...');
  const allPrices = await oracle.getPrices([
    PYTH_PRICE_FEEDS.SOL,
    PYTH_PRICE_FEEDS.USDC,
    PYTH_PRICE_FEEDS.ETH,
    PYTH_PRICE_FEEDS.BTC,
  ]);

  console.log('\n📈 Price Summary:');
  console.log('=================');
  for (const [feedId, priceData] of allPrices) {
    const feedName = Object.keys(PYTH_PRICE_FEEDS).find(
      key => PYTH_PRICE_FEEDS[key as keyof typeof PYTH_PRICE_FEEDS].toString() === feedId
    );
    console.log(`${feedName?.padEnd(6)}: $${priceData.price.toFixed(2).padStart(10)} (±$${priceData.confidence.toFixed(2)})`);
  }

  console.log('\n✨ Pyth Oracle test completed!');
  console.log('\n🎯 Next: This oracle can replace Jupiter API for price fetching');
  console.log('   Update arbitrage detector to use Pyth prices');
}

testPythOracle().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
