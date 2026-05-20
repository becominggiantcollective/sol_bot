import { Keypair, PublicKey } from '@solana/web3.js';
// @ts-ignore - bs58 types
import bs58 from 'bs58';

export type WalletProvider = 'env' | 'hardware';

export function parseWalletProvider(value: string | undefined): WalletProvider {
  return value === 'hardware' ? 'hardware' : 'env';
}

export function parsePublicKey(value: string, fieldName: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${fieldName}`);
  }
}

export function loadEnvKeypair(privateKeyRaw: string): Keypair {
  const raw = privateKeyRaw.trim();
  if (!raw) {
    throw new Error('Wallet private key is empty');
  }

  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Wallet private key JSON must be an array');
    }
    if (parsed.length !== 64) {
      throw new Error('Wallet private key JSON must contain 64 bytes');
    }
    for (const value of parsed) {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error('Wallet private key JSON must contain only byte values');
      }
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  const decoded = bs58.decode(raw);
  if (decoded.length !== 64) {
    throw new Error('Wallet private key base58 must decode to 64 bytes');
  }
  return Keypair.fromSecretKey(decoded);
}
