/**
 * Quick Test - Flash Loan Scalper Components
 * 
 * Tests the new token watcher and volatility tracker
 * without needing a wallet
 */

import axios from 'axios';

// =============================================================================
// CONFIGURATION
// =============================================================================

const JUPITER_API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';

// =============================================================================
// NEW TOKEN WATCHER TEST
// =============================================================================

async function testNewTokenScanner() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 NEW TOKEN SCANNER TEST');
  console.log('='.repeat(70) + '\n');
  
  // Test DexScreener API
  console.log('Testing DexScreener API...');
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/token-boosts/latest/v1',
      { timeout: 10000 }
    );
    
    if (response.data && response.data.length > 0) {
      console.log(`✅ Found ${response.data.length} boosted tokens`);
      
      // Filter for Solana tokens
      const solanaTokens = response.data.filter(t => t.chainId === 'solana');
      console.log(`   Solana tokens: ${solanaTokens.length}`);
      
      if (solanaTokens.length > 0) {
        console.log('\n   Top 5 Solana boosted tokens:');
        for (const token of solanaTokens.slice(0, 5)) {
          console.log(`   • ${token.tokenAddress?.slice(0, 16)}... (${token.amount || 0} boosts)`);
        }
      }
    } else {
      console.log('⚠️ No boosted tokens found');
    }
  } catch (err) {
    console.log(`❌ DexScreener error: ${err.message}`);
  }
  
  // Test DexScreener latest pairs
  console.log('\nTesting DexScreener latest pairs...');
  try {
    const response = await axios.get(
      'https://api.dexscreener.com/latest/dex/search',
      { 
        params: { q: 'SOL' },
        timeout: 10000 
      }
    );
    
    if (response.data?.pairs) {
      // Filter recent Solana pairs
      const solanaPairs = response.data.pairs.filter(p => 
        p.chainId === 'solana' && 
        p.pairCreatedAt && 
        (Date.now() - p.pairCreatedAt) < 24 * 60 * 60 * 1000 // < 24h old
      );
      
      console.log(`✅ Found ${solanaPairs.length} pairs < 24h old`);
      
      if (solanaPairs.length > 0) {
        console.log('\n   Recent Solana pairs:');
        for (const pair of solanaPairs.slice(0, 5)) {
          const ageHours = ((Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)).toFixed(1);
          const liquidity = pair.liquidity?.usd || 0;
          const volume = pair.volume?.h24 || 0;
          console.log(`   • ${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}`);
          console.log(`     Age: ${ageHours}h | Liq: $${liquidity.toLocaleString()} | Vol: $${volume.toLocaleString()}`);
        }
      }
    }
  } catch (err) {
    console.log(`❌ DexScreener pairs error: ${err.message}`);
  }
}

// =============================================================================
// VOLATILITY TEST
// =============================================================================

