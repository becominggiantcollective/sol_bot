/**
 * MarketAnalystAgent
 *
 * Continuously monitors on-chain market conditions – price trend, volatility,
 * and liquidity – then broadcasts a `market-condition` signal so the
 * coordinator and other agents can adapt their behaviour.
 */

import { EventEmitter } from 'events';
import { Logger, sleep } from '../utils/index.js';
import {
  AgentRole,
  AgentStatus,
  AgentSignal,
  MarketCondition,
  TradingAgent,
} from './types.js';

// Price samples for rolling-window calculations
const SAMPLE_WINDOW = 6; // number of price snapshots to keep

function generateId(): string {
  // Use a simple timestamp+random fallback when uuid is unavailable
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class MarketAnalystAgent implements TradingAgent {
  readonly id: string;
  readonly role: AgentRole = 'market-analyst';
  status: AgentStatus = 'idle';

  private readonly logger: Logger;
  private readonly emitter: EventEmitter;
  private readonly scanIntervalMs: number;

  private running = false;
  private priceHistory: number[] = [];
  private lastCondition: MarketCondition | null = null;

  constructor(emitter: EventEmitter, scanIntervalMs = 30_000) {
    this.id = `market-analyst-${generateId()}`;
    this.logger = Logger.getInstance();
    this.emitter = emitter;
    this.scanIntervalMs = scanIntervalMs;
  }

  async start(): Promise<void> {
    this.running = true;
    this.status = 'running';
    this.logger.info(`[MarketAnalystAgent] started (interval=${this.scanIntervalMs}ms)`);

    while (this.running) {
      try {
        const condition = await this.analyzeMarket();
        this.lastCondition = condition;
        this.emit(condition);
      } catch (err) {
        this.logger.warn(`[MarketAnalystAgent] analysis error: ${err}`);
        this.status = 'error';
      }
      await sleep(this.scanIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    this.status = 'idle';
    this.logger.info('[MarketAnalystAgent] stopped');
  }

  onSignal(_signal: AgentSignal): void {
    // Market analyst does not react to incoming signals in this implementation
  }

  /** Return the most recently computed market condition (may be null on startup) */
  getLastCondition(): MarketCondition | null {
    return this.lastCondition;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async analyzeMarket(): Promise<MarketCondition> {
    const solPrice = await this.fetchSolPrice();
    this.priceHistory.push(solPrice);
    if (this.priceHistory.length > SAMPLE_WINDOW) {
      this.priceHistory.shift();
    }

    const trend = this.computeTrend();
    const volatility = this.computeVolatility();
    const liquidity = this.assessLiquidity(solPrice);
    const riskLevel = this.computeRiskLevel(trend, volatility, liquidity);

    this.logger.debug(
      `[MarketAnalystAgent] SOL=$${solPrice.toFixed(2)} trend=${trend} vol=${volatility} liq=${liquidity} risk=${riskLevel.toFixed(2)}`
    );

    return {
      trend,
      volatility,
      liquidity,
      riskLevel,
      timestamp: Date.now(),
    };
  }

  /** Fetch the current SOL/USDC price from Jupiter's price API */
  private async fetchSolPrice(): Promise<number> {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    try {
      const response = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as {
        data?: { [key: string]: { price?: number } };
      };
      const price = json.data?.[SOL_MINT]?.price;
      if (price && price > 0) return price;
    } catch {
      // fall through to default
    }
    // Fallback: return last known price or a safe default
    return this.priceHistory.length > 0
      ? this.priceHistory[this.priceHistory.length - 1]
      : 150;
  }

  private computeTrend(): MarketCondition['trend'] {
    if (this.priceHistory.length < 2) return 'sideways';
    const first = this.priceHistory[0];
    const last = this.priceHistory[this.priceHistory.length - 1];
    const change = (last - first) / first;
    if (change > 0.01) return 'bullish';
    if (change < -0.01) return 'bearish';
    return 'sideways';
  }

  private computeVolatility(): MarketCondition['volatility'] {
    if (this.priceHistory.length < 2) return 'low';
    const mean =
      this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const variance =
      this.priceHistory.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
      this.priceHistory.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean; // coefficient of variation
    if (cv > 0.03) return 'high';
    if (cv > 0.01) return 'medium';
    return 'low';
  }

  private assessLiquidity(price: number): MarketCondition['liquidity'] {
    // Heuristic: higher SOL price typically correlates with more liquidity inflows
    if (price > 200) return 'high';
    if (price > 100) return 'medium';
    return 'low';
  }

  private computeRiskLevel(
    trend: MarketCondition['trend'],
    volatility: MarketCondition['volatility'],
    liquidity: MarketCondition['liquidity']
  ): number {
    const trendScore = trend === 'bearish' ? 0.4 : trend === 'sideways' ? 0.2 : 0;
    const volScore = volatility === 'high' ? 0.4 : volatility === 'medium' ? 0.2 : 0;
    const liqScore = liquidity === 'low' ? 0.2 : liquidity === 'medium' ? 0.1 : 0;
    return Math.min(1, trendScore + volScore + liqScore);
  }

  private emit(condition: MarketCondition): void {
    const signal: AgentSignal = {
      id: generateId(),
      agentId: this.id,
      agentRole: this.role,
      type: 'market-condition',
      data: condition,
      confidence: this.priceHistory.length >= SAMPLE_WINDOW ? 0.9 : 0.5,
      timestamp: Date.now(),
    };
    this.emitter.emit('agent-signal', signal);
  }
}
