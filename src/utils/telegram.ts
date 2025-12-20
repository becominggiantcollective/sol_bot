/**
 * Telegram Alert System
 * Sends real-time notifications for opportunities and trades
 */

import axios from 'axios';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!(this.botToken && this.chatId);
    
    if (!this.enabled) {
      console.log('⚠️  Telegram notifications disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    } else {
      console.log('✅ Telegram notifications enabled');
      this.sendStartupMessage();
    }
  }

  // Public plain-text sender
  async sendMessage(message: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
    await this.send(message, parseMode);
  }

  private async send(message: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
    if (!this.enabled) return;

    try {
      await axios.post(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          chat_id: this.chatId,
          text: message,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        },
        { timeout: 5000 }
      );
    } catch (error) {
      console.error('Failed to send Telegram notification:', error instanceof Error ? error.message : error);
    }
  }

  async sendStartupMessage(): Promise<void> {
    const message = `
🚀 <b>BOT STARTED</b>

Time: ${new Date().toLocaleString()}
Mode: Flash Loan Scalper
Status: ✅ Active

💰 Optimizations:
• Dynamic Priority Fees (97.6% savings)
• ML Route Selection (54% potential)
• Sentiment Analysis (HF API)
• 5 Token Scanners

🎯 Config:
• Min Profit: 0.01%
• Scan Speed: 2s
• Max Position: $10k
• Slippage: 3%

🔍 Now hunting for opportunities...
    `.trim();

    await this.send(message);
  }

  async sendOpportunity(opportunity: {
    tokenA: string;
    tokenB: string;
    grossProfit: number;
    netProfit: number;
    netProfitUsd: number;
    spread: number;
    priorityFee?: number;
    mlRoute?: string;
    sentiment?: string;
  }): Promise<void> {
    const emoji = opportunity.netProfitUsd > 10 ? '🔥💰' : opportunity.netProfitUsd > 5 ? '💰' : '✅';
    
    const message = `
${emoji} <b>OPPORTUNITY FOUND!</b>

<b>Tokens:</b> ${opportunity.tokenA} → ${opportunity.tokenB}

<b>Profit:</b>
• Gross: ${opportunity.grossProfit.toFixed(2)}% / $${(opportunity.grossProfit * 100).toFixed(2)}
• Net: ${opportunity.netProfit.toFixed(2)}% / <b>$${opportunity.netProfitUsd.toFixed(2)}</b>
• Spread: ${opportunity.spread.toFixed(2)}%

<b>Optimizations:</b>
${opportunity.priorityFee ? `• Priority Fee: ${opportunity.priorityFee} µSOL` : ''}
${opportunity.mlRoute ? `• ML Route: ${opportunity.mlRoute}` : ''}
${opportunity.sentiment ? `• Sentiment: ${opportunity.sentiment}` : ''}

Time: ${new Date().toLocaleTimeString()}
    `.trim();

    await this.send(message);
  }

  async sendTrade(trade: {
    tokenA: string;
    tokenB: string;
    amount: number;
    profit: number;
    profitUsd: number;
    txSignature: string;
    success: boolean;
  }): Promise<void> {
    const emoji = trade.success ? '✅💵' : '❌';
    const status = trade.success ? 'EXECUTED' : 'FAILED';
    
    const message = `
${emoji} <b>TRADE ${status}</b>

<b>Pair:</b> ${trade.tokenA} → ${trade.tokenB}
<b>Amount:</b> $${trade.amount.toFixed(2)}
<b>Profit:</b> ${trade.profit.toFixed(2)}% / <b>$${trade.profitUsd.toFixed(2)}</b>

<b>TX:</b> <code>${trade.txSignature.substring(0, 16)}...</code>

Time: ${new Date().toLocaleTimeString()}
${trade.success ? '🎉 Profit added to wallet!' : ''}
    `.trim();

    await this.send(message);
  }

  async sendDailySummary(stats: {
    totalScans: number;
    opportunities: number;
    trades: number;
    successRate: number;
    totalProfit: number;
    bestTrade: number;
  }): Promise<void> {
    const message = `
📊 <b>DAILY SUMMARY</b>

<b>Activity:</b>
• Scans: ${stats.totalScans}
• Opportunities: ${stats.opportunities}
• Trades: ${stats.trades}
• Success Rate: ${stats.successRate.toFixed(1)}%

<b>Performance:</b>
• Total Profit: <b>$${stats.totalProfit.toFixed(2)}</b>
• Best Trade: $${stats.bestTrade.toFixed(2)}
• Avg per Trade: $${(stats.totalProfit / (stats.trades || 1)).toFixed(2)}

Date: ${new Date().toLocaleDateString()}
    `.trim();

    await this.send(message);
  }

  async sendError(error: string): Promise<void> {
    const message = `
❌ <b>ERROR ALERT</b>

${error}

Time: ${new Date().toLocaleTimeString()}
    `.trim();

    await this.send(message);
  }

  async sendLowBalance(balance: number): Promise<void> {
    const message = `
⚠️ <b>LOW BALANCE WARNING</b>

Current Balance: ${balance.toFixed(6)} SOL (~$${(balance * 200).toFixed(2)})

Please add funds to continue trading.

Time: ${new Date().toLocaleTimeString()}
    `.trim();

    await this.send(message);
  }
}

export const telegramNotifier = new TelegramNotifier();
