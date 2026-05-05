import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const RPC = process.env.HELIUS_RPC_URL;
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const JUPITER_KEY = process.env.JUPITER_API_KEY;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const connection = new Connection(RPC, 'confirmed');

// Wallet
const privateKeyArray = JSON.parse(process.env.WALLET_PRIVATE_KEY || '[]');
const wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));

console.log('💰 TOKEN LIQUIDATION TOOL');
console.log(`Wallet: ${wallet.publicKey.toString()}`);
console.log('');

async function getTokenAccounts() {
  const response = await connection.getParsedTokenAccountsByOwner(
    wallet.publicKey,
    { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
  );
  
  return response.value
    .map(acc => ({
      mint: acc.account.data.parsed.info.mint,
      amount: acc.account.data.parsed.info.tokenAmount.amount,
      uiAmount: acc.account.data.parsed.info.tokenAmount.uiAmount,
      decimals: acc.account.data.parsed.info.tokenAmount.decimals,
    }))
    .filter(t => t.uiAmount > 0);
}

async function sellToken(mint: string, amount: string, decimals: number): Promise<string | null> {
  try {
    console.log(`  Selling ${mint.slice(0, 8)}... (${amount} base units)`);
    
    // Get quote
    const quoteRes = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint: mint,
        outputMint: SOL_MINT,
        amount: amount,
        slippageBps: 2000, // 20% slippage for meme coins
      },
      headers: { 'x-api-key': JUPITER_KEY },
      timeout: 15000,
    });
    
    if (!quoteRes.data || !quoteRes.data.outAmount) {
      console.log(`  ❌ No quote available for ${mint.slice(0, 8)}`);
      return null;
    }
    
    const outAmountSOL = parseInt(quoteRes.data.outAmount) / 1e9;
    console.log(`  📊 Quote: ${outAmountSOL.toFixed(6)} SOL`);
    
    if (outAmountSOL < 0.0001) {
      console.log(`  ⚠️ Output too small, skipping`);
      return null;
    }
    
    // Build swap
    const swapRes = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quoteRes.data,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 100000,
    }, {
      headers: { 'x-api-key': JUPITER_KEY },
      timeout: 15000,
    });
    
    if (!swapRes.data?.swapTransaction) {
      console.log(`  ❌ Failed to build swap`);
      return null;
    }
    
    // Sign and send
    const txBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log(`  ⏳ TX: ${sig.slice(0, 20)}... waiting...`);
    
    // Wait for confirmation
    const blockhash = await connection.getLatestBlockhash('confirmed');
    const conf = await connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    }, 'confirmed');
    
    if (conf.value.err) {
      console.log(`  ❌ TX failed: ${JSON.stringify(conf.value.err)}`);
      return null;
    }
    
    console.log(`  ✅ SOLD! Got ~${outAmountSOL.toFixed(6)} SOL`);
    return sig;
    
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message?.slice(0, 50)}`);
    return null;
  }
}

async function main() {
  // Get initial balance
  const initialBalance = await connection.getBalance(wallet.publicKey);
  console.log(`Initial SOL: ${(initialBalance / 1e9).toFixed(6)}`);
  console.log('');
  
  // Get all tokens
  const tokens = await getTokenAccounts();
  console.log(`Found ${tokens.length} tokens with balance`);
  console.log('');
  
  let totalSold = 0;
  
  for (const token of tokens) {
    // Skip BONK if tiny
    if (token.mint === 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' && token.uiAmount < 10000) {
      console.log(`Skipping BONK (too small: ${token.uiAmount})`);
      continue;
    }
    
    console.log(`\n📤 Processing: ${token.mint.slice(0, 12)}...`);
    console.log(`   Amount: ${token.uiAmount}`);
    
    const result = await sellToken(token.mint, token.amount, token.decimals);
    if (result) {
      totalSold++;
    }
    
    // Small delay between sells
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Final balance
  const finalBalance = await connection.getBalance(wallet.publicKey);
  const gained = (finalBalance - initialBalance) / 1e9;
  
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Tokens sold: ${totalSold}`);
  console.log(`Initial SOL: ${(initialBalance / 1e9).toFixed(6)}`);
  console.log(`Final SOL:   ${(finalBalance / 1e9).toFixed(6)}`);
  console.log(`Net gain:    ${gained >= 0 ? '+' : ''}${gained.toFixed(6)} SOL`);
}

main().catch(console.error);
