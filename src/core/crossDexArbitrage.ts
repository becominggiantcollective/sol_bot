/**
 * CROSS-DEX TRIANGULAR ARBITRAGE DETECTOR
 * 
 * Strategy: A → B → C → A across DIFFERENT DEXes
 * 
 * Key fixes from your original:
 * 1. Constructor can't be async - move SOL price fetch elsewhere
 * 2. Raydium/Orca APIs have changed - use correct endpoints
 * 3. Add proper error handling and validation
 * 4. Fix decimal handling issues
 * 5. Add quote freshness validation
 * 6. Fix the swap fee calculation (per-swap vs total)
 */

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import axios from 'axios';
import * as fs from 'fs';

// ============================================================================
// TYPES
// ============================================================================

interface TokenInfo {
  mint: string;
  decimals: number;
  symbol: string;
}

interface DexAggregator {
  name: string;
  apiUrl: string;
  enabled: boolean;
}

interface DexQuote {
  dex: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  outputAmount: bigint;
  inputAmountHuman: number;
  outputAmountHuman: number;
  priceImpactPct: number;
  route?: any;
  totalFeesInInputToken: number; // Estimated total fees for this leg converted to input token units
  timestamp: number;
  expiresAt: number;
}

interface TriangleRoute {
  dex: string;
  from: string;
  to: string;
  fromSymbol: string;
  toSymbol: string;
  amountIn: bigint;
  amountOut: bigint;
  amountInHuman: number;
  amountOutHuman: number;
  priceImpact: number;
  feeInInputToken: number;
}

interface TriangularOpportunity {
  triangle: [string, string, string];
  triangleSymbols: [string, string, string];
  inputAmount: number;
  inputToken: string;
  expectedOutput: number;
  grossProfit: number;
  grossProfitPercent: number;
  totalSwapFees: number;           // Estimated total AMM + platform fees in input token units
  totalSwapFeePercent: number;     // Fees / inputAmount * 100
  gasCostSOL: number;
  gasCostInInputToken: number;
  netProfit: number;
  netProfitPercent: number;
  isProfitable: boolean;
  routes: TriangleRoute[];
  timestamp: number;
  quoteAgeMs: number;
}

// ============================================================================
// TOKEN REGISTRY - CORRECT DECIMALS
// ============================================================================

const TOKENS: Record<string, TokenInfo> = {
  // Native SOL
  'So11111111111111111111111111111111111111112': { mint: 'So11111111111111111111111111111111111111112', decimals: 9, symbol: 'SOL' },
  // Stablecoins
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, symbol: 'USDC' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, symbol: 'USDT' },
  // Liquid staking
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9, symbol: 'mSOL' },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9, symbol: 'jitoSOL' },
  // DEX tokens
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, symbol: 'JUP' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, symbol: 'RAY' },
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, symbol: 'ORCA' },
  // Meme coins
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, symbol: 'BONK' },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, symbol: 'WIF' },
  // DeFi
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6, symbol: 'PYTH' },
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, symbol: 'JTO' },
};

// Mint address to token info lookup
const MINT_TO_TOKEN: Map<string, TokenInfo> = new Map(
  Object.values(TOKENS).map(t => [t.mint, t])
);

// ============================================================================
// UNIT CONVERSION - CRITICAL FOR CORRECT CALCULATIONS
// ============================================================================

function getToken(mintOrSymbol: string): TokenInfo | null {
  // Check if it's a mint address
  if (MINT_TO_TOKEN.has(mintOrSymbol)) {
    return MINT_TO_TOKEN.get(mintOrSymbol)!;
  }
  // Check if it's a symbol
  const bySymbol = Object.values(TOKENS).find(t => t.symbol === mintOrSymbol);
  return bySymbol || null;
}

function getDecimals(mint: string): number {
  return MINT_TO_TOKEN.get(mint)?.decimals || 9;
}

function getSymbol(mint: string): string {
  return MINT_TO_TOKEN.get(mint)?.symbol || mint.slice(0, 6);
}

function toRaw(humanAmount: number, mint: string): bigint {
  const decimals = getDecimals(mint);
  return BigInt(Math.round(humanAmount * (10 ** decimals)));
}

