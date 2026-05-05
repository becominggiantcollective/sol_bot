import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';

const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const JUPITER_API = 'https://public.jupiterapi.com';
const API_KEY = process.env.JUPITER_API_KEY;

const PIPPIN_MINT = 'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

async function sellPippin() {
  console.log('🔴 SELLING PIPPIN NOW...\n');
  
  const connection = new Connection(HELIUS_RPC);
  const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Get token balance
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {});
  
  let pippinAmount = '0';
  let pippinUiAmount = 0;
  
  for (const acc of tokenAccounts.value) {
    const mint = acc.account.data.parsed.info.mint;
    if (mint === PIPPIN_MINT) {
      pippinAmount = acc.account.data.parsed.info.tokenAmount.amount;
      pippinUiAmount = acc.account.data.parsed.info.tokenAmount.uiAmount;
      console.log('Found pippin balance:', pippinUiAmount.toLocaleString(), 'tokens');
      break;
    }
  }
  
  if (pippinAmount === '0') {
    console.log('❌ No pippin tokens found!');
    return;
  }
  
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log('Current SOL balance:', solBalance / 1e9);
  
  // Get quote
  console.log('\nGetting quote...');
  const quoteUrl = `${JUPITER_API}/quote?inputMint=${PIPPIN_MINT}&outputMint=${SOL_MINT}&amount=${pippinAmount}&slippageBps=500`;
  
  const quoteRes = await fetch(quoteUrl, {
    headers: { 'x-api-key': API_KEY }
  });
  
  const quote = await quoteRes.json();
  
  if (quote.error) {
    console.log('Quote error:', quote.error);
    return;
  }
  
  const expectedSOL = Number(quote.outAmount) / 1e9;
  console.log('Expected to receive:', expectedSOL.toFixed(6), 'SOL');
  console.log('Price impact:', quote.priceImpactPct || 'N/A');
  
  // Get swap transaction
  console.log('\nBuilding swap transaction...');
  const swapRes = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      priorityLevelWithMaxLamports: {
        priorityLevel: 'high',
        maxLamports: 1000000
      }
    })
  });
  
  const swapData = await swapRes.json();
  
  if (swapData.error) {
    console.log('Swap error:', swapData.error);
    return;
  }
  
  // Sign and send
  const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  
  console.log('\n📤 Sending sell transaction...');
  const sig = await connection.sendTransaction(tx, { 
    skipPreflight: true, 
    maxRetries: 3 
  });
  
  console.log('TX:', sig);
  console.log('🔗 https://solscan.io/tx/' + sig);
  
  // Wait for confirmation
  console.log('\n⏳ Waiting for confirmation...');
  const confirmation = await connection.confirmTransaction(sig, 'confirmed');
  
  if (confirmation.value.err) {
    console.log('❌ TX Failed:', JSON.stringify(confirmation.value.err));
  } else {
    console.log('\n✅ SOLD PIPPIN SUCCESSFULLY!');
    
    const newBalance = await connection.getBalance(wallet.publicKey);
    console.log('New SOL balance:', (newBalance / 1e9).toFixed(6), 'SOL');
    console.log('Gained:', ((newBalance - solBalance) / 1e9).toFixed(6), 'SOL');
  }
}

sellPippin().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
