#!/usr/bin/env node
// INSTANT SELL - One command, all tokens sold to SOL
import bs58 from 'bs58';
import { Keypair, Connection, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const PRIVATE_KEY = '2bYF7j9KWjEfuLLpiYezrH9z7HUpBc3J29zE7j6ZviNkavRkZZFPNurog251FNxHzgs56PwwcrX4DbEN4FSpqkcx';
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const API_KEY = 'f6663264-66de-4a78-b115-c14a9efc5a05';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Skip these (wrapped SOL, stablecoins we want to keep)
const SKIP_MINTS = new Set([SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);

const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

async function sellToken(mint, amount, symbol) {
  try {
    const quoteRes = await fetch(`${JUPITER_API}/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=1000`, {
      headers: { 'x-api-key': API_KEY }
    });
    const quote = await quoteRes.json();
    if (quote.error || !quote.outAmount) return { success: false, error: quote.error || 'No route' };

    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        priorityLevelWithMaxLamports: { priorityLevel: 'high', maxLamports: 500000 }
      })
    });
    const swapData = await swapRes.json();
    if (swapData.error) return { success: false, error: swapData.error };

    const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    tx.sign([wallet]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig, 'confirmed');
    
    return { success: true, sig, solOut: Number(quote.outAmount) / 1e9 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('🔴 SELLING ALL TOKENS NOW\n');
  
  const startBal = await connection.getBalance(wallet.publicKey);
  console.log(`Starting SOL: ${(startBal / 1e9).toFixed(6)}\n`);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID });
  
  let sold = 0, failed = 0;
  for (const acc of tokenAccounts.value) {
    const mint = acc.account.data.parsed.info.mint;
    const amount = acc.account.data.parsed.info.tokenAmount.amount;
    const uiAmount = acc.account.data.parsed.info.tokenAmount.uiAmount;
    
    if (SKIP_MINTS.has(mint) || amount === '0') continue;
    
    const symbol = mint.slice(0, 8);
    process.stdout.write(`Selling ${symbol}... `);
    
    const result = await sellToken(mint, amount, symbol);
    if (result.success) {
      console.log(`✅ +${result.solOut.toFixed(6)} SOL`);
      sold++;
    } else {
      console.log(`❌ ${result.error}`);
      failed++;
    }
  }

  const endBal = await connection.getBalance(wallet.publicKey);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Final SOL: ${(endBal / 1e9).toFixed(6)}`);
  console.log(`Gained: +${((endBal - startBal) / 1e9).toFixed(6)} SOL`);
  console.log(`Sold: ${sold} | Failed: ${failed}`);
}

main().catch(console.error);
