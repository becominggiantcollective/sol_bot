#!/usr/bin/env node
/**
 * 🐋 SMART MONEY TRACKER
 *
 * Tracks top performing wallets and monitors their trades in real-time.
 *
 * FEATURES:
 * - Find top wallets by recent profits
 * - Monitor their real-time activity
 * - Alert when they buy new tokens
 * - Copy trade signals (optional)
 *
 * STRATEGY:
 * "If a wallet that made 100x last week is buying a new token,
 *  maybe I should pay attention."
 */

import fetch from 'node-fetch';
import fs from 'fs';
import WebSocket from 'ws';

// === CONFIG ===
const CONFIG = {
  // Helius API
  heliusApiKey: process.env.HELIUS_API_KEY || '7f243329-aabe-4227-b05f-0ed8d59b4efe',
  heliusRpc: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || '7f243329-aabe-4227-b05f-0ed8d59b4efe'}`,
  heliusWs: `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || '7f243329-aabe-4227-b05f-0ed8d59b4efe'}`,

  // Tracking settings
  maxWalletsToTrack: 20,           // Track top 20 wallets
  minProfitToTrack: 10,            // Min 10 SOL profit to consider "top"
  lookbackHours: 24,               // Look at last 24 hours

  // Alert settings
  alertOnBuy: true,
  alertOnSell: false,
  minBuySize: 0.1,                 // Min 0.1 SOL buy to alert

  // Update intervals
  walletUpdateInterval: 300000,    // Update top wallets every 5 min
  activityCheckInterval: 10000,    // Check activity every 10 sec
};

// === STATE ===
const trackedWallets = new Map();  // wallet -> { profit, winRate, lastTrade, trades }
const recentAlerts = [];           // Recent trade alerts
const seenTransactions = new Set();

// === DATA FILES ===
const WALLETS_FILE = 'data/tracked-wallets.json';
const ALERTS_FILE = 'data/smart-money-alerts.json';

// === HELIUS API HELPERS ===

/**
 * Get parsed transaction history for a wallet
 */
async function getWalletHistory(walletAddress, limit = 100) {
  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${CONFIG.heliusApiKey}&limit=${limit}`,
      { timeout: 15000 }
    );

    if (!response.ok) {
      console.log(`   ⚠️ Helius API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data || [];
  } catch (error) {
    console.log(`   ❌ Error fetching wallet history: ${error.message}`);
    return [];
  }
}

/**
 * Analyze wallet's recent trading performance
 */
async function analyzeWalletPerformance(walletAddress) {
  const history = await getWalletHistory(walletAddress, 50);

  if (history.length === 0) {
    return null;
  }

  let totalProfit = 0;
  let wins = 0;
  let losses = 0;
  const tokenTrades = new Map(); // token -> { buys, sells, profit }

  for (const tx of history) {
    // Skip if not a swap
    if (tx.type !== 'SWAP') continue;

    const tokenTransfers = tx.tokenTransfers || [];

    for (const transfer of tokenTransfers) {
      // Incoming = bought, Outgoing = sold
      const isIncoming = transfer.toUserAccount === walletAddress;
      const amount = transfer.tokenAmount || 0;
      const mint = transfer.mint;

      if (!tokenTrades.has(mint)) {
        tokenTrades.set(mint, { buys: 0, sells: 0, buyAmount: 0, sellAmount: 0 });
      }

      const trade = tokenTrades.get(mint);
      if (isIncoming) {
        trade.buys++;
        trade.buyAmount += amount;
      } else {
        trade.sells++;
        trade.sellAmount += amount;
      }
    }
  }

  // Calculate rough profit (sell - buy for SOL movements)
  // This is simplified - real profit calc needs price at time of trade
  const solTrades = history.filter(tx =>
    tx.nativeTransfers?.some(t => t.toUserAccount === walletAddress || t.fromUserAccount === walletAddress)
  );

  for (const tx of solTrades) {
    for (const transfer of (tx.nativeTransfers || [])) {
      if (transfer.toUserAccount === walletAddress) {
        totalProfit += transfer.amount / 1e9;
      } else if (transfer.fromUserAccount === walletAddress) {
        totalProfit -= transfer.amount / 1e9;
      }
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return {
    walletAddress,
    totalProfit,
    winRate,
    totalTrades,
    tokenTrades: Object.fromEntries(tokenTrades),
    recentTxCount: history.length,
    lastActivity: history[0]?.timestamp || null
  };
}

/**
 * Find top performing wallets from recent token launches
 * Uses DexScreener to find new tokens, then analyzes early buyers
 */
async function findTopPerformers() {
  console.log('\n🔍 Finding top performing wallets...');

  const topWallets = [];

  try {
    // Get recent successful tokens (tokens that pumped)
    const response = await fetch(
      'https://api.dexscreener.com/latest/dex/search?q=solana',
      { timeout: 10000 }
    );
    const data = await response.json();

    // Filter for tokens with high gains
    const successfulTokens = (data.pairs || [])
      .filter(p => p.chainId === 'solana')
      .filter(p => parseFloat(p.priceChange?.h24 || 0) > 100) // 100%+ gain
      .slice(0, 10);

    console.log(`   Found ${successfulTokens.length} tokens with 100%+ gains`);

    // For each successful token, find early buyers
    for (const token of successfulTokens) {
      const mint = token.baseToken?.address;
      if (!mint) continue;

      console.log(`   Analyzing early buyers of ${token.baseToken?.symbol}...`);

      // Get token holders via Helius
      const holdersResponse = await fetch(
        `https://api.helius.xyz/v0/token-metadata?api-key=${CONFIG.heliusApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mintAccounts: [mint] }),
          timeout: 10000
        }
      );

      // Also get recent transactions for this token
      const txResponse = await fetch(
        `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${CONFIG.heliusApiKey}&limit=50&type=SWAP`,
        { timeout: 10000 }
      );

      if (txResponse.ok) {
        const transactions = await txResponse.json();

        // Find wallets that bought early
        const earlyBuyers = new Set();
        for (const tx of transactions) {
          for (const transfer of (tx.tokenTransfers || [])) {
            if (transfer.toUserAccount && transfer.mint === mint) {
              earlyBuyers.add(transfer.toUserAccount);
            }
          }
        }

        // Add to potential top wallets
        for (const wallet of earlyBuyers) {
          if (!topWallets.find(w => w.address === wallet)) {
            topWallets.push({
              address: wallet,
              foundFrom: token.baseToken?.symbol,
              tokenGain: token.priceChange?.h24
            });
          }
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`   Found ${topWallets.length} potential top wallets`);

    // Analyze each wallet's performance
    const analyzedWallets = [];
    for (const wallet of topWallets.slice(0, 30)) {
      const performance = await analyzeWalletPerformance(wallet.address);
      if (performance && performance.totalProfit > CONFIG.minProfitToTrack) {
        analyzedWallets.push({
          ...wallet,
          ...performance
        });
      }
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    }

    // Sort by profit
    analyzedWallets.sort((a, b) => b.totalProfit - a.totalProfit);

    return analyzedWallets.slice(0, CONFIG.maxWalletsToTrack);

  } catch (error) {
    console.log(`   ❌ Error finding top performers: ${error.message}`);
    return [];
  }
}

