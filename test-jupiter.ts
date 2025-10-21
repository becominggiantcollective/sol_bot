import axios from 'axios';

async function testJupiter() {
  const baseUrl = 'https://public.jupiterapi.com';
  const params = new URLSearchParams({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '1000000000',
    slippageBps: '50'
  });

  const endpoints = [
    `/quote?${params}`,
    `/v6/quote?${params}`,
    `/swap/v1/quote?${params}`
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`\nTrying: ${baseUrl}${endpoint.substring(0, 60)}...`);
      const response = await axios.get(`${baseUrl}${endpoint}`, { timeout: 5000 });
      console.log(`✅ Success! Status: ${response.status}`);
      console.log(`Response keys:`, Object.keys(response.data).slice(0, 5));
      console.log(`OutAmount:`, response.data.outAmount);
    } catch (error: any) {
      if (error.response) {
        console.log(`❌ HTTP ${error.response.status}: ${JSON.stringify(error.response.data).substring(0, 100)}`);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
  }
}

testJupiter();