async function testVolatilityDetection() {
  console.log('\n' + '='.repeat(70));
  console.log('📈 VOLATILITY DETECTION TEST');
  console.log('='.repeat(70) + '\n');
  
  // Test tokens to check volatility
  const testTokens = [
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK' },
    { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF' },
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP' },
  ];
  
  // Get price data from Jupiter
  for (const token of testTokens) {
    console.log(`\n📊 ${token.symbol}:`);
    
    try {
      const response = await axios.get('https://api.jup.ag/price/v2', {
        params: { ids: token.mint },
        headers: { 'x-api-key': JUPITER_API_KEY },
        timeout: 5000,
      });
      
      if (response.data?.data?.[token.mint]) {
        const data = response.data.data[token.mint];
        console.log(`   Price: $${parseFloat(data.price).toFixed(8)}`);
        
        // Get quote to check liquidity
        const quoteResp = await axios.get('https://api.jup.ag/swap/v1/quote', {
          params: {
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: token.mint,
            amount: 1e9, // 1 SOL
            slippageBps: 100,
          },
          headers: { 'x-api-key': JUPITER_API_KEY },
          timeout: 5000,
        });
        
        if (quoteResp.data) {
          const priceImpact = parseFloat(quoteResp.data.priceImpactPct || '0');
          console.log(`   Price impact (1 SOL): ${priceImpact.toFixed(4)}%`);
          
          // Extract route info
          if (quoteResp.data.routePlan) {
            const dexes = quoteResp.data.routePlan
              .map(r => r.swapInfo?.label || 'unknown')
              .filter((v, i, a) => a.indexOf(v) === i);
            console.log(`   Route: ${dexes.join(' → ')}`);
          }
        }
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }
}

// =============================================================================
// SAFETY CHECK TEST
// =============================================================================

async function testSafetyCheck() {
  console.log('\n' + '='.repeat(70));
  console.log('🛡️ SAFETY CHECK TEST');
  console.log('='.repeat(70) + '\n');
  
  // Test a known safe token (BONK) and check largest holders
  const testMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  
  console.log('Testing BONK token safety...');
  
  try {
    // Use Helius to get token info
    const response = await axios.post(
      'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenLargestAccounts',
        params: [testMint],
      },
      { timeout: 10000 }
    );
    
    if (response.data?.result?.value) {
      const accounts = response.data.result.value;
      console.log(`✅ Found ${accounts.length} token accounts`);
      
      // Calculate concentration
      const total = accounts.reduce((sum, acc) => sum + Number(acc.amount), 0);
      const largest = Number(accounts[0]?.amount || 0);
      const concentration = (largest / total) * 100;
      
      console.log(`   Total supply tracked: ${(total / 1e5).toLocaleString()} BONK`);
      console.log(`   Largest holder: ${(concentration).toFixed(2)}% of tracked supply`);
      console.log(`   Safety: ${concentration < 30 ? '✅ SAFE (< 30%)' : '⚠️ CONCENTRATED'}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  
  // Test honeypot detection (simulate sell quote)
  console.log('\nTesting honeypot detection (sell simulation)...');
  try {
    const response = await axios.get('https://api.jup.ag/swap/v1/quote', {
      params: {
        inputMint: testMint,
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: 100000000, // 1000 BONK
        slippageBps: 5000, // 50% to catch honeypots
      },
      headers: { 'x-api-key': JUPITER_API_KEY },
      timeout: 5000,
    });
    
    if (response.data?.outAmount) {
      console.log(`✅ Sell quote received - NOT a honeypot`);
      console.log(`   Output: ${(parseInt(response.data.outAmount) / 1e9).toFixed(9)} SOL`);
    } else {
      console.log(`⚠️ No sell quote - might be honeypot`);
    }
  } catch (err) {
    console.log(`❌ Sell failed - potential honeypot: ${err.message}`);
  }
}

// =============================================================================
// CROSS-DEX SPREAD TEST
// =============================================================================

async function testCrossDexSpread() {
  console.log('\n' + '='.repeat(70));
  console.log('🔄 CROSS-DEX SPREAD TEST');
  console.log('='.repeat(70) + '\n');
  
  const SOL = 'So11111111111111111111111111111111111111112';
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const amount = 1e9; // 1 SOL
  
  console.log('Checking SOL → USDC across DEXes...\n');
  
  // Get Jupiter quote (aggregator - best route)
  try {
    const jupResponse = await axios.get('https://api.jup.ag/swap/v1/quote', {
      params: {
        inputMint: SOL,
        outputMint: USDC,
        amount,
        slippageBps: 50,
      },
      headers: { 'x-api-key': JUPITER_API_KEY },
      timeout: 8000,
    });
    
    if (jupResponse.data) {
      const outAmount = parseInt(jupResponse.data.outAmount) / 1e6;
      const impact = parseFloat(jupResponse.data.priceImpactPct || '0');
      const dexes = jupResponse.data.routePlan
        ?.map(r => r.swapInfo?.label)
        .filter(Boolean)
        .join(' → ') || 'unknown';
      
      console.log(`Jupiter (Best Route):`);
      console.log(`   Output:       ${outAmount.toFixed(2)} USDC`);
      console.log(`   Price Impact: ${impact.toFixed(4)}%`);
      console.log(`   Route:        ${dexes}`);
    }
  } catch (err) {
    console.log(`Jupiter error: ${err.message}`);
  }
  
  await new Promise(r => setTimeout(r, 300));
  
  // Get Raydium quote (direct)
  try {
    const rayResponse = await axios.get('https://api.raydium.io/v2/swap/compute', {
      params: {
        inputMint: SOL,
        outputMint: USDC,
        amount,
        slippage: 0.5,
      },
      timeout: 5000,
    });
    
    if (rayResponse.data?.outAmount) {
      const outAmount = parseInt(rayResponse.data.outAmount) / 1e6;
      const impact = parseFloat(rayResponse.data.priceImpact || '0') * 100;
      
      console.log(`\nRaydium (Direct):`);
      console.log(`   Output:       ${outAmount.toFixed(2)} USDC`);
      console.log(`   Price Impact: ${impact.toFixed(4)}%`);
    }
  } catch (err) {
    console.log(`\nRaydium: Not available (${err.message})`);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('🤖 FLASH LOAN SCALPER - COMPONENT TESTS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  await testNewTokenScanner();
  await testVolatilityDetection();
  await testSafetyCheck();
  await testCrossDexSpread();
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ ALL TESTS COMPLETE');
  console.log('='.repeat(70) + '\n');
}

main().catch(console.error);
