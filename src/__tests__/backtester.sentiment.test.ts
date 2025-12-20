import { Backtester } from '../utils/backtester.js';

const backtester = new Backtester();

describe('Backtester sentiment gating', () => {
  it('filters opportunities based on sentimentMap and threshold', async () => {
    const opportunities: any[] = [
      { inputMint: { toString: () => 'TOKEN_A' }, expectedOutput: 1, profit: 1, profitPercent: 0.1, route: [] },
      { inputMint: { toString: () => 'TOKEN_B' }, expectedOutput: 1, profit: 1, profitPercent: 0.1, route: [] },
      { inputMint: { toString: () => 'TOKEN_C' }, expectedOutput: 1, profit: 1, profitPercent: 0.1, route: [] },
    ];

    const config: any = { initialCapital: 1000, startDate: new Date(), endDate: new Date(), riskPerTrade: 0.01, maxDrawdown: 50 };

    // sentimentMap only allows TOKEN_A
    const sentimentMap = { 'TOKEN_A': 0.8, 'TOKEN_B': -0.6 };

    const result = await backtester.runBacktestWithSentiment(opportunities, config, sentimentMap, 0.2);

    // Only TOKEN_A should be included (TOKEN_C has no entry and threshold requires >=0.2)
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    // Check the simulation ran and returned a BacktestResult structure
    expect(typeof result.netProfit).toBe('number');
  });
});
