#!/usr/bin/env node
/**
 * 📊 PERFORMANCE MONITOR
 * 
 * Real-time monitoring of trading performance:
 * - Win ratio (wins vs losses)
 * - Average win size vs average loss size
 * - Total profitability (SOL and USD)
 * - Best/worst trades
 * - Risk/reward analysis
 * - ML accuracy tracking
 */

import fs from 'fs';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import fetch from 'node-fetch';

// Files to monitor
const POSITION_FILES = [
  'positions-fl.json',
  'positions-flashloan.json', 
  'positions-safe.json',
  'positions.json'
];

// State
const state = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  breakeven: 0,
  totalProfitSOL: 0,
  totalProfitUSD: 0,
  winSizeSOL: [],
  lossSizeSOL: [],
  trades: [],
  solPrice: 120, // Default, will update from API
  lastUpdate: Date.now(),
  activeTrades: 0
};

// ═══════════════════════════════════════════════════════════════════════════
// UI SETUP
// ═══════════════════════════════════════════════════════════════════════════

const screen = blessed.screen({
  smartCSR: true,
  title: '📊 Performance Monitor',
  fullUnicode: true
});

const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

// Title
const titleBox = grid.set(0, 0, 1, 12, blessed.box, {
  content: '{center}{bold}📊 SOL BOT PERFORMANCE MONITOR{/bold}{/center}',
  tags: true,
  style: {
    fg: 'cyan',
    border: { fg: 'cyan' }
  }
});

// Overall Stats Panel
const overallPanel = grid.set(1, 0, 3, 4, blessed.box, {
  label: ' 💰 Overall Performance ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

// Win/Loss Ratio Panel
const ratioPanel = grid.set(1, 4, 3, 4, blessed.box, {
  label: ' 🎯 Win/Loss Ratio ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'yellow' },
    label: { fg: 'yellow', bold: true }
  }
});

// Size Analysis Panel
const sizePanel = grid.set(1, 8, 3, 4, blessed.box, {
  label: ' 📏 Win/Loss Size ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  style: {
    border: { fg: 'magenta' },
    label: { fg: 'magenta', bold: true }
  }
});

// Best Trades Panel
const bestPanel = grid.set(4, 0, 4, 6, blessed.box, {
  label: ' 🏆 Best Trades ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '█',
    style: { fg: 'green' }
  },
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

// Worst Trades Panel
const worstPanel = grid.set(4, 6, 4, 6, blessed.box, {
  label: ' 💀 Worst Trades ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '█',
    style: { fg: 'red' }
  },
  style: {
    border: { fg: 'red' },
    label: { fg: 'red', bold: true }
  }
});