/**
 * Monitor a wallet's activity via WebSocket
 */
function subscribeToWallet(walletAddress) {
  const ws = new WebSocket(CONFIG.heliusWs);

  ws.on('open', () => {
    // Subscribe to account changes
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'accountSubscribe',
      params: [
        walletAddress,
        { encoding: 'jsonParsed', commitment: 'confirmed' }
      ]
    };
    ws.send(JSON.stringify(subscribeMsg));
    console.log(`   📡 Subscribed to wallet: ${walletAddress.slice(0, 8)}...`);
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.method === 'accountNotification') {
        // Wallet activity detected!
        console.log(`\n🐋 WHALE ACTIVITY: ${walletAddress.slice(0, 8)}...`);

        // Get recent transaction to see what they did
        const history = await getWalletHistory(walletAddress, 1);
        if (history.length > 0) {
          const tx = history[0];

          if (tx.type === 'SWAP') {
            const alert = {
              timestamp: new Date().toISOString(),
              wallet: walletAddress,
              type: tx.type,
              description: tx.description,
              tokenTransfers: tx.tokenTransfers,
              signature: tx.signature
            };

            recentAlerts.push(alert);
            if (recentAlerts.length > 100) recentAlerts.shift();

            console.log(`   📊 ${tx.description}`);
            console.log(`   🔗 https://solscan.io/tx/${tx.signature}`);

            // Save alert
            saveAlerts();
          }
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  });

  ws.on('error', (error) => {
    console.log(`   ⚠️ WebSocket error for ${walletAddress.slice(0, 8)}: ${error.message}`);
  });

  ws.on('close', () => {
    console.log(`   📴 Connection closed for ${walletAddress.slice(0, 8)}`);
    // Reconnect after 5 seconds
    setTimeout(() => subscribeToWallet(walletAddress), 5000);
  });

  return ws;
}

