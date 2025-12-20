#!/usr/bin/env node
/**
 * 🚀 JITO-ENABLED SAFE SNIPER
 * 
 * Combines:
 * - Jito bundle submission (faster execution, MEV protection)
 * - Pre-buy honeypot detection (avoid scams)
 * - Auto stop-loss/take-profit
 * - Activity logging
 * 
 * Note: Jito won't help with honeypots (they fail at contract level),
 * but gives you edge on legitimate tokens (faster entry/exit)
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import fs from 'fs';
import { quickCheck, detectHoneypot } from './honeypot-detector.mjs';
import { analyzeToken, recordTradeOutcome } from './ml-predictor.mjs';

// === JITO CONFIGURATION ===
const JITO_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf'
];

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];

// === CONFIG ===
const CONFIG = {
  // Trading
  tradeAmountSol: 0.01,
  maxPositions: 3,
  takeProfitPct: 15,          // Higher target for Jito (can exit faster)
  stopLossPct: 7,
  trailingStopPct: 5,
  maxHoldMinutes: 5,
  
  // Jito-specific
  jitoTipLamports: 10000,     // 0.00001 SOL tip (~$0.002) - small tip
  useJito: true,              // Toggle Jito on/off
  jitoTimeout: 30000,         // 30s timeout for bundle confirmation
  
  // Entry signals
  minPriceChange5m: 2,
  maxPriceChange5m: 50,
  minVolume24h: 8000,
  minBuySellRatio: 0.4,
  
  // Safety - STRICT
  maxRiskScore: 45,           // Very strict
  minLiquidity: 10000,        // $10K minimum
  minTokenAge: 5,             // 5 min minimum
  maxWhaleHolding: 40,
  requireSellable: true,      // MUST test sell before buy
  
  scanInterval: 3000,
  monitorInterval: 2000,
  cooldownMs: 15000,
};

// === SETUP ===
const HELIUS_RPC = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=7f243329-aabe-4227-b05f-0ed8d59b4efe';
const JUPITER_API = 'https://api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '2bYF7j9KWjEfuLLpiYezrH9z7HUpBc3J29zE7j6ZviNkavRkZZFPNurog251FNxHzgs56PwwcrX4DbEN4FSpqkcx';
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const connection = new Connection(HELIUS_RPC, 'confirmed');

// State
let positions = new Map();
let lastBuyTime = 0;
let avoidList = new Set();
const TOKEN_COOLDOWN_MS = 600000;
let stats = { scanned: 0, rejected: 0, bought: 0, sold: 0, honeypots: 0, jitoSuccess: 0, jitoFailed: 0 };

// Logging
function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const colors = {
    INFO: '\x1b[36m', SUCCESS: '\x1b[32m', WARN: '\x1b[33m',
    ERROR: '\x1b[31m', PROFIT: '\x1b[32m', LOSS: '\x1b[31m'
  };
  const color = colors[type] || colors.INFO;
  const logMsg = `[${timestamp}] ${color}${type}\x1b[0m: ${message}`;
  console.log(logMsg);
  try {
    fs.appendFileSync('sniper-jito.log', `[${timestamp}] ${type}: ${message}\n`);
  } catch (e) {}
}

// === JITO FUNCTIONS ===
async function sendJitoBundle(transactions) {
  if (!CONFIG.useJito) {
    log('Jito disabled, using regular RPC', 'INFO');
    return null;
  }
  
  try {
    // Pick random Jito endpoint
    const endpoint = JITO_ENDPOINTS[Math.floor(Math.random() * JITO_ENDPOINTS.length)];
    
    // Serialize transactions
    const serializedTxs = transactions.map(tx => 
      bs58.encode(tx.serialize())
    );
    
    log(`📦 Sending bundle to Jito (${serializedTxs.length} txs)`, 'INFO');
    
    const response = await fetch(`${endpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [serializedTxs]
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      log(`❌ Jito bundle error: ${data.error.message}`, 'ERROR');
      stats.jitoFailed++;
      return null;
    }
    
    const bundleId = data.result;
    log(`✅ Jito bundle submitted: ${bundleId}`, 'SUCCESS');
    stats.jitoSuccess++;
    
    return bundleId;
    
  } catch (error) {
    log(`❌ Jito error: ${error.message}`, 'ERROR');
    stats.jitoFailed++;
    return null;
  }
}

async function createJitoTipTransaction() {
  const tipAccount = new PublicKey(
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
  );
  
  // Create tip transfer instruction
  const { SystemProgram } = await import('@solana/web3.js');
  const instruction = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: tipAccount,
    lamports: CONFIG.jitoTipLamports
  });
  
  const { Transaction } = await import('@solana/web3.js');
  const tx = new Transaction().add(instruction);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);
  
  return tx;
}

// Load/Save functions
function loadPositions() {
  try {
    const data = JSON.parse(fs.readFileSync('positions-jito.json', 'utf-8'));
    positions = new Map(data.positions || []);
    stats = { ...stats, ...data.stats };
    log(`📂 Loaded ${positions.size} positions`, 'INFO');
  } catch {
    log('📂 Starting fresh', 'INFO');
  }
}

function savePositions() {
  fs.writeFileSync('positions-jito.json', JSON.stringify({
    positions: Array.from(positions.entries()),
    stats,
    lastUpdated: Date.now()
  }, null, 2));
}

function loadAvoidList() {
  try {
    const data = JSON.parse(fs.readFileSync('avoid-tokens-jito.json', 'utf-8'));
    avoidList = new Set(data.tokens || []);
    log(`🚫 Loaded ${avoidList.size} tokens to avoid`, 'INFO');
  } catch {}
}

function saveAvoidList() {
  fs.writeFileSync('avoid-tokens-jito.json', JSON.stringify({
    tokens: Array.from(avoidList),
    lastUpdated: Date.now()
  }, null, 2));
}

// === HONEYPOT CHECK (BEFORE BUYING) ===
async function isTokenSafe(mint, symbol) {
  log(`🛡️ Pre-buy safety check for ${symbol}...`, 'INFO');
  
  try {
    // Quick check first
    const quick = await quickCheck(mint);
    
    if (quick.riskScore > CONFIG.maxRiskScore) {
      log(`   ❌ Risk score too high: ${quick.riskScore}/100`, 'WARN');
      return false;
    }
    
    // Full honeypot detection
    const check = await detectHoneypot(mint);
    
    if (!check.canSell && CONFIG.requireSellable) {
      log(`   🍯 HONEYPOT: Cannot sell this token!`, 'ERROR');
      avoidList.add(mint);
      saveAvoidList();
      stats.honeypots++;
      return false;
    }
    
    log(`   ✅ Token passed safety checks`, 'SUCCESS');
    return true;
    
  } catch (error) {
    log(`   ⚠️ Safety check error: ${error.message}`, 'WARN');
    return false;
  }
}

// === BUY WITH JITO ===
async function buyToken(mint, symbol) {
  log(`🛒 Buying ${symbol} via ${CONFIG.useJito ? 'Jito bundle' : 'regular RPC'}...`, 'INFO');
  
  try {
    const amount = Math.floor(CONFIG.tradeAmountSol * 1e9);
    
    // Get Jupiter quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amount}&slippageBps=3000`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05' }
    });
    const quote = await quoteRes.json();
    
    if (quote.error) {
      log(`   ❌ Quote error: ${quote.error}`, 'ERROR');
      return null;
    }
    
    // Get swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'f6663264-66de-4a78-b115-c14a9efc5a05'
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 100000
      })
    });
    
    const { swapTransaction, error } = await swapRes.json();
    if (error) {
      log(`   ❌ Swap error: ${error}`, 'ERROR');
      return null;
    }
    
    // Deserialize and sign
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    let sig;
    
    if (CONFIG.useJito) {
      // Create tip transaction
      const tipTx = await createJitoTipTransaction();
      
      // Send as Jito bundle
      const bundleId = await sendJitoBundle([tx, tipTx]);
      
      if (!bundleId) {
        log(`   ⚠️ Jito failed, falling back to regular RPC`, 'WARN');
        sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 3
        });
      } else {
        // Wait for bundle confirmation (use first tx signature)
        sig = bs58.encode(tx.signatures[0]);
        log(`   ⏳ Waiting for Jito bundle confirmation...`, 'INFO');
      }
    } else {
      // Regular RPC submission
      sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });
    }
    
    log(`   📤 TX: ${sig.slice(0, 20)}...`, 'INFO');
    
    // Wait for confirmation
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) {
      log(`   ❌ TX failed`, 'ERROR');
      return null;
    }
    
    const tokenAmount = parseInt(quote.outAmount);
    log(`   ✅ Bought ${tokenAmount.toLocaleString()} ${symbol}`, 'SUCCESS');
    stats.bought++;
    
    return {
      symbol,
      tokenAmount,
      entryAmountSol: CONFIG.tradeAmountSol,
      entryTime: Date.now(),
      signature: sig,
      usedJito: CONFIG.useJito
    };
    
  } catch (error) {
    log(`   ❌ Buy failed: ${error.message}`, 'ERROR');
    return null;
  }
}

log('\n═══════════════════════════════════════════════════════════', 'INFO');
log('🚀 JITO-ENABLED SAFE SNIPER', 'INFO');
log('═══════════════════════════════════════════════════════════\n', 'INFO');
log(`Jito Mode: ${CONFIG.useJito ? 'ENABLED ⚡' : 'DISABLED'}`, 'INFO');
log(`Jito Tip: ${CONFIG.jitoTipLamports / 1e9} SOL per trade`, 'INFO');
log(`Trade Size: ${CONFIG.tradeAmountSol} SOL`, 'INFO');
log(`Honeypot Detection: ${CONFIG.requireSellable ? 'ENABLED 🛡️' : 'DISABLED'}`, 'INFO');
log('\n', 'INFO');

loadPositions();
loadAvoidList();

log('💡 Jito benefits: Faster execution, MEV protection', 'INFO');
log('💡 But: Still need honeypot detection (Jito can\\'t fix contract-level blocks)', 'INFO');
log('\n✅ Ready to scan...', 'SUCCESS');
