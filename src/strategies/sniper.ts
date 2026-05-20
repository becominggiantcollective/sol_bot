import axios from 'axios';
import { scoreTokenFromMessages } from '../ml/sentimentClient.js';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { isValidPublicKey } from '../utils/index.js';
import { loadEnvKeypair } from '../core/wallet.js';
import { sanitizeIdentifier, sanitizeTextInput } from '../utils/security.js';

/**
 * NEW TOKEN SNIPER
 * 
 * Strategy: Monitor for brand new tokens that just launched on pump.fun
 * and catch the initial price movement when they migrate to Raydium.
 * 
 * Why this works with small capital:
 * 1. New tokens have 5-50%+ price swings in first minutes
 * 2. Low liquidity means your small trade can still profit
 * 3. No flash loan fees needed - direct wallet trades
 * 4. Gas is same whether you trade $8 or $800
 * 
 * Risk: High - new tokens are volatile and can rug
 * Reward: Also high - 10-50% gains possible on good entries
 */

interface NewToken {
  address: string;
  name: string;
  symbol: string;
  createdAt: Date;
  initialPrice: number;
  currentPrice: number;
  priceChange: number;
  volume: number;
  liquidity: number;
  dex: string;
}

export class NewTokenSniper {
  private connection: Connection;
  private wallet: Keypair;
  private readonly GECKO_API = 'https://api.geckoterminal.com/api/v2';
  private readonly JUPITER_API = config.jupiter?.apiUrl || 'https://api.jup.ag/swap/v1';
  private readonly MIN_LIQUIDITY = 1000;  // $1k min liquidity (YOLO mode)
  private readonly MAX_TRADE_SOL = 0.002; // TINY trades - 0.002 SOL (~$0.50) each
  private readonly TAKE_PROFIT = 0.30;    // 30% profit target (smaller position = need bigger %)
  private readonly STOP_LOSS = -0.30;     // 30% stop loss
  private readonly MIN_MOMENTUM = 0;      // NO FILTER - catch all movement
  private seenTokens = new Set<string>();
  private positions = new Map<string, { entry: number; amount: number; token: string }>();
  
  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

