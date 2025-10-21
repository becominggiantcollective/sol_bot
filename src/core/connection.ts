import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { config } from '../config';

export class SolanaConnection {
  private connection: Connection;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
      wsEndpoint: config.solana.wsUrl,
    });
    
    if (!config.wallet.privateKey) {
      throw new Error('Wallet private key not configured');
    }
    
    this.wallet = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(config.wallet.privateKey))
    );
  }

  getConnection(): Connection {
    return this.connection;
  }

  getWallet(): Keypair {
    return this.wallet;
  }

  getWalletPublicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9; // Convert lamports to SOL
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    try {
      transaction.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;
      
      transaction.sign(this.wallet);
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.wallet],
        {
          commitment: config.solana.commitment,
          maxRetries: 3,
        }
      );
      
      return signature;
    } catch (error) {
      console.error('Failed to send transaction:', error);
      throw error;
    }
  }

  async simulateTransaction(transaction: Transaction): Promise<any> {
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    
    transaction.sign(this.wallet);
    
    return await this.connection.simulateTransaction(transaction);
  }

  async sendRawTransaction(serializedTransaction: Uint8Array): Promise<string> {
    try {
      const signature = await this.connection.sendRawTransaction(
        serializedTransaction,
        {
          skipPreflight: false,
          maxRetries: 3,
        }
      );
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');
      
      return signature;
    } catch (error) {
      console.error('Failed to send raw transaction:', error);
      throw error;
    }
  }
}