/**
 * Poll wallet activity (fallback if WebSocket fails)
 */
async function pollWalletActivity(walletAddress) {
  const history = await getWalletHistory(walletAddress, 5);

  for (const tx of history) {
    // Skip if we've seen this transaction
    if (seenTransactions.has(tx.signature)) continue;
    seenTransactions.add(tx.signature);

    // Only alert on swaps
    if (tx.type !== 'SWAP') continue;

    // Check if it's a buy (SOL outgoing, tokens incoming)
    const isBuy = tx.nativeTransfers?.some(t =>
      t.fromUserAccount === walletAddress && t.amount > CONFIG.minBuySize * 1e9
    );

    if (isBuy && CONFIG.alertOnBuy) {
      const walletData = trackedWallets.get(walletAddress);
      const walletName = walletData?.name || walletAddress.slice(0, 8);

      console.log(`\n🔥 SMART MONEY BUY ALERT!`);
      console.log(`   🐋 Wallet: ${walletName}... (${walletData?.totalProfit?.toFixed(2) || '?'} SOL profit)`);
      console.log(`   📊 ${tx.description}`);
      console.log(`   🔗 https://solscan.io/tx/${tx.signature}`);

      // Extract token being bought
      for (const transfer of (tx.tokenTransfers || [])) {
        if (transfer.toUserAccount === walletAddress) {
          console.log(`   🪙 Token: ${transfer.mint}`);
          console.log(`   💰 Amount: ${transfer.tokenAmount?.toLocaleString()}`);
        }
      }

      const alert = {
        timestamp: new Date().toISOString(),
        type: 'BUY',
        wallet: walletAddress,
        walletProfit: walletData?.totalProfit,
        description: tx.description,
        tokenMint: tx.tokenTransfers?.[0]?.mint,
        signature: tx.signature
      };

      recentAlerts.push(alert);
      saveAlerts();
    }
  }
}

// === DATA PERSISTENCE ===

function loadTrackedWallets() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
      for (const [addr, info] of Object.entries(data)) {
        trackedWallets.set(addr, info);
      }
      console.log(`📂 Loaded ${trackedWallets.size} tracked wallets`);
    }
  } catch (error) {
    console.log('📂 Starting with fresh wallet list');
  }
}

function saveTrackedWallets() {
  try {
    if (!fs.existsSync('data')) fs.mkdirSync('data');
    const data = Object.fromEntries(trackedWallets);
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(`⚠️ Error saving wallets: ${error.message}`);
  }
}

function saveAlerts() {
  try {
    if (!fs.existsSync('data')) fs.mkdirSync('data');
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(recentAlerts.slice(-100), null, 2));
  } catch (error) {
    // Ignore
  }
}

