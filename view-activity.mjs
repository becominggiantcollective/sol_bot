#!/usr/bin/env node
/**
 * ACTIVITY LOG VIEWER
 * Shows recent trading activity in easy-to-read format
 */

import fs from 'fs';

const colors = {
  PROFIT: '\x1b[32m',  // Green
  LOSS: '\x1b[31m',    // Red
  WARN: '\x1b[33m',    // Yellow
  ERROR: '\x1b[31m',   // Red
  INFO: '\x1b[36m',    // Cyan
  SUCCESS: '\x1b[32m', // Green
  reset: '\x1b[0m'
};

function viewActivityLog(lines = 50) {
  try {
    const logData = fs.readFileSync('sniper-activity.log', 'utf-8');
    const logLines = logData.trim().split('\n');
    const recent = logLines.slice(-lines);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`📋 RECENT ACTIVITY (Last ${recent.length} events)`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    let profits = [];
    let losses = [];
    let honeypots = 0;
    
    for (const line of recent) {
      // Parse log line
      const match = line.match(/\[(.*?)\] (.*?): (.*)/);
      if (!match) {
        console.log(line);
        continue;
      }
      
      const [, timestamp, type, message] = match;
      const time = new Date(timestamp).toLocaleTimeString();
      const color = colors[type] || colors.INFO;
      
      console.log(`${color}[${time}] ${type}:${colors.reset} ${message}`);
      
      // Track stats
      if (message.includes('SOLD') && message.includes('+')) {
        const profitMatch = message.match(/\+(\d+\.\d+)%/);
        if (profitMatch) profits.push(parseFloat(profitMatch[1]));
      } else if (message.includes('SOLD') && message.includes('-')) {
        const lossMatch = message.match(/-(\d+\.\d+)%/);
        if (lossMatch) losses.push(parseFloat(lossMatch[1]));
      } else if (message.includes('HONEYPOT')) {
        honeypots++;
      }
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 SESSION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const totalTrades = profits.length + losses.length;
    const winRate = totalTrades > 0 ? (profits.length / totalTrades * 100) : 0;
    const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    
    console.log(`Total Completed Trades: ${totalTrades}`);
    console.log(`${colors.PROFIT}Wins: ${profits.length} (Avg: +${avgProfit.toFixed(2)}%)${colors.reset}`);
    console.log(`${colors.LOSS}Losses: ${losses.length} (Avg: -${avgLoss.toFixed(2)}%)${colors.reset}`);
    console.log(`Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`${colors.ERROR}Honeypots Detected: ${honeypots}${colors.reset}`);
    
    if (totalTrades > 0) {
      const expectancy = (avgProfit * winRate / 100) - (avgLoss * (100 - winRate) / 100);
      const expectancyColor = expectancy > 0 ? colors.PROFIT : colors.LOSS;
      console.log(`\n${expectancyColor}Expectancy: ${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}% per trade${colors.reset}`);
    }
    
  } catch (error) {
    console.log('❌ No activity log found. Run sniper-safe.mjs first.');
    console.log('   Activity will be logged to: sniper-activity.log');
  }
}

// Get number of lines from command line arg
const numLines = parseInt(process.argv[2]) || 50;
viewActivityLog(numLines);

console.log('\n💡 Usage: node view-activity.mjs [number of lines]');
console.log('   Example: node view-activity.mjs 100\n');
