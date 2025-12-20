#!/usr/bin/env node
// View timing analytics from trades
import fs from 'fs';

console.log('📊 TIMING ANALYTICS\n');

try {
  const data = JSON.parse(fs.readFileSync('timing-analytics.json', 'utf8'));
  
  console.log(`Total trades recorded: ${data.trades.length}\n`);
  
  if (data.trades.length === 0) {
    console.log('No trades recorded yet. Run the bot to collect data.\n');
    process.exit(0);
  }
  
  // Show recent trades
  console.log('=== RECENT TRADES ===');
  const recent = data.trades.slice(-10);
  for (const t of recent) {
    const emoji = t.result === 'profit' ? '✅' : t.result === 'stoploss' ? '🔴' : '⏰';
    console.log(`${emoji} ${t.symbol}: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}% | Hold: ${t.holdTimeMin}min | Peak: +${(t.peakPct || 0).toFixed(1)}% | ${t.result}`);
  }
  
  // Show patterns
  console.log('\n=== TIMING PATTERNS ===');
  const p = data.patterns;
  
  if (p.avgTimeToProfit > 0) {
    console.log(`Avg time to hit profit:  ${(p.avgTimeToProfit / 60000).toFixed(1)} minutes`);
    console.log(`Avg time to peak:        ${(p.avgTimeToPeak / 60000).toFixed(1)} minutes`);
    console.log(`Avg peak gain:           +${p.avgPeakPct.toFixed(1)}%`);
  }
  
  if (p.rugPullAvgTime > 0) {
    console.log(`Avg time to rug/loss:    ${(p.rugPullAvgTime / 60000).toFixed(1)} minutes`);
  }
  
  if (p.profitWindowStart > 0) {
    console.log(`\n💡 RECOMMENDED PROFIT WINDOW:`);
    console.log(`   Start selling at: ${(p.profitWindowStart / 60000).toFixed(1)} min`);
    console.log(`   Exit by:          ${(p.profitWindowEnd / 60000).toFixed(1)} min`);
  }
  
  // Calculate win rate
  const wins = data.trades.filter(t => t.result === 'profit').length;
  const losses = data.trades.filter(t => t.result === 'stoploss').length;
  const timeouts = data.trades.filter(t => t.result === 'timeout').length;
  
  console.log('\n=== WIN/LOSS ===');
  console.log(`Wins:     ${wins} (${((wins/data.trades.length)*100).toFixed(0)}%)`);
  console.log(`Losses:   ${losses} (${((losses/data.trades.length)*100).toFixed(0)}%)`);
  console.log(`Timeouts: ${timeouts} (${((timeouts/data.trades.length)*100).toFixed(0)}%)`);
  
  // Total P&L
  const totalPnl = data.trades.reduce((sum, t) => sum + (t.pnlPct || 0), 0);
  console.log(`\nTotal P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%`);
  
} catch (e) {
  console.log('No timing data yet. Run the sniper to collect trade timing data.');
  console.log('\nThe bot will track:');
  console.log('  - How long until tokens hit profit target');
  console.log('  - Peak gains before rugging');
  console.log('  - Optimal exit timing window');
}