// === DISPLAY ===

function displayDashboard() {
  console.clear();
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🐋 SMART MONEY TRACKER - LIVE 🐋                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Tracking:    ${trackedWallets.size.toString().padEnd(4)} top wallets                           ║
║  Alerts:      ${recentAlerts.length.toString().padEnd(4)} trade alerts                           ║
║  Last Update: ${new Date().toLocaleTimeString()}                                  ║
╚═══════════════════════════════════════════════════════════════╝

📊 TOP TRACKED WALLETS (by profit):
`);

  const sortedWallets = Array.from(trackedWallets.entries())
    .sort((a, b) => (b[1].totalProfit || 0) - (a[1].totalProfit || 0))
    .slice(0, 10);

  for (const [addr, data] of sortedWallets) {
    const profit = (data.totalProfit || 0).toFixed(2);
    const winRate = (data.winRate || 0).toFixed(0);
    console.log(`   ${addr.slice(0, 8)}... | Profit: ${profit.padStart(8)} SOL | Win: ${winRate}%`);
  }

  console.log(`\n📢 RECENT ALERTS:`);
  const recentAlertsList = recentAlerts.slice(-5).reverse();
  if (recentAlertsList.length === 0) {
    console.log(`   No alerts yet... monitoring...`);
  } else {
    for (const alert of recentAlertsList) {
      const time = new Date(alert.timestamp).toLocaleTimeString();
      console.log(`   [${time}] ${alert.type}: ${alert.wallet.slice(0, 8)}... - ${alert.description?.slice(0, 50) || 'Trade'}`);
    }
  }

  console.log(`\n💡 Press Ctrl+C to stop`);
}

// === MAIN ===

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🐋 SMART MONEY TRACKER 🐋                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Find and follow top performing Solana traders               ║
║  Get alerts when they buy new tokens                          ║
║  Use their alpha to inform your trades                        ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Load existing data
  loadTrackedWallets();

  // Find top performers if we don't have any
  if (trackedWallets.size < 5) {
    const topPerformers = await findTopPerformers();

    for (const wallet of topPerformers) {
      trackedWallets.set(wallet.address, {
        ...wallet,
        addedAt: new Date().toISOString()
      });
    }

    saveTrackedWallets();
    console.log(`\n✅ Now tracking ${trackedWallets.size} top wallets`);
  }

  // Start monitoring
  console.log(`\n📡 Starting real-time monitoring...`);

  // Poll activity every 10 seconds (more reliable than WebSocket for Helius free tier)
  setInterval(async () => {
    for (const [walletAddress] of trackedWallets) {
      await pollWalletActivity(walletAddress);
      await new Promise(r => setTimeout(r, 200)); // Rate limit
    }
  }, CONFIG.activityCheckInterval);

  // Update top wallets every 5 minutes
  setInterval(async () => {
    console.log(`\n🔄 Updating top wallet list...`);
    const newTopPerformers = await findTopPerformers();

    for (const wallet of newTopPerformers) {
      if (!trackedWallets.has(wallet.address)) {
        trackedWallets.set(wallet.address, {
          ...wallet,
          addedAt: new Date().toISOString()
        });
        console.log(`   ➕ Added new top wallet: ${wallet.address.slice(0, 8)}...`);
      }
    }

    saveTrackedWallets();
  }, CONFIG.walletUpdateInterval);

  // Display dashboard every 30 seconds
  setInterval(displayDashboard, 30000);

  // Initial display
  setTimeout(displayDashboard, 5000);

  // Keep running
  console.log(`\n✅ Smart Money Tracker is LIVE!`);
  console.log(`   Monitoring ${trackedWallets.size} top wallets...`);
  console.log(`   Alerts will appear when they make trades\n`);
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down Smart Money Tracker...');
  saveTrackedWallets();
  saveAlerts();
  process.exit(0);
});

main().catch(console.error);
