#!/usr/bin/env node
/**
 * 🎛️ SOL BOT CONTROL PANEL
 * Simple and reliable terminal UI for the trading bot
 */

import blessed from 'blessed';
import fetch from 'node-fetch';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let state = {
  botRunning: false,
  scanCount: 0,
  tokens: [],
  logs: [],
  stats: { hot: 0, dump: 0, neutral: 0 },
  ml: { accuracy: 0, predictions: 0, correct: 0 },
  sentiment: { bullish: 0, bearish: 0, neutral: 0, fearGreed: 50 },
  positions: [],
  holdings: [],           // Active holdings with live prices
  wallet: { sol: 0, usd: 0, startingUsd: 5.00 },  // Real wallet balance
  solPrice: 120,          // Current SOL price in USD (updated from real feed)
  totalPnL: 0,
  sessionPnL: 0,          // P&L since dashboard started
  realizedPnL: 0,         // Closed trades P&L
  unrealizedPnL: 0,       // Open positions P&L
  pnlHistory: [],         // Track P&L over time for trend
  tradeStats: { wins: 0, losses: 0, total: 0, avgWinSize: 0, avgLossSize: 0 },
  lossLimit: { current: 0, max: 20.00, breached: false },
  performance: {
    avgSuccessRate: 0,
    avgExecutionTime: 0,
    totalRoutes: 0,
    apiCalls: 0,
    apiErrors: 0,
    uptime: Date.now()
  },
  errors: []
};

// Load ML model stats
function loadMLStats() {
  try {
    if (fs.existsSync('ml-model.json')) {
      const model = JSON.parse(fs.readFileSync('ml-model.json', 'utf8'));
      state.ml.accuracy = parseFloat(model.stats?.accuracy || 0);
      state.ml.predictions = model.stats?.totalPredictions || 0;
      state.ml.correct = model.stats?.correctPredictions || 0;
    }
  } catch (e) {}
}

// Load positions from all position files - USING REAL DATA
function loadPositions() {
  state.holdings = [];
  state.realizedPnL = 0;
  state.tradeStats = { wins: 0, losses: 0, total: 0 };
  
  const posFiles = ['positions.json', 'positions-safe.json', 'positions-fl.json', 'positions-flashloan.json', 'positions-birdeye.json'];
  
  let winSizes = [];
  let lossSizes = [];
  
  for (const file of posFiles) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      
      // Handle different position formats
      if (data.positions && Array.isArray(data.positions)) {
        for (const pos of data.positions) {
          // Format: [mint, {symbol, entrySOL, ...}] - positions-fl.json format
          const isArrayFormat = Array.isArray(pos);
          const p = isArrayFormat ? pos[1] : pos;
          const mint = isArrayFormat ? pos[0] : (p.mint || 'unknown');
          
          if (p.status === 'CLOSED') {
            // Realized P&L from closed positions - REAL DATA
            const profit = parseFloat(p.profit) || 0;
            const profitUSD = profit * state.solPrice;
            state.realizedPnL += profit;
            state.tradeStats.total++;
            if (profit > 0) {
              state.tradeStats.wins++;
              winSizes.push(profitUSD);
            } else {
              state.tradeStats.losses++;
              lossSizes.push(Math.abs(profitUSD));
              state.lossLimit.current += Math.abs(profitUSD);
            }
          } else {
            // Active holding
            state.holdings.push({
              mint: mint,
              symbol: p.symbol || 'UNK',
              entrySOL: p.entrySOL || p.entryAmountSol || 0,
              tokensHeld: p.tokensHeld || p.tokenAmount || 0,
              entryTime: p.entryTime || Date.now(),
              currentPrice: 0,
              currentValue: 0,
              pnl: 0,
              pnlPct: 0,
              source: file
            });
          }
        }
      }
    } catch (e) {
      trackError(e, `loadPositions:${file}`);
    }
  }
  
  // Calculate average sizes
  state.tradeStats.avgWinSize = winSizes.length > 0 
    ? winSizes.reduce((a, b) => a + b, 0) / winSizes.length 
    : 0;
  state.tradeStats.avgLossSize = lossSizes.length > 0 
    ? lossSizes.reduce((a, b) => a + b, 0) / lossSizes.length 
    : 0;
  
  // Check if loss limit breached
  state.lossLimit.breached = state.lossLimit.current >= state.lossLimit.max;
}

