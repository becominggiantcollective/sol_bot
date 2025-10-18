import { Connection, PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';

/**
 * Orca Direct Integration (Whirlpools)
 * No API calls, no rate limits - reads directly from blockchain
 */

interface OrcaWhirlpoolInfo {
  address: string;
  tokenA: string;
  tokenB: string;
  tickSpacing: number;
  fee: number; // basis points
}

interface OrcaQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpact: number;
  fee: string;
  poolAddress: string;
}

export class OrcaDirect {
  private connection: Connection;
  
  // Orca Whirlpool Program ID
  private readonly WHIRLPOOL_PROGRAM_ID = new PublicKey(
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'
  );

  // Known Whirlpools (fee tier: 0.3%)
  private readonly WHIRLPOOLS: Map<string, OrcaWhirlpoolInfo> = new Map([
    ['SOL-USDC', {
      address: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm', // SOL/USDC 0.3%
      tokenA: 'So11111111111111111111111111111111111111112', // SOL
      tokenB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      tickSpacing: 64,
      fee: 30 // 0.3%
    }],
    ['SOL-USDT', {
      address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ', // SOL/USDT 0.3%
      tokenA: 'So11111111111111111111111111111111111111112', // SOL
      tokenB: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      tickSpacing: 64,
      fee: 30
    }],
  ]);

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get a swap quote from Orca Whirlpool
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amountIn: number
  ): Promise<OrcaQuote | null> {
    try {
      const poolKey = this.getPoolKey(inputMint, outputMint);
      if (!poolKey) {
        console.log(`[Orca] No whirlpool found for ${inputMint} -> ${outputMint}`);
        return null;
      }

      const poolInfo = this.WHIRLPOOLS.get(poolKey);
      if (!poolInfo) return null;

      const poolAddress = new PublicKey(poolInfo.address);
      const accountInfo = await this.connection.getAccountInfo(poolAddress);
      
      if (!accountInfo) {
        console.log(`[Orca] Pool account not found: ${poolInfo.address}`);
        return null;
      }

      // Parse Whirlpool account data
      // Layout: sqrtPrice (u128), tickCurrentIndex (i32), feeGrowthGlobal (u128), etc.
      const data = accountInfo.data;
      
      // sqrtPrice is at offset 65 (after discriminator + padding)
      const sqrtPriceBN = data.readBigUInt64LE(65);
      const sqrtPrice = Number(sqrtPriceBN) / (2 ** 64);
      const currentPrice = sqrtPrice * sqrtPrice;

      // Calculate output amount (simplified - real calculation uses tick math)
      const isReverse = poolInfo.tokenA !== inputMint;
      const price = isReverse ? 1 / currentPrice : currentPrice;
      
      // Apply fee (0.3% = 30 basis points)
      const feeMultiplier = 1 - (poolInfo.fee / 10000);
      const amountOut = amountIn * price * feeMultiplier;
      const feeAmount = amountIn * (poolInfo.fee / 10000);

      // Estimate price impact (simplified)
      const priceImpact = Math.min(amountIn / 100000, 0.05); // Cap at 5%

      return {
        inputMint,
        outputMint,
        inAmount: amountIn.toString(),
        outAmount: amountOut.toString(),
        priceImpact,
        fee: feeAmount.toString(),
        poolAddress: poolInfo.address,
      };
    } catch (error) {
      console.error(`[Orca] Error getting quote:`, error);
      return null;
    }
  }

  /**
   * Get current price from Whirlpool
   */
  async getPrice(baseMint: string, quoteMint: string): Promise<number | null> {
    try {
      const quote = await this.getQuote(baseMint, quoteMint, 1);
      if (!quote) return null;
      
      return parseFloat(quote.outAmount);
    } catch (error) {
      console.error(`[Orca] Error getting price:`, error);
      return null;
    }
  }

  /**
   * Get pool key from token pair
   */
  private getPoolKey(tokenA: string, tokenB: string): string | null {
    // Try direct match
    const directKey = `${this.getTokenSymbol(tokenA)}-${this.getTokenSymbol(tokenB)}`;
    if (this.WHIRLPOOLS.has(directKey)) return directKey;

    // Try reverse match
    const reverseKey = `${this.getTokenSymbol(tokenB)}-${this.getTokenSymbol(tokenA)}`;
    if (this.WHIRLPOOLS.has(reverseKey)) return reverseKey;

    return null;
  }

  /**
   * Get token symbol from mint address
   */
  private getTokenSymbol(mint: string): string {
    const symbols: Record<string, string> = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    };
    return symbols[mint] || mint;
  }

  /**
   * Get all available whirlpools
   */
  getWhirlpools(): OrcaWhirlpoolInfo[] {
    return Array.from(this.WHIRLPOOLS.values());
  }
}
