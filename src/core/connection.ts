import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, TransactionConfirmationStrategy } from '@solana/web3.js';
// @ts-ignore - bs58 types
import bs58 from 'bs58';
import { config } from '../config/index.js';

export class SolanaConnection {
  private connection: Connection;
  private wallet: Keypair | null = null;

  constructor(skipWallet: boolean = false) {
    // Use HTTP-only connection without WebSocket to avoid subscription issues
    // Many RPC providers don't support signatureSubscribe via WebSocket
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
      // Disable WebSocket by not providing wsEndpoint
      // wsEndpoint: config.solana.wsUrl,
      confirmTransactionInitialTimeout: 60000, // 60 seconds
    });
    
    if (skipWallet) {
      return; // Skip wallet loading for observation-only mode
    }
    
    if (!config.wallet.privateKey) {
      console.warn('⚠️  Wallet private key not configured - running in observation mode');
      return;
    }
    
    try {
      // Try base58 format first (most common)
      if (config.wallet.privateKey.startsWith('[')) {
        // JSON array format: [1,2,3,...]
        this.wallet = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(config.wallet.privateKey))
        );
      } else {
        // Base58 format (default Solana CLI export)
        this.wallet = Keypair.fromSecretKey(
          bs58.decode(config.wallet.privateKey)
        );
      }
      console.log(`✅ Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
    } catch (error) {
      console.warn('⚠️  Failed to load wallet from config:', error);
      console.warn('   Supported formats: base58 string or JSON array [1,2,3,...]');
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getWallet(): Keypair | null {
    return this.wallet;
  }

  getWalletPublicKey(): PublicKey | null {
    return this.wallet?.publicKey || null;
  }

  async getBalance(): Promise<number> {
    if (!this.wallet) return 0;
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9; // Convert lamports to SOL
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not loaded - cannot send transaction');
    }
    try {
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
      
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = this.wallet.publicKey;
      
      transaction.sign(this.wallet);
      
      // Send raw transaction with skipPreflight for speed
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false, // Keep preflight for safety
          maxRetries: 3,
          preflightCommitment: 'confirmed',
        }
      );
      
      console.log(`Transaction sent: ${signature}`);
      
      // Use polling-based confirmation instead of WebSocket
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`Transaction confirmed: ${signature}`);
      return signature;
    } catch (error) {
      console.error('Failed to send transaction:', error);
      throw error;
    }
  }

  async simulateTransaction(transaction: Transaction): Promise<any> {
    if (!this.wallet) {
      throw new Error('Wallet not loaded - cannot simulate transaction');
    }
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    
    transaction.sign(this.wallet);
    
    return await this.connection.simulateTransaction(transaction);
  }
}