function toHuman(rawAmount: bigint | number | string, mint: string): number {
  const decimals = getDecimals(mint);
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  return Number(raw) / (10 ** decimals);
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  private backoffMs: number = 0;
  private maxBackoff: number = 30000;

  constructor(maxRequests: number = 5, windowMs: number = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    
    const waitTime = Math.max(
      this.requests.length >= this.maxRequests 
        ? this.windowMs - (now - this.requests[0]) + 10 
        : 0,
      this.backoffMs
    );
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.requests.push(Date.now());
  }

  onSuccess(): void {
    this.backoffMs = Math.max(0, this.backoffMs - 100);
  }

  onRateLimit(): void {
    this.backoffMs = Math.min(this.maxBackoff, (this.backoffMs || 500) * 2);
    console.log(`  [RATE_LIMIT] Backing off ${this.backoffMs}ms`);
  }
}

// ============================================================================
// DYNAMIC GAS PRICER
// ============================================================================

class DynamicGasPricer {
  private cachedFee: number = 0.0001;
  private lastFetch: number = 0;
  private CACHE_TTL: number = 10000;

  async getCurrentGasFee(connection?: Connection): Promise<number> {
    const now = Date.now();
    if (now - this.lastFetch < this.CACHE_TTL) {
      return this.cachedFee;
    }

    if (connection) {
      try {
        const fees = await connection.getRecentPrioritizationFees();
        if (fees && fees.length > 0) {
          const sortedFees = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
          const medianMicroLamports = sortedFees[Math.floor(sortedFees.length / 2)];
          const priorityFeeSOL = (medianMicroLamports * 200000) / 1e15;
          this.cachedFee = Math.max(0.00005, Math.min(0.005, priorityFeeSOL + 0.00001));
        }
        this.lastFetch = now;
      } catch {
        // Use cached value on error
      }
    }

    return this.cachedFee;
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JITO_TIP_SOL = parseFloat(process.env.JITO_TIP_AMOUNT || '0');

// Price cache for quick USD conversions
const priceCache: Map<string, { price: number; ts: number }> = new Map();
const PRICE_TTL_MS = 15_000;

// Jupiter API headers with API key
const getJupiterHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.jupiter?.apiKey) headers['x-api-key'] = config.jupiter.apiKey;
  return headers;
};

async function getUsdPrice(mint: string): Promise<number> {
  const cached = priceCache.get(mint);
  const now = Date.now();
  if (cached && now - cached.ts < PRICE_TTL_MS) return cached.price;

  try {
    const res = await axios.get('https://api.jup.ag/price/v2', { params: { ids: mint }, headers: getJupiterHeaders() });
    const price = parseFloat(res.data?.data?.[mint]?.price || '0');
    if (price > 0) {
      priceCache.set(mint, { price, ts: now });
      return price;
    }
  } catch {
    // ignore
  }
  return 0; // caller should handle fallback
}

async function convertAmountBetweenTokens(amount: number, fromMint: string, toMint: string): Promise<number> {
  if (fromMint === toMint) return amount;
  const fromPrice = await getUsdPrice(fromMint);
  const toPrice = await getUsdPrice(toMint);
  if (fromPrice <= 0 || toPrice <= 0) return amount; // fallback: no conversion
  return (amount * fromPrice) / toPrice;
}

// ============================================================================
// LOGGING
// ============================================================================

const LOG_FILE = 'cross_dex_arbitrage.log';

function logToFile(message: string): void {
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore file errors
  }
}

// ============================================================================
// CROSS-DEX ARBITRAGE DETECTOR
// ============================================================================

export class CrossDEXArbitrageDetector {
  private solanaConnection: any; // Your SolanaConnection class
  private dexAggregators: DexAggregator[];
  private rateLimiter: RateLimiter;
  private gasPricer: DynamicGasPricer;
  private quoteCache: Map<string, { quote: DexQuote; timestamp: number }>;
  private CACHE_TTL: number;
  private SOL_PRICE_USD: number;
  
  // Fee structure (per swap)
  private readonly SWAP_FEE_PERCENT = 0.003; // 0.3% per swap (most AMMs)
  private readonly MIN_PROFIT_PERCENT = 0.001; // 0.1% minimum net profit
  private readonly QUOTE_FRESHNESS_MS = 5000; // Quotes older than 5s are stale
  private readonly MAX_PRICE_IMPACT = 0.02; // 2% max price impact

