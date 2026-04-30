import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';

const HELIUS_RPC = process.env.HELIUS_RPC_URL;

async function verifySolendFee() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              VERIFYING ACTUAL FLASH LOAN FEES');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const connection = new Connection(HELIUS_RPC);
  
  // Solend SOL Reserve account
  const SOL_RESERVE = new PublicKey('8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36');
  
  try {
    const accountInfo = await connection.getAccountInfo(SOL_RESERVE);
    
    if (accountInfo && accountInfo.data.length >= 619) {
      // Solend Reserve layout: flash_loan_fee at offset 586 as u64 (basis points)
      const feeBuffer = accountInfo.data.slice(586, 594);
      const feeBps = Number(feeBuffer.readBigUInt64LE(0));
      const feePercent = feeBps / 10000;
      
      console.log('  SOLEND FLASH LOAN FEE (from blockchain):');
      console.log('  ─────────────────────────────────────────');
      console.log(`  Raw basis points: ${feeBps}`);
      console.log(`  As decimal:       ${feePercent}`);
      console.log(`  As percentage:    ${(feePercent * 100).toFixed(4)}%`);
      console.log('');
    }
  } catch (e) {
    console.log('  Error reading Solend fee:', e.message);
  }
  
  // Also check what Jupiter quotes as fees
  console.log('  JUPITER DEX FEE CHECK (SOL -> USDC -> SOL round trip):');
  console.log('  ─────────────────────────────────────────────────────');
  
  const SOL = 'So11111111111111111111111111111111111111112';
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const amount = 1e9; // 1 SOL
  
  try {
    // SOL -> USDC
    const quote1 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${amount}&slippageBps=50`, {
      headers: { 'x-api-key': process.env.JUPITER_API_KEY }
    }).then(r => r.json());
    
    const usdcOut = parseInt(quote1.outAmount);
    const route1 = quote1.routePlan?.[0]?.swapInfo?.label || 'Unknown';
    
    // USDC -> SOL
    const quote2 = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${SOL}&amount=${usdcOut}&slippageBps=50`, {
      headers: { 'x-api-key': process.env.JUPITER_API_KEY }
    }).then(r => r.json());
    
    const solBack = parseInt(quote2.outAmount);
    const route2 = quote2.routePlan?.[0]?.swapInfo?.label || 'Unknown';
    
    const roundTripLoss = (amount - solBack) / amount;
    const perSwapFee = roundTripLoss / 2;
    
    console.log(`  Input:           1 SOL (${amount} lamports)`);
    console.log(`  After swap 1:    ${(usdcOut / 1e6).toFixed(2)} USDC (via ${route1})`);
    console.log(`  After swap 2:    ${(solBack / 1e9).toFixed(6)} SOL (via ${route2})`);
    console.log(`  Round trip loss: ${(roundTripLoss * 100).toFixed(4)}%`);
    console.log(`  Per-swap fee:    ~${(perSwapFee * 100).toFixed(4)}%`);
    console.log('');
    
    // Get price impact from quotes
    const impact1 = parseFloat(quote1.priceImpactPct || '0');
    const impact2 = parseFloat(quote2.priceImpactPct || '0');
    
    console.log('  PRICE IMPACT:');
    console.log(`  Swap 1 impact:   ${(impact1 * 100).toFixed(4)}%`);
    console.log(`  Swap 2 impact:   ${(impact2 * 100).toFixed(4)}%`);
    console.log('');
    
    // Check platform fees in quote
    if (quote1.platformFee) {
      console.log('  PLATFORM FEES:');
      console.log(`  Swap 1: ${JSON.stringify(quote1.platformFee)}`);
    }
    
  } catch (e) {
    console.log('  Error fetching Jupiter quotes:', e.message);
  }
  
  // Gas costs
  console.log('  GAS COSTS (Solana):');
  console.log('  ───────────────────');
  console.log('  Base fee:        ~5000 lamports = 0.000005 SOL');
  console.log('  Priority fee:    ~50000-500000 lamports = 0.00005-0.0005 SOL');
  console.log('  Flash loan tx:   ~0.0001-0.001 SOL total');
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    CORRECTED COST BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

verifySolendFee().catch(console.error);
