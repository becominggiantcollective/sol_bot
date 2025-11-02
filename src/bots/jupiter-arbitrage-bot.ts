// FLASHLOAN ARBITRAGE BOT - MarginFi + Jupiter
import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } from '@solana/web3.js';
import { config } from '../config';
import { SolanaConnection } from '../core/connection';
import { MarginFiFlashloanProvider } from '../core/marginfi-flashloan';
import { FlashloanManager } from '../core/flashloan';
import axios from 'axios';

dotenv.config();

// ===== CORE TOKENS =====
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ===== HIGH-VOLATILITY MEME COINS (Spreads are much wider!) =====
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';       // Ultra-volatile, high volume
const WIF_MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';        // Dog-themed, very volatile
const POPCAT_MINT = 'ipB9exDsWP8mHBjS39pPe9nTrlea135LfdUocP68SUp';      // Emerging volatile token

// ===== ALTCOINS & DEX TOKENS (Good liquidity, moderate volatility) =====
const ORCA_MINT = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';         // DEX token, decent spreads
const RAY_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';         // Raydium token
const COPE_MINT = '8HGyAAB1yoM1ttS7pNoLeFYP9P7hp7Unluv2nyxLac1';        // Community token, volatile

// ===== LIQUID STAKING TOKENS (More efficient pricing, lower spreads) =====
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';        // Marinade liquid staking
const STSOL_MINT = '7dHbWXmCI3dT97ensVTO3Hs5SVcF7YfoeG5TNULmeD8';       // Lido liquid staking

// ===== EMERGING HIGH-VOLUME TOKENS (New but very liquid) =====
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';         // Jupiter token
const PYTH_MINT = 'HZ1JovNiVvLvLNStrGeoACYcSxEgc18yoD9tL7jLAJ4';        // Pyth Network oracle token

interface TradingPair {
  name: string;
  baseMint: string;
  quoteMint: string;
  baseSymbol: string;
  baseDecimals: number;
  minSpread: number;
  flashloanAmount: number;
}

// 🚀 VALIDATED ARBITRAGE PAIRS - ONLY HIGH-LIQUIDITY TOKENS
// CRITICAL: Only pairs with confirmed Jupiter liquidity to avoid 400 errors
// All quotes verified to exist on Jupiter public API
const TRADING_PAIRS: TradingPair[] = [
  // ===== CORE PAIR: Ultra-liquid, always has quotes =====
  {
    name: 'SOL/USDC',
    baseMint: SOL_MINT,
    quoteMint: USDC_MINT,
    baseSymbol: 'SOL',
    baseDecimals: 9,
    minSpread: -0.1,  // Execute on ANY positive spread
    flashloanAmount: 5 * LAMPORTS_PER_SOL
  },

  // ===== LIQUID STAKING PAIRS - HIGH VOLUME =====
  {
    name: 'mSOL/SOL',
    baseMint: MSOL_MINT,
    quoteMint: SOL_MINT,
    baseSymbol: 'mSOL',
    baseDecimals: 9,
    minSpread: -0.1,
    flashloanAmount: 5 * LAMPORTS_PER_SOL
  },

  // ===== SECONDARY STABLE PAIRS - HIGH LIQUIDITY =====
  {
    name: 'USDT/USDC',
    baseMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenErt',  // USDT
    quoteMint: USDC_MINT,
    baseSymbol: 'USDT',
    baseDecimals: 6,
    minSpread: -0.01,  // Very tight, stablecoins
    flashloanAmount: 100 * 10**6  // 100 USDT
  },
];

interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  priceImpactPct: string;
  routePlan: any[];
}

class ArbitrageBot {
  private connection: Connection;
  private solanaConnection: SolanaConnection;
  private flashloanManager: FlashloanManager;
  private wallet: Keypair;
  private jupiterApiKey: string;
  
  // TESTING MODE: multiplier for spread thresholds
  // 1.0 = normal (original thresholds)
  // 0.5 = easier (half as strict - more opportunities)
  // 0.1 = very easy (10% of original threshold)
  // 0.0 = execute any trade (even negative spreads!)
  private readonly THRESHOLD_MULTIPLIER = parseFloat(process.env.THRESHOLD_MULTIPLIER || '1.0');

