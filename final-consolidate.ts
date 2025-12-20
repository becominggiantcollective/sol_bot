import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from './src/config/index.js';

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
  
  const tokens = [
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC', raw: '641045' },
    { mint: 'AoZ4piYwhjNoztZytWmF4zAyVn5YdK7NmaUHYHgBvThW', name: 'Unknown', raw: '17586381' },
  ];
  
  console.log('🔄 Final Consolidation to SOL');
  console.log('');
  
  for (const token of tokens) {
    console.log(`Selling ${token.name}...`);
    
    try {
      // Try with higher slippage and onlyDirectRoutes to avoid complex swaps
      const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
        params: {
          inputMint: token.mint,
          outputMint: SOL,
          amount: token.raw,
          slippageBps: 1500, // 15% slippage
          onlyDirectRoutes: true, // simpler routes
        },
        headers: { 'x-api-key': config.jupiter?.apiKey || '' },
        timeout: 15000,
      });
      
      if (!quoteRes.data?.outAmount) {
        console.log(`  ❌ No direct route for ${token.name}`);
        
        // Try without direct routes restriction
        const quoteRes2 = await axios.get('https://api.jup.ag/swap/v1/quote', {
          params: {
            inputMint: token.mint,
            outputMint: SOL,
            amount: token.raw,
            slippageBps: 2000, // 20% slippage
          },
          headers: { 'x-api-key': config.jupiter?.apiKey || '' },
          timeout: 15000,
        });
        
        if (!quoteRes2.data?.outAmount) {
          console.log(`  ❌ No route at all for ${token.name}`);
          continue;
        }
        
        const outSol = parseInt(quoteRes2.data.outAmount) / 1e9;
        console.log(`  Found route: ~${outSol.toFixed(6)} SOL`);
        
        if (outSol < 0.0005) {
          console.log(`  ⏭️ Value too small, skipping`);
          continue;
        }
        
        // Execute
        const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
          quoteResponse: quoteRes2.data,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 50000,
        }, { headers: { 'x-api-key': config.jupiter?.apiKey || '' } });
        
        const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
        const tx = VersionedTransaction.deserialize(txBuf);
        tx.sign([wallet]);
        
        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        console.log(`  ✅ TX: ${sig.slice(0, 30)}...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      const outSol = parseInt(quoteRes.data.outAmount) / 1e9;
      console.log(`  Direct route: ~${outSol.toFixed(6)} SOL`);
      
      if (outSol < 0.0005) {
        console.log(`  ⏭️ Value too small, skipping`);
        continue;
      }
      
      const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
        quoteResponse: quoteRes.data,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000,
      }, { headers: { 'x-api-key': config.jupiter?.apiKey || '' } });
      
      const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([wallet]);
      
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      console.log(`  ✅ TX: ${sig.slice(0, 30)}...`);
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message?.slice(0, 60)}`);
    }
  }
  
  // Final balance
  await new Promise(r => setTimeout(r, 3000));
  const bal = await connection.getBalance(wallet.publicKey);
  console.log(`\n💰 Final SOL: ${(bal/1e9).toFixed(6)} (~$${(bal/1e9*230).toFixed(2)})`);
}

consolidate().catch(console.error);
