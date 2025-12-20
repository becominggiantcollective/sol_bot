#!/usr/bin/env node
/**
 * TRANSFER SOL FROM BACKUP WALLET TO PRIMARY WALLET
 */

const BACKUP_WALLET_KEY_BYTES = [246,195,56,94,100,225,214,225,145,200,125,248,150,51,61,53,233,80,175,70,247,233,19,88,94,249,136,162,189,12,21,70,126,46,200,247,111,147,46,28,29,146,202,6,232,58,244,189,74,158,61,27,152,77,118,47,33,169,144,208,20,84,110,149];

const CONFIG = {
  backupWallet: '9VZkKLpzCwfHXpHFRW7T2NXZ68T9E5vwgFaXtCzdtgzQ',
  primaryWallet: 'EZpCKtCMj3dMjnPt2f1egkBQ2khhXP8uK5bWiSt6Y1VV',
  heliusRpc: 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe',
};

async function main() {
  const { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
  
  const connection = new Connection(CONFIG.heliusRpc, 'confirmed');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(BACKUP_WALLET_KEY_BYTES));
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║            💸 TRANSFER SOL TO PRIMARY WALLET 💸                         ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
  
  // Get balances
  const backupBalance = await connection.getBalance(new PublicKey(CONFIG.backupWallet));
  const primaryBalance = await connection.getBalance(new PublicKey(CONFIG.primaryWallet));
  
  console.log(`📤 From (Backup):  ${CONFIG.backupWallet}`);
  console.log(`   Balance: ${(backupBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`\n📥 To (Primary):   ${CONFIG.primaryWallet}`);
  console.log(`   Balance: ${(primaryBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  
  // Leave 0.001 SOL for rent-exempt minimum
  const txFee = 5000; // ~0.000005 SOL
  const keepAmount = 0; // Transfer everything possible
  const transferAmount = backupBalance - txFee - keepAmount;
  
  if (transferAmount <= 0) {
    console.log(`\n❌ Not enough SOL to transfer (need to keep some for tx fees)`);
    return;
  }
  
  console.log(`\n💰 Transferring: ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   (Keeping ${(txFee / LAMPORTS_PER_SOL).toFixed(6)} SOL for tx fee)`);
  
  // Create transfer transaction
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(CONFIG.backupWallet),
      toPubkey: new PublicKey(CONFIG.primaryWallet),
      lamports: transferAmount,
    })
  );
  
  tx.feePayer = new PublicKey(CONFIG.backupWallet);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(keypair);
  
  console.log(`\n🚀 Sending transaction...`);
  
  try {
    const sig = await connection.sendRawTransaction(tx.serialize());
    console.log(`   TX: https://solscan.io/tx/${sig}`);
    
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`   ✅ Confirmed!`);
    
    // Get new balances
    const newBackupBalance = await connection.getBalance(new PublicKey(CONFIG.backupWallet));
    const newPrimaryBalance = await connection.getBalance(new PublicKey(CONFIG.primaryWallet));
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`                      📊 FINAL BALANCES`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   Backup wallet:  ${(newBackupBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`   Primary wallet: ${(newPrimaryBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`${'═'.repeat(70)}`);
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

main().catch(console.error);
