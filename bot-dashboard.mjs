#!/usr/bin/env node
/**
 * 🎛️ SOL BOT DASHBOARD - Interactive Control Panel
 * A beautiful terminal UI for monitoring and controlling the trading bot
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  refreshInterval: 5000,      // Refresh every 5 seconds
  maxLogLines: 100,           // Max log lines to keep
  balanceFile: 'positions.json',
  mlModelFile: 'ml-model.json'
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let state = {
  botRunning: false,
  botProcess: null,
  scanCount: 0,
  tokens: [],
  priceHistory: [],
  logs: [],
  stats: {
    totalScans: 0,
    opportunities: 0,
    hotTokens: 0,
    dumpingTokens: 0
  },
  balance: {
    sol: 0,
    usd: 0
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CREATE SCREEN
// ═══════════════════════════════════════════════════════════════════════════

const screen = blessed.screen({
  smartCSR: true,
  title: '🤖 SOL Bot Dashboard',
  fullUnicode: true
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE GRID LAYOUT
// ═══════════════════════════════════════════════════════════════════════════

const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

// ═══════════════════════════════════════════════════════════════════════════
// HEADER BOX
// ═══════════════════════════════════════════════════════════════════════════

const headerBox = grid.set(0, 0, 1, 12, blessed.box, {
  content: '{center}{bold} 🤖 SOL MEMECOIN BOT - DASHBOARD {/bold}{/center}',
  tags: true,
  style: {
    fg: 'white',
    bg: 'blue',
    bold: true
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BOX
// ═══════════════════════════════════════════════════════════════════════════

const statusBox = grid.set(1, 0, 2, 3, blessed.box, {
  label: ' 📊 Status ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE BOX
// ═══════════════════════════════════════════════════════════════════════════

const balanceBox = grid.set(1, 3, 2, 3, blessed.box, {
  label: ' 💰 Balance ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'green' },
    label: { fg: 'green', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATS BOX
// ═══════════════════════════════════════════════════════════════════════════

const statsBox = grid.set(1, 6, 2, 3, blessed.box, {
  label: ' 📈 Stats ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'yellow' },
    label: { fg: 'yellow', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS BOX
// ═══════════════════════════════════════════════════════════════════════════

const controlsBox = grid.set(1, 9, 2, 3, blessed.box, {
  label: ' ⌨️ Controls ',
  tags: true,
  border: { type: 'line' },
  content: '{cyan-fg}[S]{/} Start/Stop\n{cyan-fg}[R]{/} Refresh\n{cyan-fg}[Q]{/} Quit',
  style: {
    border: { fg: 'magenta' },
    label: { fg: 'magenta', bold: true }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN TABLE
// ═══════════════════════════════════════════════════════════════════════════

const tokenTable = grid.set(3, 0, 5, 8, contrib.table, {
  label: ' 🪙 Live Token Monitor ',
  keys: true,
  fg: 'white',
  selectedFg: 'black',
  selectedBg: 'cyan',
  interactive: true,
  columnSpacing: 2,
  columnWidth: [14, 10, 10, 8, 8, 9, 10, 4],
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    header: { fg: 'cyan', bold: true },
    cell: { fg: 'white' }
  }
});

tokenTable.setData({
  headers: ['Token', 'Liquidity', 'Volume', '5min', '1hr', '24hr', 'Potential', ''],
  data: [['Loading...', '', '', '', '', '', '', '']]
});

// ═══════════════════════════════════════════════════════════════════════════
// PRICE CHART (Sparkline)
// ═══════════════════════════════════════════════════════════════════════════

const priceChart = grid.set(3, 8, 3, 4, contrib.sparkline, {
  label: ' 📉 Market Activity ',
  tags: true,
  style: {
    fg: 'cyan',
    border: { fg: 'cyan' }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OPPORTUNITY GAUGE
// ═══════════════════════════════════════════════════════════════════════════

const opportunityGauge = grid.set(6, 8, 2, 4, contrib.gauge, {
  label: ' 🎯 Opportunity Score ',
  stroke: 'green',
  fill: 'white',
  border: { type: 'line' },
  style: {
    border: { fg: 'green' }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG BOX
// ═══════════════════════════════════════════════════════════════════════════

const logBox = grid.set(8, 0, 4, 8, contrib.log, {
  label: ' 📜 Activity Log ',
  fg: 'green',
  selectedFg: 'green',
  border: { type: 'line' },
  style: {
    border: { fg: 'green' }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HOT TOKENS DONUT
// ═══════════════════════════════════════════════════════════════════════════

const donut = grid.set(8, 8, 4, 4, contrib.donut, {
  label: ' 🔥 Token Sentiment ',
  radius: 8,
  arcWidth: 3,
  remainColor: 'black',
  yPadding: 2,
  border: { type: 'line' },
  style: {
    border: { fg: 'yellow' }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function updateStatus() {
  const botStatus = state.botRunning 
    ? '{green-fg}● RUNNING{/green-fg}' 
    : '{red-fg}○ STOPPED{/red-fg}';
  
  const time = new Date().toLocaleTimeString();
  
  statusBox.setContent(
    `Bot: ${botStatus}\n` +
    `Time: {white-fg}${time}{/}\n` +
    `Scans: {cyan-fg}${state.scanCount}{/}`
  );
}

function updateBalance() {
  // Try to read balance from positions file
  try {
    if (fs.existsSync(CONFIG.balanceFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.balanceFile, 'utf8'));
      state.balance.sol = data.balance || 0;
      state.balance.usd = data.balanceUsd || 0;
    }
  } catch (e) {}

  balanceBox.setContent(
    `SOL: {yellow-fg}${state.balance.sol.toFixed(4)}{/}\n` +
    `USD: {green-fg}$${state.balance.usd.toFixed(2)}{/}\n` +
    `Gas: {red-fg}~$0.40{/}`
  );
}

function updateStats() {
  statsBox.setContent(
    `Total: {cyan-fg}${state.stats.totalScans}{/}\n` +
    `🔥 Hot: {green-fg}${state.stats.hotTokens}{/}\n` +
    `📉 Dump: {red-fg}${state.stats.dumpingTokens}{/}`
  );
}

function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const prefix = {
    info: '{cyan-fg}ℹ{/}',
    success: '{green-fg}✓{/}',
    warning: '{yellow-fg}⚠{/}',
    error: '{red-fg}✗{/}',
    hot: '{red-fg}🔥{/}'
  }[type] || '{white-fg}→{/}';
  
  logBox.log(`${time} ${prefix} ${message}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH TOKEN DATA
// ═══════════════════════════════════════════════════════════════════════════

async function fetchTokenData() {
  state.scanCount++;
  state.stats.totalScans++;
  
  try {
    const tokensRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    const tokens = await tokensRes.json();
    const solTokens = tokens.filter(t => t.chainId === 'solana').slice(0, 10);
    
    const tableData = [];
    let hotCount = 0;
    let dumpCount = 0;
    let totalChange = 0;
    
    for (const token of solTokens) {
      try {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
        const pairData = await pairRes.json();
        const pair = pairData.pairs && pairData.pairs[0];
        
        if (!pair) continue;
        
        const symbol = (pair.baseToken?.symbol || 'UNK').substring(0, 12);
        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const p5m = pair.priceChange?.m5 || 0;
        const p1h = pair.priceChange?.h1 || 0;
        const p24h = pair.priceChange?.h24 || 0;
        
        const liqStr = liq >= 1000 ? '$' + (liq/1000).toFixed(0) + 'K' : '$' + liq.toFixed(0);
        const volStr = vol >= 1000 ? '$' + (vol/1000).toFixed(0) + 'K' : '$' + vol.toFixed(0);
        
        const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
        const potential = 5 * (p5m / 100);
        const potStr = (potential >= 0 ? '+$' : '-$') + Math.abs(potential).toFixed(2);
        
        let indicator = '  ';
        if (p5m > 10 && liq > 5000) {
          indicator = '🔥';
          hotCount++;
          log(`HOT: ${symbol} up ${p5m.toFixed(1)}% in 5min!`, 'hot');
        } else if (p5m > 5 && liq > 10000) {
          indicator = '⬆️';
        } else if (p5m < -10) {
          indicator = '📉';
          dumpCount++;
        }
        
        totalChange += p5m;
        
        tableData.push([
          symbol,
          liqStr,
          volStr,
          fmt(p5m),
          fmt(p1h),
          fmt(p24h),
          potStr,
          indicator
        ]);
        
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 80));
        
      } catch (e) {
        // Skip failed tokens silently
      }
    }
    
    state.stats.hotTokens = hotCount;
    state.stats.dumpingTokens = dumpCount;
    
    // Update price history for sparkline
    state.priceHistory.push(Math.abs(totalChange));
    if (state.priceHistory.length > 30) state.priceHistory.shift();
    
    // Update table
    if (tableData.length > 0) {
      tokenTable.setData({
        headers: ['Token', 'Liquidity', 'Volume', '5min', '1hr', '24hr', 'Potential', ''],
        data: tableData
      });
    }
    
    // Update sparkline
    priceChart.setData(['Activity'], [state.priceHistory]);
    
    // Update donut chart
    const total = hotCount + dumpCount + Math.max(1, tableData.length - hotCount - dumpCount);
    donut.setData([
      { percent: (hotCount / total) * 100, label: 'Hot', color: 'green' },
      { percent: (dumpCount / total) * 100, label: 'Dump', color: 'red' },
      { percent: ((total - hotCount - dumpCount) / total) * 100, label: 'Neutral', color: 'yellow' }
    ]);
    
    // Update opportunity gauge
    const oppScore = Math.min(100, Math.max(0, (hotCount * 30) + (totalChange > 0 ? 20 : 0)));
    opportunityGauge.setPercent(oppScore);
    
    log(`Scan #${state.scanCount} complete - Found ${tableData.length} tokens`, 'info');
    
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
  }
  
  updateStatus();
  updateBalance();
  updateStats();
  screen.render();
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT CONTROL
// ═══════════════════════════════════════════════════════════════════════════

function startBot() {
  if (state.botRunning) {
    log('Bot is already running', 'warning');
    return;
  }
  
  state.botRunning = true;
  log('Starting bot monitoring...', 'success');
  
  // Start periodic scanning
  state.scanInterval = setInterval(fetchTokenData, CONFIG.refreshInterval);
  fetchTokenData(); // Initial fetch
  
  updateStatus();
  screen.render();
}

function stopBot() {
  if (!state.botRunning) {
    log('Bot is not running', 'warning');
    return;
  }
  
  state.botRunning = false;
  
  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }
  
  log('Bot monitoring stopped', 'warning');
  updateStatus();
  screen.render();
}

function toggleBot() {
  if (state.botRunning) {
    stopBot();
  } else {
    startBot();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

screen.key(['escape', 'q', 'C-c'], () => {
  stopBot();
  return process.exit(0);
});

screen.key(['s', 'S'], () => {
  toggleBot();
});

screen.key(['r', 'R'], () => {
  log('Manual refresh triggered', 'info');
  fetchTokenData();
});

screen.key(['h', 'H', '?'], () => {
  log('Commands: [S]tart/Stop, [R]efresh, [Q]uit', 'info');
});

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════

function init() {
  // Set initial balance
  state.balance.sol = 0.025;
  state.balance.usd = 5.00;
  
  // Update all displays
  updateStatus();
  updateBalance();
  updateStats();
  
  // Set initial data
  opportunityGauge.setPercent(0);
  priceChart.setData(['Activity'], [[0, 0, 0, 0, 0]]);
  donut.setData([
    { percent: 33, label: 'Hot', color: 'green' },
    { percent: 33, label: 'Dump', color: 'red' },
    { percent: 34, label: 'Neutral', color: 'yellow' }
  ]);
  
  log('Dashboard initialized', 'success');
  log('Press [S] to start monitoring', 'info');
  log('Press [Q] or ESC to quit', 'info');
  
  screen.render();
  
  // Focus on token table for navigation
  tokenTable.focus();
}

// Start the dashboard
init();