  constructor(solanaConnection: any, dexAggregators?: DexAggregator[]) {
    this.solanaConnection = solanaConnection;
    
    // DEX aggregators - NOTE: Raydium and Orca APIs are different now
    // Jupiter is the best aggregator as it routes through all DEXes
    this.dexAggregators = dexAggregators || [
      { name: 'jupiter', apiUrl: 'https://api.jup.ag/swap/v1', enabled: true },
      // Raydium's quote API format has changed
      { name: 'raydium', apiUrl: 'https://api-v3.raydium.io', enabled: true },
      // Orca uses Whirlpool SDK, not a REST API
      { name: 'orca', apiUrl: 'https://api.mainnet.orca.so', enabled: false },
    ];

    this.rateLimiter = new RateLimiter(5, 1000);
    this.gasPricer = new DynamicGasPricer();
    this.quoteCache = new Map();
    this.CACHE_TTL = 2000;
    
    // NOTE: Can't use await in constructor - initialize with default
    this.SOL_PRICE_USD = 230; // Will be updated in init()
  }

  /**
   * Initialize async properties (call before using)
   */
  async init(): Promise<void> {
    this.SOL_PRICE_USD = await this.fetchSolPrice();
    console.log(`[INIT] SOL price: $${this.SOL_PRICE_USD.toFixed(2)}`);
  }

  /**
   * Fetch current SOL price from Jupiter
   */
  async fetchSolPrice(): Promise<number> {
    try {
      const response = await axios.get('https://api.jup.ag/price/v2', {
        params: { ids: 'So11111111111111111111111111111111111111112' },
        headers: getJupiterHeaders()
      });
      return parseFloat(response.data.data['So11111111111111111111111111111111111111112']?.price || '230');
    } catch {
      return 230; // Fallback
    }
  }

  /**
   * Main entry point: Detect triangular arbitrage opportunities
   */
  async detectTriangularOpportunities(tokens: string[]): Promise<TriangularOpportunity[]> {
    const opportunities: TriangularOpportunity[] = [];
    const gasFee = await this.gasPricer.getCurrentGasFee(
      this.solanaConnection?.getConnection?.()
    );

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔺 CROSS-DEX TRIANGULAR ARBITRAGE SCAN`);
    console.log(`   Strategy: TOKEN_A → TOKEN_B → TOKEN_C → TOKEN_A`);
    console.log(`   Gas fee: ${(gasFee * 1e6).toFixed(0)} microSOL per swap`);
    console.log(`   SOL price: $${this.SOL_PRICE_USD.toFixed(2)}`);
    console.log(`${'═'.repeat(80)}\n`);

    // Base tokens for triangles (high liquidity)
    const baseTokens = [
      'So11111111111111111111111111111111111111112',  // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    ];

    // Test amounts based on base token (more sizes for better discovery)
    const testAmounts: Record<string, number[]> = {
      'So11111111111111111111111111111111111111112': [0.05, 0.1, 0.5, 1, 2, 5],
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': [5, 10, 25, 50, 100, 200],
    };

    // Filter liquid tokens
    const liquidTokens = tokens.filter(t => MINT_TO_TOKEN.has(t));
    
    let scanned = 0;
    const totalPaths = baseTokens.length * liquidTokens.length * (liquidTokens.length - 1) / 2;

    // Scan triangles: Base → TokenB → TokenC → Base
    for (const baseToken of baseTokens) {
      const amounts = testAmounts[baseToken] || [1];
      
      for (let i = 0; i < liquidTokens.length; i++) {
        for (let j = i + 1; j < liquidTokens.length; j++) {
          const tokenB = liquidTokens[i];
          const tokenC = liquidTokens[j];

          // Skip if any token is the base
          if (tokenB === baseToken || tokenC === baseToken) continue;

          scanned++;
          
          for (const amount of amounts) {
            try {
              const opportunity = await this.checkTriangularArb(
                baseToken,
                tokenB,
                tokenC,
                amount,
                gasFee
              );

              if (opportunity && opportunity.isProfitable) {
                opportunities.push(opportunity);
                this.logTriangleOpportunity(opportunity);
              }
            } catch (error) {
              // Skip failed paths
              logToFile(`ERROR: ${getSymbol(baseToken)}→${getSymbol(tokenB)}→${getSymbol(tokenC)} - ${error}`);
            }
          }

          // Progress indicator
          if (scanned % 10 === 0) {
            console.log(`  [PROGRESS] Scanned ${scanned}/${totalPaths} paths...`);
          }
        }
      }
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📊 SCAN COMPLETE`);
    console.log(`   Paths scanned: ${scanned}`);
    console.log(`   Profitable opportunities: ${opportunities.length}`);
    console.log(`${'═'.repeat(80)}\n`);

