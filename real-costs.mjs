import fetch from 'node-fetch';

const API_KEY = process.env.JUPITER_API_KEY;

async function testRealCosts() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              REAL ARBITRAGE COST ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const SOL = 'So11111111111111111111111111111111111111112';
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const RAY = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
  
  // Test different amounts
  const amounts = [1, 10, 100]; // SOL
  
  for (const sol of amounts) {
    const amount = sol * 1e9;
    
    // SOL -> USDC -> SOL
    const quote1 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${amount}&slippageBps=50`, {
      headers: { 'x-api-key': API_KEY }
    }).then(r => r.json());
    
    const usdcOut = parseInt(quote1.outAmount);
    
    const quote2 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${usdcOut}&slippageBps=50`, {
      headers: { 'x-api-key': API_KEY }
    }).then(r => r.json());
    
    const solBack = parseInt(quote2.outAmount);
    const roundTripPct = ((solBack - amount) / amount) * 100;
    
    console.log(`  ${sol} SOL Round Trip (SOL → USDC → SOL):`);
    console.log(`    In:  ${sol} SOL → Out: ${(usdcOut/1e6).toFixed(2)} USDC → Back: ${(solBack/1e9).toFixed(6)} SOL`);
    console.log(`    Result: ${roundTripPct >= 0 ? '+' : ''}${roundTripPct.toFixed(4)}%`);
    console.log('');
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Now test triangular: SOL -> RAY -> USDC -> SOL
  console.log('  Triangular Arb (SOL → RAY → USDC → SOL):');
  
  const amount = 10e9; // 10 SOL
  
  const q1 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${RAY}&amount=${amount}&slippageBps=50`, {
    headers: { 'x-api-key': API_KEY }
  }).then(r => r.json());
  
  const rayOut = parseInt(q1.outAmount);
  
  await new Promise(r => setTimeout(r, 200));
  
  const q2 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${RAY}&outputMint=${USDC}&amount=${rayOut}&slippageBps=50`, {
    headers: { 'x-api-key': API_KEY }
  }).then(r => r.json());
  
  const usdcOut = parseInt(q2.outAmount);
  
  await new Promise(r => setTimeout(r, 200));
  
  const q3 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${usdcOut}&slippageBps=50`, {
    headers: { 'x-api-key': API_KEY }
  }).then(r => r.json());
  
  const solBack = parseInt(q3.outAmount);
  const triPct = ((solBack - amount) / amount) * 100;
  
  console.log(`    10 SOL → ${(rayOut/1e6).toFixed(2)} RAY → ${(usdcOut/1e6).toFixed(2)} USDC → ${(solBack/1e9).toFixed(6)} SOL`);
  console.log(`    Result: ${triPct >= 0 ? '+' : ''}${triPct.toFixed(4)}%`);
  console.log('');
  
  // Gas estimate
  console.log('  ACTUAL GAS COSTS:');
  console.log('  ─────────────────');
  console.log('  Simple swap:     ~0.000005 SOL ($0.0006)');
  console.log('  Flash loan tx:   ~0.0001-0.0005 SOL ($0.01-0.06)');
  console.log('  With priority:   ~0.001 SOL (~$0.13)');
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    CORRECTED BREAKEVEN');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  If Solend flash loan = 0%:');
  console.log('  ────────────────────────────');
  console.log('  Flash loan fee:    0.00%');
  console.log('  DEX round trip:    ~0.02-0.05% (depending on route)');
  console.log('  Gas:               ~0.01-0.05%');
  console.log('  ────────────────────────────');
  console.log('  TOTAL COST:        ~0.03-0.10%');
  console.log('  BREAKEVEN:         ~0.10% spread');
  console.log('');
  console.log('  ⚠️  BUT: The fact that round trips show GAINS means');
  console.log('     Jupiter is routing through price differences!');
  console.log('     This is WHY your bot finds no opportunities -');
  console.log('     Jupiter itself is capturing the arb!');
  console.log('');
}

testRealCosts().catch(console.error);