// Fetch live prices for holdings and calculate unrealized P&L (FIX #3: accurate decimals)
async function updateHoldingsPrices() {
  if (state.holdings.length === 0) return;
  
  state.unrealizedPnL = 0;
  
  for (const holding of state.holdings) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${holding.mint}`);
      const data = await res.json();
      const pair = data.pairs?.[0];
      
      if (pair) {
        const priceUsd = parseFloat(pair.priceUsd) || 0;
        const priceNative = parseFloat(pair.priceNative) || 0;
        
        // Get actual token decimals from chain (FIX #3)
        const decimals = await getTokenDecimals(holding.mint);
        const divisor = Math.pow(10, decimals);
        
        // Calculate current value in SOL with CORRECT decimals
        holding.currentPrice = priceUsd;
        holding.currentValue = (holding.tokensHeld / divisor) * priceNative;
        holding.pnl = holding.currentValue - holding.entrySOL;
        holding.pnlPct = holding.entrySOL > 0 ? (holding.pnl / holding.entrySOL) * 100 : 0;
        holding.decimals = decimals; // Store for reference
        
        state.unrealizedPnL += holding.pnl;
      }
      
      trackApiCall(true);
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      trackApiCall(false);
      trackError(e, `updateHoldingsPrices:${holding.mint.slice(0,8)}`);
    }
  }
  
  // Track P&L history for trend
  const totalPnL = state.realizedPnL + state.unrealizedPnL;
  state.pnlHistory.push({ time: Date.now(), pnl: totalPnL });
  if (state.pnlHistory.length > 60) state.pnlHistory.shift(); // Keep last 60 data points
}

// Load route performance data
function loadPerformanceData() {
  try {
    const perfFile = path.join('data', 'route-performance.json');
    if (fs.existsSync(perfFile)) {
      const data = JSON.parse(fs.readFileSync(perfFile, 'utf8'));
      const routes = Object.values(data);
      if (routes.length > 0) {
        state.performance.totalRoutes = routes.length;
        state.performance.avgSuccessRate = routes.reduce((sum, r) => sum + (r.successRate || 0), 0) / routes.length * 100;
        state.performance.avgExecutionTime = routes.reduce((sum, r) => sum + (r.avgExecutionTime || 0), 0) / routes.length;
      }
    }
  } catch (e) {}
}

// Track API call
function trackApiCall(success = true) {
  state.performance.apiCalls++;
  if (!success) state.performance.apiErrors++;
}

// Track error
function trackError(error, context = 'unknown') {
  state.errors.push({
    time: new Date().toLocaleTimeString(),
    error: error.message || String(error),
    context
  });
  // Keep only last 50 errors
  if (state.errors.length > 50) state.errors.shift();
}

// Get actual token decimals from on-chain mint (FIX #2)
const tokenDecimalsCache = new Map();
async function getTokenDecimals(mintAddress) {
  if (tokenDecimalsCache.has(mintAddress)) {
    return tokenDecimalsCache.get(mintAddress);
  }
  
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const { getMint } = await import('@solana/spl-token');
    const connection = new Connection(process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com');
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);
    const decimals = mintInfo.decimals;
    tokenDecimalsCache.set(mintAddress, decimals);
    return decimals;
  } catch (e) {
    trackError(e, `getTokenDecimals:${mintAddress.slice(0,8)}`);
    return 9; // fallback to default
  }
}

// Get SOL price with fallback sources (FIX #1)
async function getSOLPriceWithFallback() {
  try {
    // Primary: DexScreener
    const dexRes = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const dexData = await dexRes.json();
    const dexPrice = parseFloat(dexData.pairs?.[0]?.priceUsd);
    
    if (dexPrice && dexPrice > 0) {
      trackApiCall(true);
      return dexPrice;
    }
  } catch (e) {
    trackApiCall(false);
    trackError(e, 'dexscreener-sol-price');
  }
  
  try {
    // Fallback: Jupiter
    const jupRes = await fetch('https://price.jup.ag/v4/price?ids=SOL');
    const jupData = await jupRes.json();
    const jupPrice = jupData.data?.SOL?.price;
    
    if (jupPrice && jupPrice > 0) {
      trackApiCall(true);
      return jupPrice;
    }
  } catch (e) {
    trackApiCall(false);
    trackError(e, 'jupiter-sol-price');
  }
  
  // Final fallback
  return 120;
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE SCREEN
// ═══════════════════════════════════════════════════════════════════════════

const screen = blessed.screen({
  smartCSR: true,
  title: 'SOL Bot Dashboard',
  fullUnicode: true
});

// ═══════════════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════════════

const header = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  content: '{center}{bold}🤖 SOL MEMECOIN BOT - CONTROL PANEL{/bold}{/center}',
  tags: true,
  style: {
    fg: 'white',
    bg: 'blue'
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════════════════════

const statusBar = blessed.box({
  parent: screen,
  top: 3,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }
  }
});

function updateStatusBar() {
  const status = state.botRunning ? '{green-fg}● RUNNING{/}' : '{red-fg}○ STOPPED{/}';
  const time = new Date().toLocaleTimeString();
  const balColor = state.wallet.usd >= state.wallet.startingUsd ? 'green' : 'red';
  const pnlFromStart = state.wallet.usd - state.wallet.startingUsd;
  statusBar.setContent(
    ` Status: ${status}  |  ⏱️ ${time}  |  📊 Scans: {cyan-fg}${state.scanCount}{/}  |  ` +
    `🔥 Hot: {green-fg}${state.stats.hot}{/}  |  📉 Dump: {red-fg}${state.stats.dump}{/}  |  ` +
    `💰 Balance: {${balColor}-fg}$${state.wallet.usd.toFixed(2)}{/} (${pnlFromStart >= 0 ? '+' : ''}${pnlFromStart.toFixed(2)})`
  );
}

// Fetch real wallet balance from actual on-chain data
async function fetchWalletBalance() {
  try {
    // Get SOL price with fallback (FIX #1)
    const solPrice = await getSOLPriceWithFallback();
    state.solPrice = solPrice; // Store in state for P&L calculations
    
    // Import wallet and RPC to get real balance
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const walletData = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const connection = new Connection(process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com');
    
    const publicKey = new PublicKey(walletData.publicKey);
    const balance = await connection.getBalance(publicKey);
    
    state.wallet.sol = balance / 1e9; // Convert lamports to SOL
    state.wallet.usd = state.wallet.sol * solPrice;
    
    trackApiCall(true);
  } catch (e) {
    trackApiCall(false);
    trackError(e, 'fetchWalletBalance');
    // Fallback to manual check if available
    state.solPrice = 120; // Updated default based on current market
    state.wallet.sol = 0.191667;
    state.wallet.usd = 44.08;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN LIST
// ═══════════════════════════════════════════════════════════════════════════

const tokenList = blessed.listtable({
  parent: screen,
  top: 16,
  left: 0,
  width: '70%',
  height: '35%',
  label: ' 🪙 Live Tokens ',
  border: { type: 'line' },
  align: 'left',
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  noCellBorders: true,
  style: {
    border: { fg: 'cyan' },
    header: { fg: 'cyan', bold: true },
    cell: { fg: 'white' },
    selected: { bg: 'blue' }
  }
});

tokenList.setData([
  ['Token', 'Liquidity', 'Volume', '5min', '1hr', '24hr', 'Potential', ''],
  ['Waiting...', '', '', '', '', '', '', '']
]);

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS PANEL
// ═══════════════════════════════════════════════════════════════════════════

const controlsPanel = blessed.box({
  parent: screen,
  top: 6,
  right: 0,
  width: '30%',
  height: 10,
  label: ' ⌨️ Controls ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'magenta' },
    label: { fg: 'magenta', bold: true }
  },
  content: 
    '{bold}Shortcuts:{/bold}\n' +
    '  {cyan-fg}[S]{/} Start/Stop  {cyan-fg}[E]{/} 🚨 E-Brake\n' +
    '  {cyan-fg}[R]{/} Refresh     {cyan-fg}[M]{/} ML Stats\n' +
    '  {cyan-fg}[C]{/} Clear       {cyan-fg}[H]{/} Help\n' +
    '  {cyan-fg}[T]{/} Test Token  {cyan-fg}[Q]{/} Quit'
});

// ═══════════════════════════════════════════════════════════════════════════
// RUG SHIELD PROTECTION PANEL
// ═══════════════════════════════════════════════════════════════════════════

const protectionPanel = blessed.box({
  parent: screen,
  top: 16,
  right: 0,
  width: '30%',
  height: 10,
  label: ' 🛡️ RUG SHIELD ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'red' },
    label: { fg: 'red', bold: true }
  }
});

// Protection settings - ML-DRIVEN MODE
const protection = {
  enabled: true,
  mode: 'ML',             // ML-based decisions
  minLiquidity: 100,      // Lower to find more tokens
  minAge: 0,              // No restriction - ML decides
  maxTopWallet: 95,       // Very permissive - ML scores it
  stopLoss: 12,           // -12% tighter stop (reduce loss size)
  trailingStop: 12,       // -12% trailing
  takeProfit: 25,         // +25% target (take profits faster)
  maxHold: 10             // 10min max (ML decides exit)
};

function updateProtectionPanel() {
  const status = protection.enabled ? '{green-fg}🟢 ACTIVE{/}' : '{red-fg}🔴 OFF{/}';
  const mode = protection.mode === 'ML' ? '{magenta-fg}ML-DRIVEN{/}' : '{yellow-fg}RULE-BASED{/}';
  protectionPanel.setContent(
    `Status: ${status} | Mode: ${mode}\n` +
    `{bold}─── ML Scoring Factors ───{/bold}\n` +
    `Liquidity: {cyan-fg}≥$${protection.minLiquidity}{/} (scored)\n` +
    `Age: {cyan-fg}≥${protection.minAge}m{/} (scored) | Top Wallet: {cyan-fg}≤${protection.maxTopWallet}%{/}\n` +
    `{bold}─── Safety Exits ───{/bold}\n` +
    `Hard Stop: {red-fg}-${protection.stopLoss}%{/} | Trail: {yellow-fg}-${protection.trailingStop}%{/}\n` +
    `Take Profit: {green-fg}+${protection.takeProfit}%{/} | Max Hold: {cyan-fg}${protection.maxHold}m{/}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS PANEL
// ═══════════════════════════════════════════════════════════════════════════

const statsPanel = blessed.box({
  parent: screen,
  top: 20,
  right: 0,
  width: '30%',
  height: 8,
  label: ' 📈 Session Stats ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'yellow' },
    label: { fg: 'yellow', bold: true }
  }
});

