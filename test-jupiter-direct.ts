import axios from 'axios';

async function testJupiterAPI() {
  console.log('Testing Jupiter API connectivity...\n');
  
  const tests = [
    {
      name: 'Jupiter Health Check',
      url: 'https://quote-api.jup.ag/v6/health',
    },
    {
      name: 'Jupiter Price API',
      url: 'https://price.jup.ag/v6/price?ids=SOL',
    },
    {
      name: 'Jupiter Quote API (USDC -> SOL)',
      url: 'https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=30',
    },
  ];

  for (const test of tests) {
    try {
      console.log(`\n🔍 ${test.name}`);
      console.log(`   URL: ${test.url}`);
      
      const response = await axios.get(test.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'SolanaArbitrageBot/1.0',
        },
      });
      
      console.log(`   ✅ SUCCESS! Status: ${response.status}`);
      console.log(`   Response:`, JSON.stringify(response.data, null, 2).substring(0, 500));
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.log(`   ❌ FAILED: ${error.code || error.message}`);
        if (error.response) {
          console.log(`   Status: ${error.response.status}`);
          console.log(`   Response:`, error.response.data);
        }
      } else {
        console.log(`   ❌ FAILED:`, error.message);
      }
    }
  }
}

testJupiterAPI().catch(console.error);
