#!/usr/bin/env node
/**
 * EMERGENCY SELL ALL POSITIONS
 * Sells all token positions to SOL
 */

import fetch from 'node-fetch';
import { Keypair, Connection, VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const PRIVATE_KEY = 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs';
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(RPC_URL, 'confirmed');

// Positions to sell - EXACT raw amounts
const positions = [
  { mint: '7WiuVXDw1Z14pQVGtLrswF3t7hvTVnpc9CSmupKZk8UH', name: 'GRUG', amount: 1263359793 },
  { mint: 'EMVhRqwf5CGB81gM3VTFDApbMjMJjQJ7TZHBvjww53GA', name: 'DUSTY', amount: 481700 },
];

async function sellToken(mint, name, amount) {
  console.log(`\n🔴 SELLING ${name}...`);
  
  try {
    // Get quote
    const quoteUrl = `https://public.jupiterapi.com/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=5000`;
    const quoteResponse = await fetch(quoteUrl);
    
    if (!quoteResponse.ok) {
      console.log(`   ❌ Quote failed: ${quoteResponse.status}`);
      return null;
    }
    
    const quote = await quoteResponse.json();
    const expectedSol = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
    console.log(`   Expected: ${expectedSol.toFixed(6)} SOL`);
    
    // Get swap transaction
    const swapResponse = await fetch('https://public.jupiterapi.com/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        useSharedAccounts: false,
        dynamicComputeUnitLimit: true,
        autoSlippage: true,
        maxAutoSlippageBps: 10000,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 100000,
            priorityLevel: "veryHigh"
          }
        }
      })
    });
    
    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      console.log(`   ❌ Swap failed: ${error.slice(0, 100)}`);
      return null;
    }
    
    const swapData = await swapResponse.json();
    
    // Sign and send
    const txBuffer = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);
    
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3
    });
    
    console.log(`   🚀 TX: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      console.log(`   ❌ Failed: ${JSON.stringify(confirmation.value.err)}`);
      return null;
    }
    
    console.log(`   ✅ SOLD! Got ~${expectedSol.toFixed(6)} SOL`);
    return expectedSol;
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                    💰 SELLING ALL POSITIONS 💰                           ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
  
  const startBalance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  console.log(`💰 Starting balance: ${startBalance.toFixed(6)} SOL`);
  
  let totalSold = 0;
  
  for (const pos of positions) {
    const result = await sellToken(pos.mint, pos.name, pos.amount);
    if (result) totalSold += result;
    await new Promise(r => setTimeout(r, 2000)); // Wait between sells
  }
  
  const endBalance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  
  console.log(`
══════════════════════════════════════════════════════════════════════
                         📊 RESULTS
══════════════════════════════════════════════════════════════════════
   Start:  ${startBalance.toFixed(6)} SOL
   End:    ${endBalance.toFixed(6)} SOL
   Gained: +${(endBalance - startBalance).toFixed(6)} SOL
══════════════════════════════════════════════════════════════════════
`);
}

main().catch(console.error);
