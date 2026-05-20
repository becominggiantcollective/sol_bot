import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, TransactionConfirmationStrategy, SystemProgram, SystemInstruction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { loadEnvKeypair, parsePublicKey } from './wallet.js';

// Maximum SOL value that a single transaction is allowed to transfer.
// Configurable via MAX_TX_SOL_CAP env var; default is 500 SOL.
const MAX_TX_SOL_CAP = parseFloat(process.env.MAX_TX_SOL_CAP || '500');
// Maximum lamports transferred per transaction (derived from cap above)
const MAX_TX_LAMPORTS = BigInt(Math.floor(MAX_TX_SOL_CAP * 1e9));

export class SolanaConnection {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private walletPublicKey: PublicKey | null = null;

  constructor(skipWallet: boolean = false) {
    // Enable WebSocket when a dedicated wsUrl is configured (e.g. Alchemy/Helius).
    // Falls back to HTTP-only to avoid subscription issues with plain RPC providers.
    const wsEndpoint = config.solana.wsUrl || undefined;
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
      wsEndpoint,
      confirmTransactionInitialTimeout: 60000, // 60 seconds
    });
    
    if (skipWallet) {
      return; // Skip wallet loading for observation-only mode
    }
    
    try {
      if (config.wallet.provider === 'hardware') {
        if (!config.wallet.hardwarePublicKey) {
          throw new Error(
            'WALLET_HARDWARE_PUBLIC_KEY is required when WALLET_PROVIDER=hardware'
          );
        }
        this.walletPublicKey = parsePublicKey(
          config.wallet.hardwarePublicKey,
          'WALLET_HARDWARE_PUBLIC_KEY'
        );
        console.log(
          `✅ Hardware wallet mode enabled (watch-only): ${this.walletPublicKey.toBase58()}`
        );
        return;
      }

      if (!config.wallet.privateKey) {
        console.warn('⚠️  Wallet private key not configured - running in observation mode');
        return;
      }

      this.wallet = loadEnvKeypair(config.wallet.privateKey);
      this.walletPublicKey = this.wallet.publicKey;
      console.log(`✅ Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
    } catch (error) {
      console.warn('⚠️  Failed to load wallet from config:', error);
      console.warn(
        '   For env mode: set WALLET_IDK_PRIVATE_KEY/WALLET_PRIVATE_KEY (base58 or [1,2,3,...,64]).'
      );
      console.warn('   For hardware mode: set WALLET_PROVIDER=hardware and WALLET_HARDWARE_PUBLIC_KEY.');
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getWallet(): Keypair | null {
    return this.wallet;
  }

  getWalletPublicKey(): PublicKey | null {
    return this.walletPublicKey || this.wallet?.publicKey || null;
  }

  async getBalance(): Promise<number> {
    const publicKey = this.getWalletPublicKey();
    if (!publicKey) return 0;
    const balance = await this.connection.getBalance(publicKey);
    return balance / 1e9; // Convert lamports to SOL
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    if (!this.wallet) {
      if (config.wallet.provider === 'hardware') {
        throw new Error(
          'Hardware wallet mode is watch-only in this runtime. Use an external signer pipeline to broadcast transactions.'
        );
      }
      throw new Error('Wallet not loaded - cannot send transaction');
    }

    // ── DRY_RUN guard: never broadcast real transactions in dry-run mode ──────
    const dryRun = process.env.DRY_RUN?.toLowerCase();
    if (dryRun === 'true' || dryRun === '1' || dryRun === 'yes') {
      throw new Error(
        'DRY_RUN is enabled — transaction blocked at signing boundary. ' +
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
      if (config.wallet.provider === 'hardware') {
        throw new Error(
          'Hardware wallet mode is watch-only in this runtime. Use an external signer pipeline for simulation/signing.'
        );
      }
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
   * in the transaction. Uses the official SDK decoder for robustness.
   * Only native SOL transfers are counted; SPL token transfers use a different
   * program and their amounts are in token units, not lamports.
   */
  private _estimateTransferLamports(transaction: Transaction): bigint {
    let total = BigInt(0);
    for (const ix of transaction.instructions) {
      if (!ix.programId.equals(SystemProgram.programId)) continue;
      try {
        const type = SystemInstruction.decodeInstructionType(ix);
        if (type === 'Transfer') {
          const decoded = SystemInstruction.decodeTransfer(ix);
          total += BigInt(decoded.lamports.toString());
        }
      } catch {
        // Unrecognised system instruction — skip it conservatively
      }
    }
    return total;
  }
}
