#!/usr/bin/env node
/**
 * CONSOLIDATE ALL TOKENS TO SOL
 * - Fetches all token accounts in your wallet
 * - Attempts to swap each token to SOL via Jupiter
 * - Closes empty token accounts to recover rent
 */

import fetch from 'node-fetch';

const CONFIG = {
  walletKey: 'YFBxhJvJXXEyzNF6gzMZqifEC9DdrfLtW8Bto4V9fyFp3ALoakJD6W11PvPnezt8cFQWDJUZAqkLcyPzeJ2syzs',
  walletAddress: 'EZpCKtCMj3dMjnPt2f1egkBQ2khhXP8uK5bWiSt6Y1VV',
  heliusRpc: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
  jupiterApiKey: 'f6663264-66de-4a78-b115-c14a9efc5a05',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function getTokenAccounts() {
  const response = await fetch(CONFIG.heliusRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        CONFIG.walletAddress,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]
    })
  });
  
  const data = await response.json();
  return data.result?.value || [];
}

async function getTokenMetadata(mint) {
  try {
    // Try to get token info from Jupiter
    const response = await fetch(`https://api.jup.ag/tokens/v1/token/${mint}`);
    if (response.ok) {
      const data = await response.json();
      return {
        symbol: data.symbol || 'UNKNOWN',
        name: data.name || 'Unknown Token',
        decimals: data.decimals
      };
    }
  } catch (e) {}
  
  return { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: null };
}

