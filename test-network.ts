import axios from 'axios';

async function testNetworkcoonectivity() {
  console.log('Ìºê Network Connectivity Diagnostic');
  console.log('==================================\n');

  const endpoints = [
    { name: 'Google DNS', url: 'https://8.8.8.8' },
    { name: 'Cloudflare API', url: 'https://api.cloudflare.com/' },
    { name: 'Coingecko (public API)', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana' },
    { name: 'Jupiter Quote API v6', url: 'https://quote-api.jup.ag/v6/health' },
    { name: 'Public Jupiter', url: 'https://public.jupiterapi.com/' },
    { name: 'Solana RPC (Mainnet)', url: 'https://api.mainnet-beta.solana.com' },
  ];

  console.log('Testing connectivity to various endpoints:\n');

  for (const endpoint of endpoints) {
    try {
      const start = Date.now();
      const response = await axios.get(endpoint.url, { timeout: 5000 });
      const duration = Date.now() - start;
      console.log(`‚úÖ ${endpoint.name.padEnd(25)} | Status: ${response.status} | Time: ${duration}ms`);
    } catch (error: any) {
      const msg = error.code || error.message || 'Unknown error';
      console.log(`‚ùå ${endpoint.name.padEnd(25)} | Error: ${msg}`);
    }
  }

  console.log('\nÌ≥ä Network Analysis:');
  console.log('===================');
  console.log('If all external APIs fail but Solana RPC works:');
  console.log('  ‚Üí Use on-chain price oracles (Pyth Network)');
  console.log('  ‚Üí Read DEX pool data directly from blockchain');
  console.log('  ‚Üí No external API dependency = reliable arb bot');
}

testNetworkcoonectivity();