// Recent Trades Panel
const recentPanel = grid.set(8, 0, 4, 12, blessed.box, {
  label: ' 📋 Recent Trades (Last 10) ',
  border: { type: 'line' },
  tags: true,
  padding: 1,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '█',
    style: { fg: 'cyan' }
  },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════════════

function loadAllTrades() {
  const allTrades = [];
  
  for (const file of POSITION_FILES) {
    try {
      if (!fs.existsSync(file)) continue;
      
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      
      // Handle different position file formats
      if (Array.isArray(data)) {
        // Format: [[mint, {data}], ...]
        data.forEach(([mint, pos]) => {
          if (pos.status === 'CLOSED' && pos.profit !== undefined) {
            allTrades.push({
              ...pos,
              source: file
            });
          }
        });
      } else if (data.positions && Array.isArray(data.positions)) {
        // Format: {positions: [[mint, {data}], ...]}
        data.positions.forEach(([mint, pos]) => {
          if (pos.status === 'CLOSED' && pos.profit !== undefined) {
            allTrades.push({
              ...pos,
              source: file
            });
          }
        });
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }
  
  // Sort by exit time (newest first)
  return allTrades.sort((a, b) => (b.exitTime || 0) - (a.exitTime || 0));
}

function analyzePerformance() {
  const trades = loadAllTrades();
  
  state.trades = trades;
  state.totalTrades = trades.length;
  state.wins = 0;
  state.losses = 0;
  state.breakeven = 0;
  state.totalProfitSOL = 0;
  state.winSizeSOL = [];
  state.lossSizeSOL = [];
  
  trades.forEach(trade => {
    const profitSOL = trade.profit || 0;
    state.totalProfitSOL += profitSOL;
    
    if (profitSOL > 0.0001) {
      state.wins++;
      state.winSizeSOL.push(profitSOL);
    } else if (profitSOL < -0.0001) {
      state.losses++;
      state.lossSizeSOL.push(Math.abs(profitSOL));
    } else {
      state.breakeven++;
    }
  });
  
  state.totalProfitUSD = state.totalProfitSOL * state.solPrice;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI UPDATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function updateOverallPanel() {
  const profitColor = state.totalProfitSOL >= 0 ? 'green' : 'red';
  const profitSign = state.totalProfitSOL >= 0 ? '+' : '';
  const roi = state.totalTrades > 0 
    ? ((state.totalProfitSOL / (state.totalTrades * 0.02)) * 100).toFixed(1)
    : '0.0';
  
  overallPanel.setContent(
    `{bold}Total Trades:{/bold} ${state.totalTrades}\n` +
    `{bold}Active:{/bold} ${state.activeTrades}\n` +
    `\n` +
    `{bold}Total P&L:{/bold}\n` +
    `  {${profitColor}-fg}${profitSign}${state.totalProfitSOL.toFixed(4)} SOL{/}\n` +
    `  {${profitColor}-fg}${profitSign}$${state.totalProfitUSD.toFixed(2)}{/}\n` +
    `\n` +
    `{bold}ROI:{/bold} {${profitColor}-fg}${profitSign}${roi}%{/}\n` +
    `{bold}SOL Price:{/bold} $${state.solPrice.toFixed(2)}`
  );
}

function updateRatioPanel() {
  const winRate = state.totalTrades > 0 
    ? ((state.wins / state.totalTrades) * 100).toFixed(1)
    : '0.0';
  const lossRate = state.totalTrades > 0
    ? ((state.losses / state.totalTrades) * 100).toFixed(1)
    : '0.0';
  
  const winColor = parseFloat(winRate) >= 50 ? 'green' : 'yellow';
  
  // Visual bar chart
  const barWidth = 30;
  const winBars = Math.round((state.wins / Math.max(1, state.totalTrades)) * barWidth);
  const lossBars = Math.round((state.losses / Math.max(1, state.totalTrades)) * barWidth);
  
  ratioPanel.setContent(
    `{bold}Wins:{/bold} {green-fg}${state.wins}{/} (${winRate}%)\n` +
    `{bold}Losses:{/bold} {red-fg}${state.losses}{/} (${lossRate}%)\n` +
    `{bold}Breakeven:{/bold} ${state.breakeven}\n` +
    `\n` +
    `{bold}Win Rate:{/bold} {${winColor}-fg}${winRate}%{/}\n` +
    `\n` +
    `{green-fg}${'█'.repeat(winBars)}{/}\n` +
    `{red-fg}${'█'.repeat(lossBars)}{/}`
  );
}

function updateSizePanel() {
  const avgWin = state.winSizeSOL.length > 0
    ? state.winSizeSOL.reduce((a, b) => a + b, 0) / state.winSizeSOL.length
    : 0;
  const avgLoss = state.lossSizeSOL.length > 0
    ? state.lossSizeSOL.reduce((a, b) => a + b, 0) / state.lossSizeSOL.length
    : 0;
  const avgWinUSD = avgWin * state.solPrice;
  const avgLossUSD = avgLoss * state.solPrice;
  
  const maxWin = state.winSizeSOL.length > 0
    ? Math.max(...state.winSizeSOL)
    : 0;
  const maxLoss = state.lossSizeSOL.length > 0
    ? Math.max(...state.lossSizeSOL)
    : 0;
  const maxWinUSD = maxWin * state.solPrice;
  const maxLossUSD = maxLoss * state.solPrice;
  
  const riskReward = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '0.00';
  const rrColor = parseFloat(riskReward) >= 1.5 ? 'green' : parseFloat(riskReward) >= 1.0 ? 'yellow' : 'red';
  
  sizePanel.setContent(
    `{bold}Average Win:{/bold}\n` +
    `  {green-fg}+${avgWin.toFixed(4)} SOL ($${avgWinUSD.toFixed(2)}){/}\n` +
    `\n` +
    `{bold}Average Loss:{/bold}\n` +
    `  {red-fg}-${avgLoss.toFixed(4)} SOL ($${avgLossUSD.toFixed(2)}){/}\n` +
    `\n` +
    `{bold}Max Win:{/bold} {green-fg}+${maxWin.toFixed(4)} SOL{/}\n` +
    `{bold}Max Loss:{/bold} {red-fg}-${maxLoss.toFixed(4)} SOL{/}\n` +
    `\n` +
    `{bold}Risk/Reward:{/bold} {${rrColor}-fg}${riskReward}:1{/}`
  );
}

function updateBestPanel() {
  const bestTrades = [...state.trades]
    .filter(t => (t.profit || 0) > 0)
    .sort((a, b) => (b.profitPct || 0) - (a.profitPct || 0))
    .slice(0, 5);
  
  let content = '';
  bestTrades.forEach((trade, i) => {
    const profitPct = (trade.profitPct || 0).toFixed(1);
    const profitSOL = (trade.profit || 0).toFixed(4);
    const profitUSD = ((trade.profit || 0) * state.solPrice).toFixed(2);
    const symbol = trade.symbol || 'Unknown';
    const duration = trade.exitTime && trade.entryTime
      ? Math.round((trade.exitTime - trade.entryTime) / 1000 / 60)
      : 0;
    
    content += `{bold}${i + 1}. ${symbol}{/bold} {green-fg}+${profitPct}%{/}\n`;
    content += `   +${profitSOL} SOL ($${profitUSD})\n`;
    content += `   Duration: ${duration}m\n`;
    if (i < bestTrades.length - 1) content += `\n`;
  });
  
  if (bestTrades.length === 0) {
    content = '{gray-fg}No winning trades yet{/}';
  }
  
  bestPanel.setContent(content);
}

function updateWorstPanel() {
  const worstTrades = [...state.trades]
    .filter(t => (t.profit || 0) < 0)
    .sort((a, b) => (a.profitPct || 0) - (b.profitPct || 0))
    .slice(0, 5);
  
  let content = '';
  worstTrades.forEach((trade, i) => {
    const profitPct = (trade.profitPct || 0).toFixed(1);
    const profitSOL = (trade.profit || 0).toFixed(4);
    const profitUSD = ((trade.profit || 0) * state.solPrice).toFixed(2);
    const symbol = trade.symbol || 'Unknown';
    const duration = trade.exitTime && trade.entryTime
      ? Math.round((trade.exitTime - trade.entryTime) / 1000 / 60)
      : 0;
    
    content += `{bold}${i + 1}. ${symbol}{/bold} {red-fg}${profitPct}%{/}\n`;
    content += `   ${profitSOL} SOL ($${profitUSD})\n`;
    content += `   Duration: ${duration}m\n`;
    if (i < worstTrades.length - 1) content += `\n`;
  });
  
  if (worstTrades.length === 0) {
    content = '{gray-fg}No losing trades yet{/}';
  }
  
  worstPanel.setContent(content);
}

function updateRecentPanel() {
  const recentTrades = state.trades.slice(0, 10);
  
  let content = '';
  recentTrades.forEach((trade, i) => {
    const profitPct = (trade.profitPct || 0).toFixed(1);
    const profitSOL = (trade.profit || 0).toFixed(4);
    const profitUSD = ((trade.profit || 0) * state.solPrice).toFixed(2);
    const symbol = trade.symbol || 'Unknown';
    const isWin = (trade.profit || 0) > 0;
    const color = isWin ? 'green' : 'red';
    const sign = isWin ? '+' : '';
    const duration = trade.exitTime && trade.entryTime
      ? Math.round((trade.exitTime - trade.entryTime) / 1000 / 60)
      : 0;
    const timeAgo = trade.exitTime
      ? getTimeAgo(trade.exitTime)
      : 'Unknown';
    
    content += `{bold}${symbol}{/bold} {${color}-fg}${sign}${profitPct}%{/} `;
    content += `(${sign}${profitSOL} SOL) `;
    content += `${duration}m • ${timeAgo}\n`;
  });
  
  if (recentTrades.length === 0) {
    content = '{gray-fg}No trades yet{/}';
  }
  
  recentPanel.setContent(content);
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function updateSOLPrice() {
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const data = await response.json();
    if (data.pairs && data.pairs[0]) {
      state.solPrice = parseFloat(data.pairs[0].priceUsd);
    }
  } catch (error) {
    // Keep existing price if fetch fails
  }
}

async function updateAll() {
  await updateSOLPrice();
  analyzePerformance();
  
  updateOverallPanel();
  updateRatioPanel();
  updateSizePanel();
  updateBestPanel();
  updateWorstPanel();
  updateRecentPanel();
  
  screen.render();
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════

screen.key(['escape', 'q', 'C-c'], () => {
  return process.exit(0);
});

screen.key(['r', 'R'], () => {
  updateAll();
});

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════

console.log('📊 Starting Performance Monitor...');
console.log('Press Q to quit, R to refresh');

// Initial update
updateAll();

// Update every 5 seconds
setInterval(updateAll, 5000);

screen.render();