async function getQuote(inputMint, outputMint, amount) {
  try {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=5000`;
    const response = await fetch(url, {
      headers: { 'x-api-key': CONFIG.jupiterApiKey }
    });
    
    if (!response.ok) {
      const err = await response.text();
      return { error: err };
    }
    
    const data = await response.json();
    if (data.error) return { error: data.error };
    
    return data;
  } catch (error) {
    return { error: error.message };
  }
}

async function executeSwap(quote) {
  try {
    const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.jupiterApiKey,
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: CONFIG.walletAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 500000, // 0.0005 SOL max priority fee
            priorityLevel: 'medium'
          }
        },
      }),
    });
    
    if (!swapRes.ok) {
      const err = await swapRes.text();
      return { success: false, error: err };
    }
    
    const swapData = await swapRes.json();
    if (swapData.error) return { success: false, error: swapData.error };
    
    // Sign and send
    const { Keypair, VersionedTransaction, Connection } = await import('@solana/web3.js');
    const bs58 = await import('bs58');
    
    const keypair = Keypair.fromSecretKey(bs58.default.decode(CONFIG.walletKey));
    const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
    
    const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([keypair]);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(sig, 'confirmed');
    if (confirmation.value.err) {
      return { success: false, error: JSON.stringify(confirmation.value.err) };
    }
    
    return { success: true, signature: sig, outputAmount: parseInt(quote.outAmount) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function closeTokenAccount(tokenAccountPubkey) {
  try {
    const { Keypair, Connection, PublicKey, Transaction } = await import('@solana/web3.js');
    const { createCloseAccountInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const bs58 = await import('bs58');
    
    const keypair = Keypair.fromSecretKey(bs58.default.decode(CONFIG.walletKey));
    const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
    
    const tokenAccount = new PublicKey(tokenAccountPubkey);
    const owner = new PublicKey(CONFIG.walletAddress);
    
    const closeIx = createCloseAccountInstruction(
      tokenAccount,
      owner, // destination for rent
      owner, // authority
      [],
      TOKEN_PROGRAM_ID
    );
    
    const tx = new Transaction().add(closeIx);
    tx.feePayer = owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(keypair);
    
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    
    return { success: true, signature: sig };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function burnAndCloseTokenAccount(tokenAccountPubkey, mint, amount) {
  try {
    const { Keypair, Connection, PublicKey, Transaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const { createBurnInstruction, createCloseAccountInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const bs58 = await import('bs58');
    
    const keypair = Keypair.fromSecretKey(bs58.default.decode(CONFIG.walletKey));
    const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
    
    const tokenAccount = new PublicKey(tokenAccountPubkey);
    const mintPubkey = new PublicKey(mint);
    const owner = new PublicKey(CONFIG.walletAddress);
    
    // Create transaction with burn + close
    const tx = new Transaction();
    
    // Add compute budget
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    
    // Burn all tokens
    tx.add(createBurnInstruction(
      tokenAccount,
      mintPubkey,
      owner,
      BigInt(amount),
      [],
      TOKEN_PROGRAM_ID
    ));
    
    // Close the account
    tx.add(createCloseAccountInstruction(
      tokenAccount,
      owner, // destination for rent
      owner, // authority
      [],
      TOKEN_PROGRAM_ID
    ));
    
    tx.feePayer = owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(keypair);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    await connection.confirmTransaction(sig, 'confirmed');
    
    return { success: true, signature: sig };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║              💰 CONSOLIDATE ALL TOKENS TO SOL 💰                        ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Wallet: ${CONFIG.walletAddress}             ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  // Get current SOL balance
  const { Connection } = await import('@solana/web3.js');
  const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
  const solBalance = await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(CONFIG.walletAddress));
  console.log(`💎 Current SOL balance: ${(solBalance / 1e9).toFixed(6)} SOL\n`);

  // Get all token accounts
  console.log('🔍 Scanning for token accounts...\n');
  const tokenAccounts = await getTokenAccounts();
  
  if (tokenAccounts.length === 0) {
    console.log('✅ No token accounts found. Wallet is already clean!');
    return;
  }
  
  console.log(`Found ${tokenAccounts.length} token account(s):\n`);
  
  let totalRecoveredSol = 0;
  let swappedCount = 0;
  let closedCount = 0;
  let failedCount = 0;
  
  for (const account of tokenAccounts) {
    const info = account.account.data.parsed.info;
    const mint = info.mint;
    const amount = info.tokenAmount.amount;
    const uiAmount = info.tokenAmount.uiAmount;
    const decimals = info.tokenAmount.decimals;
    const accountPubkey = account.pubkey;
    
    // Get token metadata
    const metadata = await getTokenMetadata(mint);
    
    console.log(`${'─'.repeat(70)}`);
    console.log(`📦 Token: ${metadata.symbol} (${metadata.name})`);
    console.log(`   Mint: ${mint}`);
    console.log(`   Amount: ${uiAmount} tokens`);
    console.log(`   Account: ${accountPubkey}`);
    
    if (parseFloat(amount) === 0) {
      // Token account is empty, try to close it to recover rent
      console.log(`   ⚪ Balance is 0, closing account to recover rent...`);
      const closeResult = await closeTokenAccount(accountPubkey);
      
      if (closeResult.success) {
        console.log(`   ✅ Account closed! TX: https://solscan.io/tx/${closeResult.signature}`);
        console.log(`   💰 Recovered ~0.002 SOL rent`);
        totalRecoveredSol += 0.002;
        closedCount++;
      } else {
        console.log(`   ❌ Failed to close: ${closeResult.error}`);
        failedCount++;
      }
      continue;
    }
    
    // Try to swap to SOL
    console.log(`   🔄 Getting quote to swap to SOL...`);
    const quote = await getQuote(mint, SOL_MINT, amount);
    
    if (quote.error) {
      console.log(`   ❌ No swap route available: ${quote.error}`);
      console.log(`   ⚠️ This token may be RUGGED or have no liquidity`);
      console.log(`   🔥 Attempting to BURN tokens and close account to recover rent...`);
      
      const burnResult = await burnAndCloseTokenAccount(accountPubkey, mint, amount);
      if (burnResult.success) {
        console.log(`   ✅ Burned ${uiAmount} worthless tokens and closed account!`);
        console.log(`   TX: https://solscan.io/tx/${burnResult.signature}`);
        console.log(`   💰 Recovered ~0.002 SOL rent`);
        totalRecoveredSol += 0.002;
        closedCount++;
      } else {
        console.log(`   ❌ Burn failed: ${burnResult.error}`);
        failedCount++;
      }
      continue;
    }
    
    const outputSol = parseInt(quote.outAmount) / 1e9;
    console.log(`   📈 Quote: ${uiAmount} ${metadata.symbol} → ${outputSol.toFixed(6)} SOL`);
    
    // Check if it's worth swapping (need enough SOL to pay for tx)
    if (outputSol < 0.0001) {
      console.log(`   ⚠️ Output too small (${outputSol.toFixed(6)} SOL), skipping swap`);
      console.log(`   💡 Tip: You can still close the account after transferring tokens elsewhere`);
      failedCount++;
      continue;
    }
    
    // Execute swap
    console.log(`   🚀 Executing swap...`);
    const swapResult = await executeSwap(quote);
    
    if (swapResult.success) {
      console.log(`   ✅ Swapped! TX: https://solscan.io/tx/${swapResult.signature}`);
      console.log(`   💰 Received: ${outputSol.toFixed(6)} SOL`);
      totalRecoveredSol += outputSol;
      swappedCount++;
      
      // Try to close the now-empty account
      console.log(`   🧹 Closing empty token account...`);
      await new Promise(r => setTimeout(r, 2000)); // Wait for state to update
      const closeResult = await closeTokenAccount(accountPubkey);
      if (closeResult.success) {
        console.log(`   ✅ Account closed! Recovered ~0.002 SOL rent`);
        totalRecoveredSol += 0.002;
        closedCount++;
      }
    } else {
      console.log(`   ❌ Swap failed: ${swapResult.error}`);
      failedCount++;
    }
  }
  
  // Final summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`                         📊 SUMMARY`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`   Tokens swapped to SOL: ${swappedCount}`);
  console.log(`   Accounts closed: ${closedCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Total SOL recovered: ~${totalRecoveredSol.toFixed(6)} SOL`);
  
  // Get final balance
  const finalBalance = await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(CONFIG.walletAddress));
  console.log(`\n   💎 Final SOL balance: ${(finalBalance / 1e9).toFixed(6)} SOL`);
  console.log(`${'═'.repeat(70)}`);
}

main().catch(console.error);