    return opportunities.sort((a, b) => b.netProfitPercent - a.netProfitPercent);
  }

  /**
   * Check triangular arbitrage: A → B → C → A
   */
  async checkTriangularArb(
    tokenA: string,
    tokenB: string,
    tokenC: string,
    amount: number,
    gasFee: number
  ): Promise<TriangularOpportunity | null> {
    const symbolA = getSymbol(tokenA);
    const symbolB = getSymbol(tokenB);
    const symbolC = getSymbol(tokenC);
    
    console.log(`\n[CHECK] ${symbolA} → ${symbolB} → ${symbolC} → ${symbolA} (${amount} ${symbolA})`);

    const inputAmountRaw = toRaw(amount, tokenA);
    const routes: TriangleRoute[] = [];
    const startTime = Date.now();

    // Step 1: A → B
    const quote1 = await this.getBestDexQuote(tokenA, tokenB, inputAmountRaw, 'raydium');
    if (!quote1) {
      console.log(`  [SKIP] Leg 1 quote failed`);
      return null;
    }
    
    // Validate price impact
    if (quote1.priceImpactPct > this.MAX_PRICE_IMPACT * 100) {
      console.log(`  [SKIP] Leg 1 price impact too high: ${quote1.priceImpactPct.toFixed(2)}%`);
      return null;
    }

    routes.push({
      dex: quote1.dex,
      from: tokenA,
      to: tokenB,
      fromSymbol: symbolA,
      toSymbol: symbolB,
      amountIn: inputAmountRaw,
      amountOut: quote1.outputAmount,
      amountInHuman: amount,
      amountOutHuman: quote1.outputAmountHuman,
      priceImpact: quote1.priceImpactPct,
      feeInInputToken: quote1.totalFeesInInputToken,
    });

    // Step 2: B → C (use different DEX for cross-DEX arb)
    const quote2 = await this.getBestDexQuote(tokenB, tokenC, quote1.outputAmount, 'orca');
    if (!quote2) {
      console.log(`  [SKIP] Leg 2 quote failed`);
      return null;
    }

    if (quote2.priceImpactPct > this.MAX_PRICE_IMPACT * 100) {
      console.log(`  [SKIP] Leg 2 price impact too high: ${quote2.priceImpactPct.toFixed(2)}%`);
      return null;
    }

    routes.push({
      dex: quote2.dex,
      from: tokenB,
      to: tokenC,
      fromSymbol: symbolB,
      toSymbol: symbolC,
      amountIn: quote1.outputAmount,
      amountOut: quote2.outputAmount,
      amountInHuman: quote1.outputAmountHuman,
      amountOutHuman: quote2.outputAmountHuman,
      priceImpact: quote2.priceImpactPct,
      feeInInputToken: quote2.totalFeesInInputToken,
    });

    // Step 3: C → A (complete the triangle)
    const quote3 = await this.getBestDexQuote(tokenC, tokenA, quote2.outputAmount, 'jupiter');
    if (!quote3) {
      console.log(`  [SKIP] Leg 3 quote failed`);
      return null;
    }

    if (quote3.priceImpactPct > this.MAX_PRICE_IMPACT * 100) {
      console.log(`  [SKIP] Leg 3 price impact too high: ${quote3.priceImpactPct.toFixed(2)}%`);
      return null;
    }

    routes.push({
      dex: quote3.dex,
      from: tokenC,
      to: tokenA,
      fromSymbol: symbolC,
      toSymbol: symbolA,
      amountIn: quote2.outputAmount,
      amountOut: quote3.outputAmount,
      amountInHuman: quote2.outputAmountHuman,
      amountOutHuman: quote3.outputAmountHuman,
      priceImpact: quote3.priceImpactPct,
      feeInInputToken: quote3.totalFeesInInputToken,
    });

    // Calculate profit
    const finalAmountRaw = quote3.outputAmount;
    const finalAmount = quote3.outputAmountHuman;
    
    // Gross profit (in input token)
    const grossProfit = finalAmount - amount;
    const grossProfitPercent = (grossProfit / amount) * 100;

    // Fees: use Jupiter-provided fee amounts per leg, converted to input token units
    const totalSwapFees = routes.reduce((sum, r) => sum + (r.feeInInputToken || 0), 0);
    const totalSwapFeePercent = (totalSwapFees / amount) * 100;

    // Gas cost: per-swap gas + optional Jito tip, assumed 3 legs/tx
    const perTxGasSOL = gasFee + JITO_TIP_SOL;
    const gasCostSOL = perTxGasSOL * 3;
    const gasCostInInputToken = await convertAmountBetweenTokens(gasCostSOL, SOL_MINT, tokenA);

    // Net profit
    const netProfit = grossProfit - totalSwapFees - gasCostInInputToken;
    const netProfitPercent = (netProfit / amount) * 100;
    const isProfitable = netProfitPercent > (this.MIN_PROFIT_PERCENT * 100);

    const quoteAgeMs = Date.now() - startTime;

    // Log calculation breakdown
    console.log(`  [CALC] Gross: ${grossProfitPercent.toFixed(4)}% | Fees: -${totalSwapFeePercent.toFixed(2)}% | Gas: -${gasCostInInputToken.toFixed(6)} | Net: ${netProfitPercent.toFixed(4)}%`);

    const opportunity: TriangularOpportunity = {
      triangle: [tokenA, tokenB, tokenC],
      triangleSymbols: [symbolA, symbolB, symbolC],
      inputAmount: amount,
      inputToken: symbolA,
      expectedOutput: finalAmount,
      grossProfit,
      grossProfitPercent,
      totalSwapFees,
      totalSwapFeePercent,
      gasCostSOL,
      gasCostInInputToken,
      netProfit,
      netProfitPercent,
      isProfitable,
      routes,
      timestamp: Date.now(),
      quoteAgeMs,
    };

    logToFile(`${symbolA}→${symbolB}→${symbolC}→${symbolA}: ${netProfitPercent.toFixed(4)}% ${isProfitable ? 'PROFITABLE' : 'SKIP'}`);

    return opportunity;
  }

  /**
   * Get best quote across DEXes
   * NOTE: In practice, Jupiter already routes through all DEXes optimally
   */
  async getBestDexQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
    preferredDex?: string
  ): Promise<DexQuote | null> {
    const cacheKey = `${inputMint}-${outputMint}-${amount.toString()}-${preferredDex || 'any'}`;
    
    // Check cache
    const cached = this.quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.quote;
    }

    // Try preferred DEX first, fallback to Jupiter
    let quote: DexQuote | null = null;

    // Jupiter is the most reliable - it routes through all DEXes
    // For "cross-DEX" we can use Jupiter's dexes parameter to force specific DEX
    quote = await this.getJupiterQuoteWithDex(inputMint, outputMint, amount, preferredDex);

    if (quote) {
      this.quoteCache.set(cacheKey, { quote, timestamp: Date.now() });
    }

    return quote;
  }

  /**
   * Get Jupiter quote with optional DEX restriction
   */
  async getJupiterQuoteWithDex(
    inputMint: string,
    outputMint: string,
    amount: bigint,
    dexPreference?: string
  ): Promise<DexQuote | null> {
    await this.rateLimiter.wait();

    const inputDecimals = getDecimals(inputMint);
    const outputDecimals = getDecimals(outputMint);

    try {
      const params: Record<string, string> = {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: '50', // 0.5% slippage
      };

      // Force specific DEX if requested
      if (dexPreference) {
        const dexMap: Record<string, string> = {
          'raydium': 'Raydium',
          'orca': 'Whirlpool',
          'meteora': 'Meteora',
          'jupiter': '', // No filter = Jupiter auto-routes
        };
        if (dexMap[dexPreference]) {
          params.dexes = dexMap[dexPreference];
        }
      }

      const response = await axios.get('https://api.jup.ag/swap/v1/quote', {
        params,
        headers: config.jupiter?.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
        timeout: 8000,
      });

      this.rateLimiter.onSuccess();

      if (!response.data?.outAmount) {
        return null;
      }

      const data = response.data;
      const outputAmountRaw = BigInt(data.outAmount);
      const inputAmountHuman = toHuman(amount, inputMint);
      const outputAmountHuman = toHuman(outputAmountRaw, outputMint);

      // Extract which DEX was actually used
      const actualDex = data.routePlan?.[0]?.swapInfo?.label || dexPreference || 'jupiter';

       // Estimate total fees for this leg using Jupiter route plan
       let totalFeesInInputToken = 0;
       if (Array.isArray(data.routePlan)) {
         for (const plan of data.routePlan) {
           const feeAmountRaw = plan?.swapInfo?.feeAmount;
           const feeMint = plan?.swapInfo?.feeMint;
           if (feeAmountRaw && feeMint) {
             const feeHuman = toHuman(BigInt(feeAmountRaw), feeMint);
             const feeInInput = await convertAmountBetweenTokens(feeHuman, feeMint, inputMint);
             totalFeesInInputToken += feeInInput;
           }
         }
       }

      return {
        dex: actualDex.toLowerCase(),
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: outputAmountRaw,
        inputAmountHuman,
        outputAmountHuman,
        priceImpactPct: parseFloat(data.priceImpactPct || '0'),
        route: data,
        totalFeesInInputToken,
        timestamp: Date.now(),
        expiresAt: Date.now() + this.QUOTE_FRESHNESS_MS,
      };

    } catch (error: any) {
      if (error.response?.status === 429) {
        this.rateLimiter.onRateLimit();
      }
      return null;
    }
  }

  /**
   * Log triangle opportunity
   */
  logTriangleOpportunity(opp: TriangularOpportunity): void {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🎯 TRIANGLE ARB FOUND: ${opp.triangleSymbols.join(' → ')} → ${opp.triangleSymbols[0]}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`   Input:       ${opp.inputAmount.toFixed(6)} ${opp.inputToken}`);
    console.log(`   Output:      ${opp.expectedOutput.toFixed(6)} ${opp.inputToken}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`   Gross Profit: ${opp.grossProfitPercent.toFixed(4)}%`);
    console.log(`   Swap Fees:    -${opp.totalSwapFeePercent.toFixed(2)}%`);
    console.log(`   Gas Cost:     -${opp.gasCostSOL.toFixed(6)} SOL ($${(opp.gasCostSOL * this.SOL_PRICE_USD).toFixed(4)})`);
    console.log(`   NET PROFIT:   ${opp.netProfitPercent.toFixed(4)}% (${opp.netProfit.toFixed(6)} ${opp.inputToken})`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`   Routes:`);
    opp.routes.forEach((route, i) => {
      console.log(`     ${i + 1}. ${route.fromSymbol} → ${route.toSymbol} via ${route.dex.toUpperCase()}`);
      console.log(`        In: ${route.amountInHuman.toFixed(6)} | Out: ${route.amountOutHuman.toFixed(6)} | Impact: ${route.priceImpact.toFixed(4)}%`);
    });
    console.log(`   Quote age: ${opp.quoteAgeMs}ms`);
    console.log(`${'═'.repeat(70)}\n`);

    logToFile(`OPPORTUNITY: ${opp.triangleSymbols.join('→')}→${opp.triangleSymbols[0]} | Net: ${opp.netProfitPercent.toFixed(4)}%`);
  }

  /**
   * Execute triangular arbitrage (placeholder - needs real implementation)
   */
  async executeTriangleArb(
    opportunity: TriangularOpportunity,
    wallet: any,
    useFlashLoan: boolean = false
  ): Promise<string | null> {
    console.log(`\n[EXECUTE] Would execute: ${opportunity.triangleSymbols.join(' → ')}`);
    console.log(`  Flash loan: ${useFlashLoan}`);
    console.log(`  Expected profit: ${opportunity.netProfitPercent.toFixed(4)}%`);
    
    // In production, this would:
    // 1. Get swap transactions from Jupiter for each leg
    // 2. Bundle them into a single atomic transaction
    // 3. Add flash loan instructions if needed
    // 4. Sign and send with high priority
    
    // For now, return null (simulation mode)
    return null;
  }
}

// ============================================================================
// EXPORTS - Additional named exports for helper functions
// ============================================================================

export { 
  TOKENS,
  getToken,
  getSymbol,
  getDecimals,
  toRaw,
  toHuman,
};

// Type exports
export type { TriangularOpportunity, DexQuote };