    if (config.wallet.provider === 'hardware') {
      throw new Error(
        'NewTokenSniper requires local signing and does not support hardware wallet mode in-process.'
      );
    }
    this.wallet = loadEnvKeypair(config.wallet.privateKey);
  }
  
  /**
   * Main loop - watch for new tokens and snipe opportunities
   */
  async run(): Promise<void> {
    console.log('🎯 NEW TOKEN SNIPER STARTED');
    console.log(`   Max trade: ${this.MAX_TRADE_SOL} SOL (~$${(this.MAX_TRADE_SOL * 230).toFixed(0)})`);
    console.log(`   Take profit: ${this.TAKE_PROFIT * 100}%`);
    console.log(`   Stop loss: ${this.STOP_LOSS * 100}%`);
    console.log('');
    
    while (true) {
      try {
        // Check wallet balance
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        const solBalance = balance / 1e9;
        
        if (solBalance < 0.003) {
          console.log(`⚠️ Low balance: ${solBalance.toFixed(4)} SOL - need 0.003 min`);
          await this.sleep(30000);
          continue;
        }
        
        // Scan for new tokens
        const newTokens = await this.scanNewTokens();
        
        for (const token of newTokens) {
          // Skip if already seen
          if (this.seenTokens.has(token.address)) continue;
          this.seenTokens.add(token.address);
          
          // Analyze opportunity (includes sentiment if available)
          const score = await this.scoreOpportunity(token);
          
          if (score >= 50) {
            console.log(`\n🚀 TOKEN FOUND: ${token.symbol}`);
            console.log(`   Price change: ${token.priceChange > 0 ? '+' : ''}${token.priceChange.toFixed(1)}%`);
            console.log(`   Liquidity: $${token.liquidity.toLocaleString()}`);
            console.log(`   Score: ${score}/100 [YOLO MODE]`);
            
            // Try to enter position
            if (this.positions.size < 2) { // Max 2 positions at once
              await this.enterPosition(token, solBalance);
            }
          }
        }
        
        // Check existing positions for exit
        await this.checkPositions();
        
        // Rate limit - check every 15 seconds
        await this.sleep(15000);
        
      } catch (error) {
        console.error('Sniper error:', error);
        await this.sleep(10000);
      }
    }
  }
  
  /**
   * Scan GeckoTerminal for new tokens
   */
  private async scanNewTokens(): Promise<NewToken[]> {
    try {
      const response = await axios.get(`${this.GECKO_API}/networks/solana/new_pools`, {
        params: { page: 1 },
        timeout: 10000,
      });
      
      const pools = response.data?.data || [];
      const tokens: NewToken[] = [];
      
      for (const pool of pools) {
        const attrs = pool.attributes || {};
        const rels = pool.relationships || {};
        
        const liquidity = parseFloat(attrs.reserve_in_usd || '0');
        const volume = parseFloat(attrs.volume_usd?.h24 || '0');
        const priceChange = parseFloat(attrs.price_change_percentage?.h24 || '0');
        const baseTokenName = sanitizeTextInput(attrs.name?.split('/')[0] || 'Unknown', 64);
        const baseTokenSymbol = sanitizeIdentifier(attrs.name?.split('/')[0] || '?', 16);
        
        // Filter criteria
        if (liquidity < this.MIN_LIQUIDITY) continue;
        if (volume < 100) continue; // Lowered volume requirement
        
        const token: NewToken = {
          address: rels.base_token?.data?.id?.replace('solana_', '') || '',
          name: baseTokenName,
          symbol: baseTokenSymbol,
          createdAt: new Date(attrs.pool_created_at || Date.now()),
          initialPrice: 0,
          currentPrice: parseFloat(attrs.base_token_price_usd || '0'),
          priceChange,
          volume,
          liquidity,
          dex: rels.dex?.data?.id || 'unknown',
        };
        
        if (token.address && isValidPublicKey(token.address)) {
          tokens.push(token);
        }
      }
      
      return tokens;
    } catch {
      return [];
    }
  }
  
  /**
   * Score a token opportunity (0-100)
   */
  private async scoreOpportunity(token: NewToken): Promise<number> {
    // YOLO MODE: Score all tokens, no momentum filter
    let score = 50; // Base score
    
    // Small bonus for any positive momentum
    if (token.priceChange > 0) score += 5;
    
    // Age bonus - newer is better (pump.fun tokens)
    const ageMinutes = (Date.now() - token.createdAt.getTime()) / 60000;
    if (ageMinutes < 5) score += 25;      // Very new - highest priority
    else if (ageMinutes < 15) score += 15; // Pretty new
    else if (ageMinutes < 30) score += 5;  // Still okay
    else score -= 15; // Getting old - probably missed the pump
    
    // Price movement - look for STRONG momentum only
    if (token.priceChange > 200) score += 20;     // Mooning hard
    else if (token.priceChange > 100) score += 15; // Strong pump
    else if (token.priceChange > 50) score += 10;  // Good momentum
    
    // Volume relative to liquidity (activity indicator)
    const turnover = token.volume / token.liquidity;
    if (turnover > 2) score += 10;  // Very active
    else if (turnover > 0.5) score += 5;
    
    // Liquidity sweet spot
    if (token.liquidity >= 5000 && token.liquidity <= 50000) score += 10;
    else if (token.liquidity > 100000) score -= 5; // Too established
    
    // DEX preference
    if (token.dex === 'raydium' || token.dex === 'meteora-damm-v2') score += 5;
    if (token.dex === 'pump-fun') score += 10; // Early pump.fun = opportunity

    // Sentiment boost (call the sentiment service if available)
    try {
      // craft a few short messages about the token for quick sentiment check
      const texts = [
        sanitizeTextInput(`${token.name} token just launched on ${token.dex}`, 180),
        sanitizeTextInput(`${token.symbol} price movement ${token.priceChange}%`, 180),
        sanitizeTextInput(`${token.name} liquidity ${token.liquidity}`, 180),
      ];

      const s = await scoreTokenFromMessages(token.address || token.symbol, texts);
      if (s && typeof s.score === 'number') {
        // s.score is roughly in -1..1
        if (s.score >= 0.6) {
          score += 20; // strong positive sentiment
        } else if (s.score >= 0.25) {
          score += 10; // positive
        } else if (s.score <= -0.5) {
          score -= 15; // strong negative - penalize
        }
      }
    } catch {
      // sentiment service failed — ignore and proceed
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  /**
   * Enter a position on a token
   */
  private async enterPosition(token: NewToken, balance: number): Promise<void> {
    // YOLO: Use 80% of balance, keep tiny gas reserve
    const tradeSize = Math.min(this.MAX_TRADE_SOL, balance - 0.002);
    
    if (tradeSize < 0.001) {
      console.log(`   ⚠️ Insufficient balance (need 0.003+ SOL)`);
      return;
    }
    
    console.log(`   📈 Entering position: ${tradeSize.toFixed(4)} SOL`);
    
    try {
      // Get quote from Jupiter
      const SOL = 'So11111111111111111111111111111111111111112';
      if (!isValidPublicKey(token.address)) {
        console.log(`   ❌ Invalid token address: ${token.address}`);
        return;
      }
      const amountLamports = Math.floor(tradeSize * 1e9);
      
      const quoteResponse = await axios.get(`${this.JUPITER_API}/quote`, {
        params: {
          inputMint: SOL,
          outputMint: token.address,
          amount: amountLamports,
          slippageBps: 1500, // 15% slippage for meme coins
        },
        headers: config.jupiter?.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
        timeout: 10000,
      });
      
      if (!quoteResponse.data?.outAmount) {
        console.log(`   ❌ No quote available`);
        return;
      }
      
      const outAmount = parseInt(quoteResponse.data.outAmount);
      const priceImpact = parseFloat(quoteResponse.data.priceImpactPct || '0');
      
      if (priceImpact > 5) {
        console.log(`   ⚠️ Price impact too high: ${priceImpact.toFixed(2)}%`);
        return;
      }
      
      // Execute swap
      const swapResponse = await axios.post(`${this.JUPITER_API}/swap`, {
        quoteResponse: quoteResponse.data,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000, // ~0.00005 SOL priority fee
      }, {
        headers: config.jupiter?.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
        timeout: 15000,
      });
      
      if (!swapResponse.data?.swapTransaction) {
        console.log(`   ❌ Failed to get swap transaction`);
        return;
      }
      
      // Deserialize and sign
      const swapTxBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(swapTxBuf);
      tx.sign([this.wallet]);
      
      // Send transaction
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      
      console.log(`   ✅ BOUGHT! TX: ${signature.slice(0, 20)}...`);
      console.log(`   💰 Got ~${(outAmount / 1e6).toFixed(2)} ${token.symbol}`);
      
      // Record position
      this.positions.set(token.address, {
        entry: token.currentPrice,
        amount: outAmount,
        token: token.symbol,
      });
      
    } catch (error: any) {
      console.log(`   ❌ Trade failed: ${error.message?.slice(0, 50)}`);
    }
  }
  
  /**
   * Check positions for exit (take profit or stop loss)
   */
  private async checkPositions(): Promise<void> {
    for (const [address, position] of this.positions) {
      try {
        // Get current price
        const response = await axios.get(`${this.GECKO_API}/networks/solana/tokens/${address}`, {
          timeout: 5000,
        });
        
        const currentPrice = parseFloat(response.data?.data?.attributes?.price_usd || '0');
        if (currentPrice === 0) continue;
        
        const pnlPercent = (currentPrice - position.entry) / position.entry;
        
        // Check exit conditions
        if (pnlPercent >= this.TAKE_PROFIT) {
          console.log(`\n🎉 TAKE PROFIT: ${position.token} +${(pnlPercent * 100).toFixed(1)}%`);
          await this.exitPosition(address, position);
        } else if (pnlPercent <= this.STOP_LOSS) {
          console.log(`\n🛑 STOP LOSS: ${position.token} ${(pnlPercent * 100).toFixed(1)}%`);
          await this.exitPosition(address, position);
        } else {
          console.log(`   📊 ${position.token}: ${pnlPercent > 0 ? '+' : ''}${(pnlPercent * 100).toFixed(1)}%`);
        }
        
      } catch {
        // Skip on error
      }
    }
  }
  
  /**
   * Exit a position (sell back to SOL)
   */
  private async exitPosition(tokenAddress: string, position: { entry: number; amount: number; token: string }): Promise<void> {
    try {
      const SOL = 'So11111111111111111111111111111111111111112';
      if (!isValidPublicKey(tokenAddress)) {
        console.log(`   ❌ Invalid token address: ${tokenAddress}`);
        return;
      }
      
      // Get quote to sell
      const quoteResponse = await axios.get(`${this.JUPITER_API}/quote`, {
        params: {
          inputMint: tokenAddress,
          outputMint: SOL,
          amount: position.amount,
          slippageBps: 1500, // 15% for meme coins
        },
        headers: config.jupiter?.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
        timeout: 10000,
      });
      
      if (!quoteResponse.data?.outAmount) {
        console.log(`   ❌ No sell quote`);
        return;
      }
      
      // Execute sell
      const swapResponse = await axios.post(`${this.JUPITER_API}/swap`, {
        quoteResponse: quoteResponse.data,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 50000,
      }, {
        headers: config.jupiter?.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
        timeout: 15000,
      });
      
      const swapTxBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(swapTxBuf);
      tx.sign([this.wallet]);
      
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      
      const solReceived = parseInt(quoteResponse.data.outAmount) / 1e9;
      console.log(`   ✅ SOLD! Got ${solReceived.toFixed(4)} SOL`);
      console.log(`   TX: ${signature.slice(0, 20)}...`);
      
      this.positions.delete(tokenAddress);
      
    } catch (error: any) {
      console.log(`   ❌ Sell failed: ${error.message?.slice(0, 50)}`);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export runner function
export async function runSniper(): Promise<void> {
  const sniper = new NewTokenSniper();
  await sniper.run();
}