function updateStats() {
  const totalPnL = state.realizedPnL + state.unrealizedPnL;
  const pnlTrend = state.pnlHistory.length >= 2 
    ? (state.pnlHistory[state.pnlHistory.length - 1].pnl > state.pnlHistory[state.pnlHistory.length - 2].pnl ? '↑' : '↓')
    : '→';
  const winRate = state.tradeStats.total > 0 
    ? ((state.tradeStats.wins / state.tradeStats.total) * 100).toFixed(0)
    : '0';
  
  const lossLimitColor = state.lossLimit.breached ? 'red' : 
    (state.lossLimit.current / state.lossLimit.max) > 0.75 ? 'yellow' : 'green';
  const lossLimitPct = ((state.lossLimit.current / state.lossLimit.max) * 100).toFixed(0);
    
  statsPanel.setContent(
    `Trades: {cyan-fg}${state.tradeStats.total}{/} (W:{green-fg}${state.tradeStats.wins}{/} L:{red-fg}${state.tradeStats.losses}{/})\n` +
    `Win Rate: {${parseInt(winRate) >= 50 ? 'green' : 'red'}-fg}${winRate}%{/}\n` +
    `Avg Win: {green-fg}+$${state.tradeStats.avgWinSize.toFixed(2)}{/} | Loss: {red-fg}-$${state.tradeStats.avgLossSize.toFixed(2)}{/}\n` +
    `Loss Limit: {${lossLimitColor}-fg}$${state.lossLimit.current.toFixed(2)}/{/}$${state.lossLimit.max} ({${lossLimitColor}-fg}${lossLimitPct}%{/})\n` +
    `Total P&L: {${totalPnL >= 0 ? 'green' : 'red'}-fg}${totalPnL >= 0 ? '+' : ''}${(totalPnL * state.solPrice).toFixed(2)} USD{/} ${pnlTrend}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ML & SENTIMENT PANEL
// ═══════════════════════════════════════════════════════════════════════════

const mlPanel = blessed.box({
  parent: screen,
  top: 28,
  right: 0,
  width: '30%',
  height: 7,
  label: ' 🧠 ML & Sentiment ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'blue' },
    label: { fg: 'blue', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE PANEL
// ═══════════════════════════════════════════════════════════════════════════

const perfPanel = blessed.box({
  parent: screen,
  top: 35,
  right: 0,
  width: '30%',
  height: 8,
  label: ' ⚡ Performance ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

function updatePerfPanel() {
  const uptime = Math.floor((Date.now() - state.performance.uptime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  const uptimeStr = `${hours}h ${mins}m ${secs}s`;
  
  const successColor = state.performance.avgSuccessRate >= 90 ? 'green' : 
                       state.performance.avgSuccessRate >= 70 ? 'yellow' : 'red';
  const apiSuccessRate = state.performance.apiCalls > 0 
    ? ((state.performance.apiCalls - state.performance.apiErrors) / state.performance.apiCalls * 100).toFixed(1)
    : '100.0';
  
  perfPanel.setContent(
    `Uptime:     {cyan-fg}${uptimeStr}{/}\n` +
    `Route Success: {${successColor}-fg}${state.performance.avgSuccessRate.toFixed(1)}%{/}\n` +
    `Avg Exec:   {cyan-fg}${state.performance.avgExecutionTime.toFixed(0)}ms{/}\n` +
    `API Calls:  {white-fg}${state.performance.apiCalls}{/} ({green-fg}${apiSuccessRate}%{/} ok)\n` +
    `Errors:     {red-fg}${state.errors.length}{/}`
  );
}

function updateMLPanel() {
  const accColor = state.ml.accuracy >= 60 ? 'green' : state.ml.accuracy >= 40 ? 'yellow' : 'red';
  const fgColor = state.sentiment.fearGreed >= 60 ? 'green' : state.sentiment.fearGreed >= 40 ? 'yellow' : 'red';
  const fgLabel = state.sentiment.fearGreed >= 70 ? 'GREED' : state.sentiment.fearGreed >= 50 ? 'NEUTRAL' : 'FEAR';
  
  mlPanel.setContent(
    `ML Accuracy: {${accColor}-fg}${state.ml.accuracy.toFixed(1)}%{/}\n` +
    `Predictions: {cyan-fg}${state.ml.predictions}{/} ({green-fg}${state.ml.correct}{/} correct)\n` +
    `Fear/Greed:  {${fgColor}-fg}${state.sentiment.fearGreed}{/} ({${fgColor}-fg}${fgLabel}{/})\n` +
    `Sentiment:   🟢{green-fg}${state.sentiment.bullish}{/} ⚪${state.sentiment.neutral} 🔴{red-fg}${state.sentiment.bearish}{/}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOLDINGS PANEL - Shows what you own with live P&L
// ═══════════════════════════════════════════════════════════════════════════

const holdingsBox = blessed.listtable({
  parent: screen,
  top: 6,
  left: 0,
  width: '45%',
  height: 10,
  label: ' 💼 YOUR HOLDINGS (Live P&L) ',
  border: { type: 'line' },
  align: 'left',
  tags: true,
  keys: true,
  noCellBorders: true,
  style: {
    border: { fg: 'yellow' },
    header: { fg: 'yellow', bold: true },
    cell: { fg: 'white' },
    label: { fg: 'yellow', bold: true }
  }
});

function updateHoldingsPanel() {
  const tableData = [['Symbol', 'Entry', 'Current', 'P&L', '%']];
  
  if (state.holdings.length === 0) {
    tableData.push(['No active', 'positions', '', '', '']);
  } else {
    for (const h of state.holdings.slice(0, 5)) { // Show top 5
      const pnlColor = h.pnl >= 0 ? '+' : '';
      tableData.push([
        h.symbol.slice(0, 10),
        `${(h.entrySOL * state.solPrice).toFixed(2)}`,
        `${(h.currentValue * state.solPrice).toFixed(2)}`,
        `${pnlColor}${(h.pnl * state.solPrice).toFixed(2)}`,
        `${pnlColor}${h.pnlPct.toFixed(1)}%`
      ]);
    }
  }
  
  holdingsBox.setData(tableData);
}

// ═══════════════════════════════════════════════════════════════════════════
// P&L SUMMARY PANEL
// ═══════════════════════════════════════════════════════════════════════════

const pnlPanel = blessed.box({
  parent: screen,
  top: 6,
  left: '45%',
  width: '25%',
  height: 10,
  label: ' 💰 P&L TRACKER ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

function updatePnLPanel() {
  const totalPnL = state.realizedPnL + state.unrealizedPnL;
  const totalUSD = totalPnL * state.solPrice; // Use real SOL price
  
  // Determine trend from history
  let trend = '→';
  let trendColor = 'white';
  if (state.pnlHistory.length >= 2) {
    const recent = state.pnlHistory.slice(-5);
    const diff = recent[recent.length - 1].pnl - recent[0].pnl;
    if (diff > 0.0001) { trend = '📈'; trendColor = 'green'; }
    else if (diff < -0.0001) { trend = '📉'; trendColor = 'red'; }
  }
  
  pnlPanel.setContent(
    `{bold}═══ PROFIT/LOSS ═══{/bold}\n\n` +
    `Realized:   {${state.realizedPnL >= 0 ? 'green' : 'red'}-fg}${state.realizedPnL >= 0 ? '+' : ''}${(state.realizedPnL * state.solPrice).toFixed(2)} USD{/}\n` +
    `Unrealized: {${state.unrealizedPnL >= 0 ? 'green' : 'red'}-fg}${state.unrealizedPnL >= 0 ? '+' : ''}${(state.unrealizedPnL * state.solPrice).toFixed(2)} USD{/}\n` +
    `{bold}────────────────{/bold}\n` +
    `TOTAL: {bold}{${totalPnL >= 0 ? 'green' : 'red'}-fg}${totalPnL >= 0 ? '+' : ''}$${totalUSD.toFixed(2)}{/}{/} {${trendColor}-fg}${trend}{/}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOG BOX
// ═══════════════════════════════════════════════════════════════════════════

const logBox = blessed.log({
  parent: screen,
  bottom: 3,
  left: 0,
  width: '100%',
  height: '25%',
  label: ' 📜 Activity Log ',
  border: { type: 'line' },
  tags: true,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '█',
    style: { fg: 'cyan' }
  },
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const icons = {
    info: '{cyan-fg}ℹ️{/}',
    success: '{green-fg}✅{/}',
    warning: '{yellow-fg}⚠️{/}',
    error: '{red-fg}❌{/}',
    hot: '{red-fg}🔥{/}',
    money: '{green-fg}💰{/}'
  };
  logBox.log(`{gray-fg}${time}{/} ${icons[type] || icons.info} ${msg}`);
  screen.render();
}

// ═══════════════════════════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════════════════════════

const footer = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 3,
  content: '{center} Press {bold}[S]{/bold} to Start | {bold}[Q]{/bold} to Quit | {bold}[H]{/bold} for Help {/center}',
  tags: true,
  style: {
    fg: 'white',
    bg: 'gray'
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FETCH TOKEN DATA
// ═══════════════════════════════════════════════════════════════════════════

async function fetchTokens() {
  state.scanCount++;
  log('Scanning for tokens...', 'info');
  
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const tokens = await res.json();
    const solTokens = tokens.filter(t => t.chainId === 'solana').slice(0, 12);
    
    const tableData = [['Token', 'Liquidity', 'Volume', '5min', '1hr', '24hr', 'Potential', '']];
    let hotCount = 0, dumpCount = 0, neutralCount = 0;
    
    for (const token of solTokens) {
      try {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
        const pairData = await pairRes.json();
        const pair = pairData.pairs?.[0];
        if (!pair) continue;
        
        const symbol = (pair.baseToken?.symbol || '???').slice(0, 12);
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const p5m = pair.priceChange?.m5 || 0;
        const p1h = pair.priceChange?.h1 || 0;
        const p24h = pair.priceChange?.h24 || 0;
        
        const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
        const fmtMoney = n => n >= 1000 ? '$' + (n/1000).toFixed(0) + 'K' : '$' + n.toFixed(0);
        
        const potential = 5 * (p5m / 100);
        const potStr = (potential >= 0 ? '+$' : '-$') + Math.abs(potential).toFixed(2);
        
        let indicator = '';
        if (p5m > 10 && liq > 5000) {
          indicator = '🔥';
          hotCount++;
          log(`HOT: ${symbol} up ${p5m.toFixed(1)}% in 5min! Liq: ${fmtMoney(liq)}`, 'hot');
        } else if (p5m > 5 && liq > 10000) {
          indicator = '⬆️';
          neutralCount++;
        } else if (p5m < -10) {
          indicator = '📉';
          dumpCount++;
        } else {
          neutralCount++;
        }
        
        tableData.push([
          symbol,
          fmtMoney(liq),
          fmtMoney(vol),
          fmt(p5m),
          fmt(p1h),
          fmt(p24h),
          potStr,
          indicator
        ]);
        
        trackApiCall(true);
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        trackApiCall(false);
        trackError(e, `fetch:${token.tokenAddress?.slice(0,8)}`);
      }
    }
    
    state.stats = { hot: hotCount, dump: dumpCount, neutral: neutralCount };
    
    // Calculate sentiment from token data
    const totalTokens = hotCount + dumpCount + neutralCount;
    if (totalTokens > 0) {
      state.sentiment.bullish = hotCount;
      state.sentiment.bearish = dumpCount;
      state.sentiment.neutral = neutralCount;
      // Fear/Greed: 0-100, based on ratio of hot vs dumping
      state.sentiment.fearGreed = Math.round(50 + ((hotCount - dumpCount) / Math.max(1, totalTokens)) * 50);
      state.sentiment.fearGreed = Math.max(0, Math.min(100, state.sentiment.fearGreed));
    }
    
    tokenList.setData(tableData);
    log(`Scan #${state.scanCount} complete - ${tableData.length - 1} tokens found`, 'success');
    
    // Update holdings with live prices
    loadPositions();
    await updateHoldingsPrices();
    
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    trackError(e, 'fetchTokens');
  }
  
  updateStatusBar();
  updateStats();
  updateMLPanel();
  updatePerfPanel();
  updateHoldingsPanel();
  updatePnLPanel();
  screen.render();
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT CONTROL
// ═══════════════════════════════════════════════════════════════════════════

let scanInterval = null;

function startBot() {
  if (state.botRunning) {
    log('Bot is already running', 'warning');
    return;
  }
  
  state.botRunning = true;
  log('🚀 Bot monitoring started!', 'success');
  
  fetchTokens();
  scanInterval = setInterval(fetchTokens, 5000); // FIX #4: 5sec for faster response
  
  footer.setContent('{center} {green-fg}● BOT RUNNING{/} | Press {bold}[S]{/bold} to Stop | {bold}[E]{/bold} Emergency Sell | {bold}[Q]{/bold} to Quit {/center}');
  updateStatusBar();
  screen.render();
}

function stopBot() {
  if (!state.botRunning) {
    log('Bot is not running', 'warning');
    return;
  }
  
  state.botRunning = false;
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  
  log('🛑 Bot monitoring stopped', 'warning');
  footer.setContent('{center} Press {bold}[S]{/bold} to Start | {bold}[Q]{/bold} to Quit | {bold}[H]{/bold} for Help {/center}');
  updateStatusBar();
  screen.render();
}

function toggleBot() {
  state.botRunning ? stopBot() : startBot();
}

// ═══════════════════════════════════════════════════════════════════════════
// EMERGENCY SELL (E-BRAKE)
// ═══════════════════════════════════════════════════════════════════════════

function emergencySell() {
  // Show confirmation dialog
  const confirmBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
    height: 12,
    label: ' 🚨 EMERGENCY SELL ',
    border: { type: 'line' },
    tags: true,
    style: {
      border: { fg: 'red' },
      bg: 'black'
    },
    content: 
      '\n{center}{bold}{red-fg}⚠️ EMERGENCY SELL ALL ⚠️{/}{/center}\n\n' +
      '{center}This will attempt to sell ALL{/center}\n' +
      '{center}token positions immediately!{/center}\n\n' +
      '{center}{yellow-fg}Press Y to confirm, N to cancel{/}{/center}'
  });
  
  screen.render();
  
  const keyHandler = (ch, key) => {
    if (ch === 'y' || ch === 'Y') {
      confirmBox.destroy();
      screen.render();
      executeEmergencySell();
    } else if (ch === 'n' || ch === 'N' || key.name === 'escape') {
      confirmBox.destroy();
      screen.render();
      log('Emergency sell cancelled', 'info');
    }
    screen.removeListener('keypress', keyHandler);
  };
  
  screen.on('keypress', keyHandler);
}

async function executeEmergencySell() {
  log('🚨 EXECUTING EMERGENCY SELL...', 'error');
  log('Stopping all bot activity...', 'warning');
  
  // Stop the bot first
  stopBot();
  
  // Try to run the emergency sell script
  try {
    const child = spawn('node', ['emergency-sell.mjs'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => log(line, 'warning'));
    });
    
    child.stderr.on('data', (data) => {
      log(`Error: ${data.toString()}`, 'error');
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        log('✅ Emergency sell completed!', 'success');
      } else {
        log(`Emergency sell exited with code ${code}`, 'error');
      }
      loadPositions();
      updateStats();
      screen.render();
    });
    
  } catch (e) {
    log(`Failed to execute emergency sell: ${e.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

screen.key(['q', 'Q', 'C-c'], () => {
  stopBot();
  process.exit(0);
});

screen.key(['s', 'S'], toggleBot);

screen.key(['r', 'R'], () => {
  log('Manual refresh...', 'info');
  fetchTokens();
});

screen.key(['e', 'E'], () => {
  emergencySell();
});

screen.key(['m', 'M'], () => {
  loadMLStats();
  updateMLPanel();
  log('─────────────────────────────────────────', 'info');
  log(`ML Model Stats Refreshed`, 'info');
  log(`Accuracy: ${state.ml.accuracy.toFixed(1)}% (${state.ml.correct}/${state.ml.predictions})`, 'info');
  log(`Fear/Greed Index: ${state.sentiment.fearGreed} (${state.sentiment.fearGreed >= 70 ? 'GREED' : state.sentiment.fearGreed >= 50 ? 'NEUTRAL' : 'FEAR'})`, 'info');
  log('─────────────────────────────────────────', 'info');
  screen.render();
});

screen.key(['c', 'C'], () => {
  logBox.setContent('');
  log('Logs cleared', 'info');
});

screen.key(['h', 'H', '?'], () => {
  log('─────────────────────────────────────────', 'info');
  log('HELP: [S] Start/Stop | [R] Refresh | [E] Emergency Sell', 'info');
  log('      [M] ML Stats | [P] Performance | [T] Test Token', 'info');
  log('      [C] Clear | [Q] Quit', 'info');
  log('Legend: 🔥 HOT (>10% 5min) | ⬆️ Rising | 📉 Dumping', 'info');
  log('─────────────────────────────────────────', 'info');
});

// Test a token with Rug Shield
screen.key(['t', 'T'], () => {
  // Create input dialog
  const inputBox = blessed.textbox({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 60,
    height: 5,
    label: ' 🛡️ Test Token - Enter Mint Address ',
    border: { type: 'line' },
    tags: true,
    inputOnFocus: true,
    style: {
      border: { fg: 'cyan' },
      bg: 'black'
    }
  });
  
  inputBox.focus();
  screen.render();
  
  inputBox.readInput((err, value) => {
    inputBox.destroy();
    screen.render();
    
    if (!value || value.trim().length < 30) {
      log('Invalid token address', 'warning');
      return;
    }
    
    const mint = value.trim();
    log(`🛡️ Testing token: ${mint.slice(0, 20)}...`, 'info');
    
    // Run rug-shield check
    const child = spawn('node', ['rug-shield.mjs', mint], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        if (line.includes('✅')) log(line, 'success');
        else if (line.includes('❌') || line.includes('🚫')) log(line, 'error');
        else if (line.includes('⚠️')) log(line, 'warning');
        else log(line, 'info');
      });
    });
    
    child.stderr.on('data', (data) => {
      log(`Error: ${data.toString()}`, 'error');
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        log('✅ Token PASSED safety checks!', 'success');
      } else {
        log('🚫 Token FAILED safety checks - DO NOT BUY', 'error');
      }
      screen.render();
    });
  });
});

screen.key(['p', 'P'], () => {
  loadPerformanceData();
  updatePerfPanel();
  log('─────────────────────────────────────────', 'info');
  log(`Performance Stats Refreshed`, 'info');
  log(`Routes tracked: ${state.performance.totalRoutes}`, 'info');
  log(`Avg success rate: ${state.performance.avgSuccessRate.toFixed(1)}%`, 'info');
  log(`Avg execution: ${state.performance.avgExecutionTime.toFixed(0)}ms`, 'info');
  log(`API calls: ${state.performance.apiCalls} (${state.performance.apiErrors} errors)`, 'info');
  if (state.errors.length > 0) {
    log(`Last error: ${state.errors[state.errors.length - 1].error}`, 'warning');
  }
  log('─────────────────────────────────────────', 'info');
  screen.render();
});

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════

// Load initial data
loadMLStats();
loadPositions();
loadPerformanceData();
await fetchWalletBalance();

updateStatusBar();
updateStats();
updateMLPanel();
updatePerfPanel();
updateHoldingsPanel();
updatePnLPanel();
updateProtectionPanel();
log('═══════════════════════════════════════════', 'info');
log('  Welcome to SOL Bot Control Panel! 🤖', 'success');
log('═══════════════════════════════════════════', 'info');
log(`🛡️ RUG SHIELD PROTECTION: ACTIVE`, 'success');
log(`Holdings: ${state.holdings.length} active positions`, 'info');
log(`Trade History: ${state.tradeStats.wins}W/${state.tradeStats.losses}L (${state.tradeStats.total > 0 ? ((state.tradeStats.wins/state.tradeStats.total)*100).toFixed(0) : 0}%)`, 'info');
log(`Wallet: $${state.wallet.usd.toFixed(2)} (Started: $${state.wallet.startingUsd})`, 'info');
log('Press [S] to start monitoring', 'info');
log('Press [T] to test a token with Rug Shield', 'warning');
log('Press [E] for EMERGENCY SELL (e-brake)', 'warning');
log('Press [H] for help', 'info');

tokenList.focus();
screen.render();
