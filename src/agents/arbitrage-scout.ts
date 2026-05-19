/**
 * ArbitrageScoutAgent
 *
 * Wraps the existing `detectOpportunities()` engine and broadcasts
 * `arbitrage-opportunity` signals for every profitable path it finds.
 * The coordinator decides which opportunities to act on.
 */

import { EventEmitter } from 'events';
import { Logger, sleep } from '../utils/index.js';
import { detectOpportunities } from '../core/arbitrage.js';
import {
  AgentRole,
  AgentStatus,
  AgentSignal,
  TradingAgent,
} from './types.js';
import { attachTrustlessEnvelope } from './trustless.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hasProfitPercent(
  value: unknown
): value is {
  profitPercent: number;
  profit: number;
  inputAmount: number;
  route: Array<{ priceImpact: number }>;
} & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    profitPercent?: unknown;
    profit?: unknown;
    inputAmount?: unknown;
    route?: unknown;
  };
  return (
    typeof candidate.profitPercent === 'number' &&
    typeof candidate.profit === 'number' &&
    typeof candidate.inputAmount === 'number' &&
    Array.isArray(candidate.route)
  );
}

export class ArbitrageScoutAgent implements TradingAgent {
  readonly id: string;
  readonly role: AgentRole = 'arbitrage-scout';
  status: AgentStatus = 'idle';

  private readonly logger: Logger;
  private readonly emitter: EventEmitter;
  private readonly scanIntervalMs: number;

  private running = false;
  private opportunitiesFound = 0;

  constructor(emitter: EventEmitter, scanIntervalMs = 10_000) {
    this.id = `arbitrage-scout-${generateId()}`;
    this.logger = Logger.getInstance();
    this.emitter = emitter;
    this.scanIntervalMs = scanIntervalMs;
  }

  async start(): Promise<void> {
    this.running = true;
    this.status = 'running';
    this.logger.info(`[ArbitrageScoutAgent] started (interval=${this.scanIntervalMs}ms)`);

    while (this.running) {
      try {
        await this.scan();
      } catch (err) {
        this.logger.warn(`[ArbitrageScoutAgent] scan error: ${err}`);
        this.status = 'error';
      }
      await sleep(this.scanIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    this.status = 'idle';
    this.logger.info(
      `[ArbitrageScoutAgent] stopped after finding ${this.opportunitiesFound} opportunities`
    );
  }

  onSignal(_signal: AgentSignal): void {
    // Scout does not react to incoming signals in this implementation
  }

  getTotalOpportunitiesFound(): number {
    return this.opportunitiesFound;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async scan(): Promise<void> {
    this.logger.debug('[ArbitrageScoutAgent] scanning for arbitrage opportunities…');

    const opportunities = await detectOpportunities();

    if (opportunities.length === 0) {
      this.logger.debug('[ArbitrageScoutAgent] no opportunities found');
      return;
    }

    this.logger.info(
      `[ArbitrageScoutAgent] found ${opportunities.length} opportunity/-ies`
    );

    for (const opp of opportunities) {
      this.opportunitiesFound++;
      this.emitOpportunity(opp);
    }
  }

  private emitOpportunity(opportunity: unknown): void {
    if (!hasProfitPercent(opportunity)) {
      this.logger.warn('[ArbitrageScoutAgent] skipping malformed opportunity payload');
      return;
    }
    // Confidence is proportional to profitability (capped at 0.95)
    const confidence = Math.min(0.95, opportunity.profitPercent * 10);

    const signal: AgentSignal = {
      id: generateId(),
      agentId: this.id,
      agentRole: this.role,
      type: 'arbitrage-opportunity',
      data: opportunity,
      confidence,
      timestamp: Date.now(),
    };
    this.emitter.emit('agent-signal', attachTrustlessEnvelope(signal));
  }
}
