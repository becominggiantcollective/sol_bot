import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from './src/config/index.js';

async function sellToken() {
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
  
  const FINANCIAL_TOKEN = 'AqwVnT7JGbeZe8vibg3aVUhqW7eKJc5Codkn7LYSTis';
  const SOL = 'So11111111111111111111111111111111111111112';
  const AMOUNT = 485514544627; // 485,514 tokens (6 decimals)
  
  console.log('🔄 Selling MrBeast Financial token...');
  console.log(`   Amount: 485,514 tokens`);
  
  try {
    // Get quote
    const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
      params: {
        inputMint: FINANCIAL_TOKEN,
        outputMint: SOL,
        amount: AMOUNT,
        slippageBps: 1000, // 10% slippage for illiquid token
      },
      headers: { 'x-api-key': config.jupiter?.apiKey || '' },
      timeout: 15000,
    });
    
    if (!quoteRes.data?.outAmount) {
      console.log('❌ No quote available - token may be too illiquid');
      return;
    }
    
    const outSol = parseInt(quoteRes.data.outAmount) / 1e9;
    console.log(`   Expected: ~${outSol.toFixed(6)} SOL (~$${(outSol * 230).toFixed(2)})`);
    
    // Execute swap
    const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
      quoteResponse: quoteRes.data,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 100000,
    }, {
      headers: { 'x-api-key': config.jupiter?.apiKey || '' },
      timeout: 15000,
    });
    
    if (!swapRes.data?.swapTransaction) {
      console.log('❌ Failed to get swap transaction');
      return;
    }
    
    // Sign and send
    const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log(`✅ SOLD! TX: ${sig}`);
    console.log(`   https://solscan.io/tx/${sig}`);
    
    // Wait and check balance
    await new Promise(r => setTimeout(r, 3000));
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`\n💰 New SOL balance: ${(balance/1e9).toFixed(6)} SOL (~$${(balance/1e9*230).toFixed(2)})`);
    
  } catch (err: any) {
    console.log('❌ Sell failed:', err.message?.slice(0, 100));
  }
}

sellToken();
