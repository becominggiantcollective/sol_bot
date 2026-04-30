import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, TransactionConfirmationStrategy, SystemProgram } from '@solana/web3.js';
// @ts-ignore - bs58 types
import bs58 from 'bs58';
import { config } from '../config/index.js';

// Maximum SOL value that a single transaction is allowed to transfer.
// Configurable via MAX_TX_SOL_CAP env var; default is 500 SOL.
const MAX_TX_SOL_CAP = parseFloat(process.env.MAX_TX_SOL_CAP || '500');
// Maximum lamports transferred per transaction (derived from cap above)
const MAX_TX_LAMPORTS = BigInt(Math.round(MAX_TX_SOL_CAP * 1e9));

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

    // ── DRY_RUN guard: never broadcast real transactions in dry-run mode ──────
    if (process.env.DRY_RUN === 'true') {
      throw new Error(
        'DRY_RUN=true — transaction blocked at signing boundary. ' +
        'Set DRY_RUN=false to allow live transactions.'
      );
    }

    // ── Amount cap: reject transactions that transfer more than MAX_TX_SOL_CAP ─
    const totalTransferred = this._estimateTransferLamports(transaction);
    if (totalTransferred > MAX_TX_LAMPORTS) {
      throw new Error(
        `Transaction rejected: transfer amount ${totalTransferred} lamports exceeds ` +
        `safety cap of ${MAX_TX_LAMPORTS} lamports (${MAX_TX_SOL_CAP} SOL). ` +
        `Increase MAX_TX_SOL_CAP env var if intentional.`
      );
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

  /**
   * Estimate the total lamports transferred by SystemProgram.transfer instructions
   * in the transaction. Used for the amount-cap safety check.
   */
  private _estimateTransferLamports(transaction: Transaction): bigint {
    let total = BigInt(0);
    for (const ix of transaction.instructions) {
      // Only inspect native SOL transfers; SPL token transfers use a different
      // program and their "amount" field is in token units, not lamports.
      if (ix.programId.equals(SystemProgram.programId) && ix.data.length >= 12) {
        // SystemProgram.transfer layout: [4-byte instruction index][8-byte lamports]
        const instructionIndex = ix.data.readUInt32LE(0);
        if (instructionIndex === 2) { // Transfer = index 2
          const lamports = ix.data.readBigUInt64LE(4);
          total += lamports;
        }
      }
    }
    return total;
  }
}