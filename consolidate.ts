import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from './src/config/index.js';

// Known token info
const TOKENS: Record<string, { name: string; decimals: number }> = {
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { name: 'BONK', decimals: 5 },
  'AoZ4piYwhjNoztZytWmF4zAyVn5YdK7NmaUHYHgBvThW': { name: 'Unknown1', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { name: 'USDT', decimals: 6 },
  '8UzzQHD2tqiT1Jk2HL48kMuJaW6QNi6PGMjqrYfFDAo9': { name: 'Unknown2', decimals: 6 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { name: 'USDC', decimals: 6 },
};

interface TokenToSell {
  mint: string;
  name: string;
  amount: number;
  rawAmount: string;
}

async function consolidate() {
  const connection = new Connection(config.solana.rpcUrl, 'confirmed');
  
  const privateKey = config.wallet.privateKey;
  let wallet: Keypair;
  if (Array.isArray(privateKey)) {
    wallet = Keypair.fromSecretKey(Uint8Array.from(privateKey));
  } else if (privateKey.startsWith('[')) {
    wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
  } else {
    wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  }
  
  const SOL = 'So11111111111111111111111111111111111111112';
  
  // Tokens to sell (from scan)
  const tokensToSell: TokenToSell[] = [
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK', amount: 1030.28843, rawAmount: '103028843' },
    { mint: 'AoZ4piYwhjNoztZytWmF4zAyVn5YdK7NmaUHYHgBvThW', name: 'Unknown1', amount: 17.586381, rawAmount: '17586381' },
    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', name: 'USDT', amount: 0.120573, rawAmount: '120573' },
    { mint: '8UzzQHD2tqiT1Jk2HL48kMuJaW6QNi6PGMjqrYfFDAo9', name: 'Unknown2', amount: 9.488497, rawAmount: '9488497' },
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC', amount: 0.641045, rawAmount: '641045' },
  ];
  
  console.log('🔄 CONSOLIDATING ALL TOKENS TO SOL');
  console.log('='.repeat(50));
  console.log('');
  
  let totalSolReceived = 0;
  
  for (const token of tokensToSell) {
    console.log(`\n📤 Selling ${token.name}: ${token.amount}`);
    
    try {
      // Get quote
      const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
        params: {
          inputMint: token.mint,
          outputMint: SOL,
          amount: token.rawAmount,
          slippageBps: 1000, // 10% slippage
        },
        headers: { 'x-api-key': config.jupiter?.apiKey || '' },
        timeout: 15000,
      });
      
      if (!quoteRes.data?.outAmount) {
        console.log(`   ❌ No route available (too small or illiquid)`);
        continue;
      }
      
      const outSol = parseInt(quoteRes.data.outAmount) / 1e9;
      console.log(`   Expected: ~${outSol.toFixed(6)} SOL (~$${(outSol * 230).toFixed(4)})`);
      
      // Skip if too small (not worth gas)
      if (outSol < 0.0001) {
        console.log(`   ⏭️ Skipping - value too small for gas`);
        continue;
      }
      
      // Execute swap
      const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
        quoteResponse: quoteRes.data,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000,
      }, {
        headers: { 'x-api-key': config.jupiter?.apiKey || '' },
        timeout: 15000,
      });
      
      if (!swapRes.data?.swapTransaction) {
        console.log(`   ❌ Failed to get swap transaction`);
        continue;
      }
      
      // Sign and send
      const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([wallet]);
      
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      
      console.log(`   ✅ Sold! TX: ${sig.slice(0, 30)}...`);
      totalSolReceived += outSol;
      
      // Small delay between swaps
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (err: any) {
      console.log(`   ❌ Failed: ${err.message?.slice(0, 60)}`);
    }
  }
  
  // Final balance
  await new Promise(r => setTimeout(r, 3000));
  const finalBalance = await connection.getBalance(wallet.publicKey);
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 CONSOLIDATION COMPLETE');
  console.log(`   Total SOL received: ~${totalSolReceived.toFixed(6)} SOL`);
  console.log(`   Final balance: ${(finalBalance/1e9).toFixed(6)} SOL (~$${(finalBalance/1e9*230).toFixed(2)})`);
}

consolidate().catch(console.error);
