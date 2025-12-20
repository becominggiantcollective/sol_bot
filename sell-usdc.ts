import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from './src/config/index.js';

async function main() {
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
  
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOL = 'So11111111111111111111111111111111111111112';
  const amount = '641045';
  
  console.log('Selling 0.64 USDC to SOL...');
  
  const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
    params: { inputMint: USDC, outputMint: SOL, amount, slippageBps: 500 },
    headers: { 'x-api-key': config.jupiter?.apiKey || '' },
  });
  
  console.log('Expected:', (parseInt(quoteRes.data.outAmount) / 1e9).toFixed(6), 'SOL');
  
  const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
    quoteResponse: quoteRes.data,
    userPublicKey: wallet.publicKey.toString(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 100000,
  }, { headers: { 'x-api-key': config.jupiter?.apiKey || '' } });
  
  const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  console.log('TX:', sig);
  
  await connection.confirmTransaction(sig, 'confirmed');
  console.log('✅ Confirmed!');
  
  const bal = await connection.getBalance(wallet.publicKey);
  console.log('New balance:', (bal/1e9).toFixed(6), 'SOL (~$' + (bal/1e9*230).toFixed(2) + ')');
}

main().catch(e => console.log('Error:', e.message));