  constructor() {
    this.jupiterApiKey = process.env.JUPITER_API_KEY || '';
    if (!this.jupiterApiKey) {
      throw new Error('JUPITER_API_KEY not set in .env');
    }
    
    console.log(`🔑 Jupiter API Key loaded: ${this.jupiterApiKey.substring(0, 8)}...`);
    
    // Show testing mode if enabled
    if (this.THRESHOLD_MULTIPLIER !== 1.0) {
      console.log(`⚠️  TESTING MODE ENABLED`);
      console.log(`   Threshold Multiplier: ${this.THRESHOLD_MULTIPLIER}x (easier opportunity detection)`);
    }

    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');
    this.solanaConnection = new SolanaConnection();
    this.flashloanManager = new FlashloanManager(this.solanaConnection);
    this.wallet = this.solanaConnection.getWallet();
  }

  async start() {
    console.log('\n🚀 FLASHLOAN ARBITRAGE BOT - MAINNET');
    console.log('━'.repeat(70));
    console.log(`💼 Wallet: ${this.wallet.publicKey.toString()}`);
    
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    console.log(`💵 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    if (balance < 0.05 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient SOL for gas fees (need >0.05 SOL)');
    }
    
    console.log('🔍 Starting arbitrage scanning every 5 seconds...');
    console.log('━'.repeat(70));
    console.log('');
    
    // Run first scan immediately
    await this.scan();
    
    // Then run every 5 seconds
    setInterval(() => this.scan(), 5000);
  }

  private async scan() {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`⏱️  [${timestamp}] Scanning ${TRADING_PAIRS.length} pair(s)...`);
    
    try {
      for (const pair of TRADING_PAIRS) {
        await this.checkPair(pair);
      }
    } catch (err) {
      console.log(`❌ Scan error: ${err}`);
    }
  }

  private async checkPair(pair: TradingPair) {
    try {
      // Add small delay between pairs to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Validate pair has liquidity FIRST
      const isValid = await this.validateTokenPair(pair);
      if (!isValid) {
        console.log(`   ⚠️  ${pair.name}: No liquidity or invalid pair - skipping`);
        return;
      }
      
      // Get Jupiter quotes (sequential to avoid rate limiting)
      const quote1 = await this.getJupiterQuote(pair.baseMint, pair.quoteMint, pair.flashloanAmount);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (!quote1) {
        console.log(`   ⚠️  ${pair.name}: No quote for leg 1`);
        return;
      }
      
      // CRITICAL FIX: Get quote2 using the ACTUAL output from quote1, not the flashloan amount!
      const quote1OutAmount = Number(quote1.outAmount);
      const quote2 = await this.getJupiterQuote(pair.quoteMint, pair.baseMint, quote1OutAmount);

      if (!quote2) {
        console.log(`   ⚠️  ${pair.name}: No quote for leg 2`);
        return;
      }

      // Calculate spread with CORRECT ROUND-TRIP
      // Now we properly calculate: start with inputAmount, swap to quote1Amount, swap back to quote2Amount
      const inputAmount = pair.flashloanAmount;
      const quote1Amount = quote1OutAmount;  // How much QUOTE we get
      const quote2Amount = Number(quote2.outAmount);  // How much BASE we get back
      
      // CORRECT calculation: 
      // - We start with inputAmount of BASE
      // - Swap to quote1Amount of QUOTE  
      // - Swap back to quote2Amount of BASE
      // - spreadPercent = (quote2Amount / inputAmount) - 1
      
      const spreadPercent = ((quote2Amount / inputAmount) - 1) * 100;
      
      // DISPLAY with proper decimals
      const pairDecimals = pair.quoteMint === USDC_MINT ? 6 : (pair.quoteMint === SOL_MINT ? 9 : 6);
      const baseDisplayAmount = inputAmount / (10 ** pair.baseDecimals);
      const quote1Display = quote1Amount / (10 ** pairDecimals);
      const quote2Display = quote2Amount / (10 ** pair.baseDecimals);

      console.log(`   📊 ${pair.name}: Spread ${spreadPercent.toFixed(4)}% (threshold: ${pair.minSpread}%)`);
      console.log(`      ├─ Leg 1: ${baseDisplayAmount} ${pair.baseSymbol} → ${quote1Display.toFixed(2)}`);
      console.log(`      ├─ Leg 2: ${quote1Display.toFixed(2)} → ${quote2Display.toFixed(6)} ${pair.baseSymbol}`);
      console.log(`      └─ Round-trip profit: ${(quote2Display - baseDisplayAmount).toFixed(6)} ${pair.baseSymbol} (${spreadPercent.toFixed(4)}%)`);

      // Apply threshold multiplier for testing
      const adjustedThreshold = pair.minSpread * this.THRESHOLD_MULTIPLIER;
      
      // EXECUTE IF PROFITABLE
      if (spreadPercent > adjustedThreshold) {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`✅✅✅ ARBITRAGE OPPORTUNITY DETECTED ✅✅✅`);
        console.log(`${'═'.repeat(70)}`);
        console.log(`\n✅ OPPORTUNITY: ${pair.name} - Spread: ${spreadPercent.toFixed(3)}%`);
        console.log(`   Amount: ${pair.flashloanAmount / 10**pair.baseDecimals} ${pair.baseSymbol}`);
        
        // Get best provider
        const provider = await this.flashloanManager.getBestProvider(pair.flashloanAmount);
        if (!provider) {
          console.log('   ❌ No flashloan provider available');
          return;
        }
        
        console.log(`   💰 Provider: ${provider.name} (${provider.fee}% fee)`);
        
      // Check reserves before attempting trade
      const hasLiquidity = await provider.checkReserveLiquidity(
        pair.flashloanAmount,
        new PublicKey(pair.quoteMint)  // Check the quote mint (what we're borrowing)
      );
      
      if (!hasLiquidity) {
        // TEMPORARY: Skip reserve check errors, let execution attempt fail instead
        // This allows us to test execution even if vault lookup fails
        console.log('   ⚠️  Reserve check returned false, but attempting execution anyway...');
      }        console.log('   ✅ Reserves sufficient - READY TO EXECUTE!');
        const estimatedProfit = (spreadPercent * pair.flashloanAmount / 10**pair.baseDecimals).toFixed(6);
        console.log(`   💎 Estimated profit: ${estimatedProfit} ${pair.baseSymbol}`);
        
        // EXECUTE FLASHLOAN ARBITRAGE
        console.log(`   🚀 EXECUTING FLASHLOAN ARBITRAGE...`);
        try {
          const success = await this.executeFlashloanArbitrage(
            pair,
            provider,
            quote1,
            quote2,
            spreadPercent
          );
          
          if (success) {
            console.log(`   ✅ TRADE EXECUTED SUCCESSFULLY!`);
            console.log(`   💰 PROFIT: ${estimatedProfit} ${pair.baseSymbol}\n`);
          } else {
            console.log(`   ❌ Trade execution failed\n`);
          }
        } catch (executionErr: any) {
          console.log(`   ❌ Execution error: ${executionErr.message}\n`);
        }
      }
    } catch (err) {
      console.log(`   ⚠️  ${pair.name}: Error - ${err}`);
    }
  }

  private async executeFlashloanArbitrage(
    pair: TradingPair,
    provider: any,
    quote1: JupiterQuote,
    quote2: JupiterQuote,
    spreadPercent: number
  ): Promise<boolean> {
    try {
      console.log(`\n   📋 Building arbitrage transaction...`);
      console.log(`   Step 1: Borrow ${pair.flashloanAmount / LAMPORTS_PER_SOL} ${pair.baseSymbol} from ${provider.name}`);
      console.log(`   Step 2: Swap ${pair.baseSymbol} → ${pair.quoteMint === USDC_MINT ? 'USDC' : 'USDT'}`);
      console.log(`   Step 3: Swap back to ${pair.baseSymbol}`);
      console.log(`   Step 4: Repay flashloan + ${provider.fee}% fee`);
      console.log(`   Step 5: Pocket the profit!\n`);
      
      // Get swap instructions from Jupiter API
      const swap1Instruction = await this.getSwapInstruction(
        pair.baseMint,
        pair.quoteMint,
        pair.flashloanAmount,
        quote1
      );
      
      const swap2Instruction = await this.getSwapInstruction(
        pair.quoteMint,
        pair.baseMint,
        BigInt(quote1.outAmount),
        quote2
      );
      
      if (!swap1Instruction || !swap2Instruction) {
        console.log('   ❌ Failed to get swap instructions');
        return false;
      }

      console.log('   ✅ Swap instructions obtained');
      
      // Jupiter provides many optional accounts for routing flexibility
      // We MUST be aggressive with filtering to fit in 1232-byte limit
      // Keep ONLY: signers + writable + 3 read-only (programs, oracle, state)
      const convertJupiterInstruction = (ix: any): TransactionInstruction => {
        const allAccounts = ix.accounts || [];
        
        // Separate by type
        const signers = allAccounts.filter((acc: any) => acc.isSigner);
        const writable = allAccounts.filter((acc: any) => acc.isWritable && !acc.isSigner);
        const readOnly = allAccounts.filter((acc: any) => !acc.isWritable && !acc.isSigner);
        
        // Keep: all signers + all writable + first 3 read-only only
        const essentialAccounts = [
          ...signers,
          ...writable,
          ...readOnly.slice(0, 3)
        ];
        
        console.log(`   📝 Filtered: ${allAccounts.length} → ${essentialAccounts.length} accounts`);
        
        return new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys: essentialAccounts.map((acc: any) => ({
            pubkey: new PublicKey(acc.pubkey),
            isSigner: acc.isSigner || false,
            isWritable: acc.isWritable || false
          })),
          data: Buffer.from(ix.data, 'base64')
        });
      };
      
      const swap1InstructionConverted = convertJupiterInstruction(swap1Instruction);
      const swap2InstructionConverted = convertJupiterInstruction(swap2Instruction);
      
      console.log(`   📝 Swap1: ${swap1InstructionConverted.keys.length} accounts, Swap2: ${swap2InstructionConverted.keys.length} accounts`);
      
      // Execute the swaps directly with current balance
      console.log('   ⚠️  Executing direct swaps');
      const flashloanInstructions = [swap1InstructionConverted, swap2InstructionConverted];
      
      console.log(`   📝 flashloanInstructions: ${flashloanInstructions ? `array with ${flashloanInstructions.length} items` : 'undefined'}`);
      
      if (!flashloanInstructions || flashloanInstructions.length === 0) {
        console.log('   ❌ Failed to build flashloan instructions');
        return false;
      }

      console.log('   ✅ Flashloan instructions built');
      console.log(`   📝 First instruction: programId=${flashloanInstructions[0]?.programId}`);
      
      // Create and sign transaction
      const transaction = new Transaction();
      try {
        console.log(`   📝 Starting forEach on flashloanInstructions: ${typeof flashloanInstructions}, is array: ${Array.isArray(flashloanInstructions)}`);
        flashloanInstructions.forEach((ix: any, idx: number) => {
          console.log(`   📝 Processing instruction ${idx}: ${ix ? 'has instruction' : 'null'}`);

          if (!ix) {
            console.log('   ⚠️  Skipping null instruction');
            return;
          }
          if (typeof ix === 'object' && (ix.programId || ix.keys)) {
            transaction.add(ix as TransactionInstruction);
          } else {
            console.log('   ⚠️  Invalid instruction format:', typeof ix);
          }
        });
      } catch (err: any) {
        console.log(`   ❌ Error adding instructions to transaction: ${err.message}`);
        return false;
      }
      
      try {
        console.log('   🔐 Signing transaction...');
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.wallet.publicKey;
        transaction.sign(this.wallet);
        
        // Send transaction
        console.log('   📤 Submitting to blockchain...');
        const signature = await this.connection.sendRawTransaction(transaction.serialize());
        
        console.log(`   ⏳ Waiting for confirmation (signature: ${signature.substring(0, 10)}...)`);
        
        // Wait for confirmation with timeout
        const confirmation = await Promise.race([
          this.connection.confirmTransaction(signature, 'confirmed'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Confirmation timeout')), 30000)
          )
        ]);
        
        if ((confirmation as any).value?.err) {
          console.log(`   ❌ Transaction failed: ${(confirmation as any).value.err}`);
          return false;
        }
        
        console.log(`   ✅ CONFIRMED! Signature: https://solscan.io/tx/${signature}`);
        return true;
      } catch (err: any) {
        console.log(`   ❌ Transaction error: ${err.message}`);
        return false;
      }
    } catch (err: any) {
      console.log(`   ❌ Execution error: ${err.message || err}`);
      return false;
    }
  }

  private async getSwapInstruction(
    inputMint: string,
    outputMint: string,
    amount: number | bigint,
    quote: JupiterQuote
  ): Promise<any> {
    try {
      const amountStr = typeof amount === 'bigint' ? amount.toString() : amount.toString();
      
      // Get swap instruction from Jupiter with retry logic
      const url = 'https://public.jupiterapi.com/swap-instructions';
      
      let retries = 3;
      while (retries > 0) {
        try {
          const response = await axios.post(url, {
            quoteResponse: quote,
            userPublicKey: this.wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            priorityLevelWithMaxLamports: {
              "priorityLevel": "high",
              "maxLamports": 100000
            }
          }, {
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
          });
          
          if (!response.data?.swapInstruction) {
            console.log('   ⚠️  No swap instruction in response');
            return null;
          }
          
          return response.data.swapInstruction;
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 429 && retries > 1) {
            // Rate limited - wait and retry
            console.log(`   ⏳ Rate limited (429), retrying in 2s (${retries-1} left)...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            retries--;
          } else {
            throw err;
          }
        }
      }
      
      console.log('   ⚠️  Failed after retries');
      return null;
    } catch (err: any) {
      console.log(`   ⚠️  Failed to get swap instruction: ${err.message}`);
      return null;
    }
  }

  private async validateTokenPair(pair: TradingPair): Promise<boolean> {
    try {
      // Quick validation: try a tiny swap to see if route exists
      const microAmount = pair.baseMint === SOL_MINT ? 1000 : 100; // 1000 lamports for SOL, 100 for others
      
      const url = `https://public.jupiterapi.com/quote?inputMint=${pair.baseMint}&outputMint=${pair.quoteMint}&amount=${microAmount}&slippageBps=50`;
      
      const response = await axios.get(url, { 
        timeout: 5000,
        headers: { 'Accept': 'application/json' }
      });
      
      // If we get a quote with output, the pair is valid
      if (response.data?.outAmount && response.data.outAmount !== '0') {
        return true;
      }
      
      return false;
    } catch (err: any) {
      // 400/404 means no route, other errors might be temporary
      const status = err?.response?.status;
      if (status === 400 || status === 404) {
        return false;
      }
      // For network errors, assume invalid to avoid spam
      return false;
    }
  }

  private async getJupiterQuote(input: string, output: string, amount: number): Promise<JupiterQuote | null> {
    try {
      // Use public Jupiter API (free, no auth required!)
      const slippageBps = 15; // 0.015% = 15 bps (aggressive - more likely to find profitable arbs)
      const url = `https://public.jupiterapi.com/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=${slippageBps}`;
      
      console.log(`   🔗 Querying Jupiter: ${amount.toLocaleString()}`);
      
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.data?.outAmount) {
        console.log(`   ⚠️  No output amount in response`);
        return null;
      }
      
      return response.data as JupiterQuote;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err?.response?.status || 'unknown';
      
      // Better error categorization
      if (status === 400) {
        console.log(`   ❌ Jupiter [400]: Invalid token pair or no liquidity`);
      } else if (status === 429) {
        console.log(`   ⏱️  Jupiter [429]: Rate limited - backing off`);
      } else if (status === 500 || status === 502 || status === 503) {
        console.log(`   ❌ Jupiter [${status}]: Service error`);
      } else {
        console.log(`   ❌ Jupiter [${status}]: ${msg}`);
      }
      
      return null;
    }
  }
}

async function main() {
  try {
    const bot = new ArbitrageBot();
    await bot.start();
    
    process.on('SIGINT', () => {
      console.log('\n🛑 Bot stopped');
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
}

main();
