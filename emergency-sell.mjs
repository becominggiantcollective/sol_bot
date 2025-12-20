#!/usr/bin/env node
/**
 * EMERGENCY SELL ALL TOKENS
 */

import axios from 'axios';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const CONFIG = {
  privateKey: 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs',
  rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  jupiterApi: 'https://api.jup.ag/swap/v1',
  jupiterApiKey: 'f6663264-66de-4a78-b115-c14a9efc5a05',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Tokens to sell - from the bot's positions
const TOKENS_TO_SELL = [
  { name: 'TRANS', address: '8yyuBHKHZNFBP3hSQ3JTyVz2cLGUQfKqEe4UZRu2pump', amount: 122636220000 }, // 122636.22 tokens (6 decimals)
  { name: 'RUSSELL', address: '176481510000', amount: 176481510000 }, // need to find address
  { name: 'Panya', address: '37Ww2tAa6ZNpvUVaNAXJigQarpVjneQc2yZTbs3VLsnx', amount: 6068160000 }, // 6068.16 tokens
];

const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.privateKey));

console.log('\n🚨 EMERGENCY SELL - Selling all tokens!\n');
console.log(`Wallet: ${wallet.publicKey.toString()}\n`);

async function getTokenAccounts() {
  try {
    const response = await axios.post(CONFIG.rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        wallet.publicKey.toString(),
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]
    });
    
    return response.data?.result?.value || [];
  } catch (err) {
    console.error('Error fetching token accounts:', err.message);
    return [];
  }
}

async function sellToken(mintAddress, amount, name) {
  console.log(`\n💰 Selling ${name} (${mintAddress.slice(0, 8)}...)...`);
  
  try {
    // Get quote
    const quoteResponse = await axios.get(`${CONFIG.jupiterApi}/quote`, {
      params: {
        inputMint: mintAddress,
        outputMint: SOL_MINT,
        amount: amount.toString(),
        slippageBps: 5000, // 50% slippage for emergency sell
      },
      headers: { 'x-api-key': CONFIG.jupiterApiKey },
      timeout: 15000,
    });
    
    if (!quoteResponse.data?.outAmount) {
      console.log(`   ❌ No route available for ${name}`);
      return false;
    }
    
    const outAmount = parseInt(quoteResponse.data.outAmount);
    console.log(`   Quote: ${(outAmount / 1e9).toFixed(6)} SOL`);
    
    // Execute swap
    const swapResponse = await axios.post(`${CONFIG.jupiterApi}/swap`, {
      quoteResponse: quoteResponse.data,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 100000, // Higher priority for emergency
    }, {
      headers: { 'x-api-key': CONFIG.jupiterApiKey },
      timeout: 20000,
    });
    
    if (!swapResponse.data?.swapTransaction) {
      console.log(`   ❌ Failed to create swap transaction`);
      return false;
    }
    
    const swapTxBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(swapTxBuf);
    tx.sign([wallet]);
    
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log(`   ✅ SOLD! TX: https://solscan.io/tx/${signature}`);
    console.log(`   💵 Received: ${(outAmount / 1e9).toFixed(6)} SOL`);
    return true;
    
  } catch (err) {
    console.log(`   ❌ Error: ${err.message?.slice(0, 80)}`);
    return false;
  }
}

async function main() {
  // Get all token accounts
  console.log('📋 Fetching token accounts...\n');
  const accounts = await getTokenAccounts();
  
  console.log(`Found ${accounts.length} token accounts:\n`);
  
  let soldCount = 0;
  let failedCount = 0;
  
  for (const account of accounts) {
    const info = account.account?.data?.parsed?.info;
    if (!info) continue;
    
    const mint = info.mint;
    const balance = info.tokenAmount?.amount;
    const decimals = info.tokenAmount?.decimals;
    const uiAmount = info.tokenAmount?.uiAmount;
    
    // Skip if no balance or it's native SOL wrapped
    if (!balance || balance === '0') continue;
    if (mint === 'So11111111111111111111111111111111111111112') continue;
    
    console.log(`Token: ${mint.slice(0, 12)}...`);
    console.log(`   Balance: ${uiAmount} (raw: ${balance})`);
    
    // Try to sell
    const success = await sellToken(mint, balance, mint.slice(0, 8));
    if (success) soldCount++;
    else failedCount++;
    
    // Small delay between sells
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log(`   Sold:   ${soldCount} tokens`);
  console.log(`   Failed: ${failedCount} tokens (likely rugged/no liquidity)`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Check final balance
  const finalBalance = await connection.getBalance(wallet.publicKey);
  console.log(`Final SOL balance: ${(finalBalance / 1e9).toFixed(6)} SOL\n`);
}

main().catch(console.error);
