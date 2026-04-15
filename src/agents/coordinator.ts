/**
 * AgentCoordinator
 *
 * The central nervous system of the multi-agent trading system.
 * It wires together the MarketAnalystAgent, ArbitrageScoutAgent,
 * RiskManagerAgent, and ExecutionAgent via a shared EventEmitter bus.
 *
 * Signal lifecycle:
 *   1. MarketAnalystAgent emits `market-condition`
 *      → Coordinator stores the latest condition
 *   2. ArbitrageScoutAgent emits `arbitrage-opportunity`
 *      → Coordinator forwards as `risk-assessment-request` to RiskManagerAgent
 *   3. RiskManagerAgent emits `risk-assessment`
 *      → If approved, Coordinator calls ExecutionAgent.executeApproved()
 *   4. ExecutionAgent emits `execution-result`
 *      → Coordinator logs + updates metrics
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/index.js';
import { SolanaConnection } from '../core/connection.js';
import { FlashloanManager } from '../core/flashloan.js';
import { DirectSwapStrategy } from '../strategies/direct-swap.js';
import {
  FlashloanArbitrageStrategy,
  SandwichAttackStrategy,
} from '../strategies/mev.js';
import { ArbitrageOpportunity } from '../types/index.js';
import {
  AgentSignal,
  ExecutionResult,
  MarketCondition,
  RiskAssessment,
  RiskAssessmentRequest,
  TradingAgent,
} from './types.js';
import { MarketAnalystAgent } from './market-analyst.js';
import { ArbitrageScoutAgent } from './arbitrage-scout.js';
import { RiskManagerAgent } from './risk-manager.js';
import { ExecutionAgent } from './execution-agent.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface CoordinatorMetrics {
  opportunitiesReceived: number;
  opportunitiesApproved: number;
  opportunitiesDenied: number;
  executionsSucceeded: number;
  executionsFailed: number;
  totalProfitEstimate: number;
  startedAt: number;
}

export class AgentCoordinator {
  private readonly logger: Logger;
  private readonly emitter: EventEmitter;

  // Agents
  private readonly marketAnalyst: MarketAnalystAgent;
  private readonly arbitrageScout: ArbitrageScoutAgent;
  private readonly riskManager: RiskManagerAgent;
  private readonly executionAgent: ExecutionAgent;

  // State
  private latestMarketCondition: MarketCondition | null = null;
  /** Map from opportunityId → opportunity (waiting for risk assessment) */
  private pendingOpportunities: Map<string, ArbitrageOpportunity> = new Map();

  private metrics: CoordinatorMetrics = {
    opportunitiesReceived: 0,
    opportunitiesApproved: 0,
    opportunitiesDenied: 0,
    executionsSucceeded: 0,
    executionsFailed: 0,
    totalProfitEstimate: 0,
    startedAt: Date.now(),
  };

  constructor(connection: SolanaConnection, flashloanManager: FlashloanManager) {
    this.logger = Logger.getInstance();
    this.emitter = new EventEmitter();

    // Build ordered strategy list (DirectSwap → FlashloanArbitrage → Sandwich)
    const strategies = [
      new DirectSwapStrategy(connection),
      new FlashloanArbitrageStrategy(connection, flashloanManager),
      new SandwichAttackStrategy(connection),
    ];

    // Instantiate agents
    this.marketAnalyst = new MarketAnalystAgent(this.emitter);
    this.arbitrageScout = new ArbitrageScoutAgent(this.emitter);
    this.riskManager = new RiskManagerAgent(this.emitter);
    this.executionAgent = new ExecutionAgent(this.emitter, strategies);

    // Wire up signal routing
    this.emitter.on('agent-signal', (signal: AgentSignal) => {
      this.route(signal);
    });
  }

  /** Start all agents concurrently */
  async start(): Promise<void> {
    this.logger.info('[AgentCoordinator] starting multi-agent trading system…');
    this.metrics.startedAt = Date.now();

    const agents: TradingAgent[] = [
      this.marketAnalyst,
      this.arbitrageScout,
      this.riskManager,
      this.executionAgent,
    ];

    // Start agents that have polling loops; start execution/risk synchronously
    await this.riskManager.start();
    await this.executionAgent.start();

    // Market analyst and scout run their own loops – don't await them here
    this.marketAnalyst.start().catch(err =>
      this.logger.error('[AgentCoordinator] MarketAnalystAgent crashed:', err)
    );
    this.arbitrageScout.start().catch(err =>
      this.logger.error('[AgentCoordinator] ArbitrageScoutAgent crashed:', err)
    );

    this.logger.info(`[AgentCoordinator] all ${agents.length} agents started`);
  }

  /** Gracefully stop all agents */
  stop(): void {
    this.logger.info('[AgentCoordinator] stopping all agents…');
    this.marketAnalyst.stop();
    this.arbitrageScout.stop();
    this.riskManager.stop();
    this.executionAgent.stop();
    this.emitter.removeAllListeners();
    this.logMetrics();
  }

  getMetrics(): CoordinatorMetrics {
    return { ...this.metrics };
  }

  // ---------------------------------------------------------------------------
  // Signal routing
  // ---------------------------------------------------------------------------

  private route(signal: AgentSignal): void {
    switch (signal.type) {
      case 'market-condition':
        this.handleMarketCondition(signal);
        break;

      case 'arbitrage-opportunity':
        this.handleArbitrageOpportunity(signal);
        break;

      case 'risk-assessment':
        this.handleRiskAssessment(signal);
        break;

      case 'execution-result':
        this.handleExecutionResult(signal);
        break;

      default:
        // Forward all other signals to every agent for extensibility
        this.broadcast(signal);
    }
  }

  private handleMarketCondition(signal: AgentSignal): void {
    this.latestMarketCondition = signal.data as MarketCondition;
    this.logger.debug(
      `[AgentCoordinator] market condition: trend=${this.latestMarketCondition.trend} ` +
        `volatility=${this.latestMarketCondition.volatility} ` +
        `risk=${this.latestMarketCondition.riskLevel.toFixed(2)}`
    );
    // Forward to risk manager so it can factor market conditions into assessments
    this.riskManager.onSignal(signal);
  }

  private handleArbitrageOpportunity(signal: AgentSignal): void {
    const opportunity = signal.data as ArbitrageOpportunity;
    const opportunityId = signal.id;
    this.metrics.opportunitiesReceived++;

    // Store opportunity keyed by signal id
    this.pendingOpportunities.set(opportunityId, opportunity);

    this.logger.info(
      `[AgentCoordinator] opportunity received (id=${opportunityId}, ` +
        `profit=${(opportunity.profitPercent * 100).toFixed(3)}%) – requesting risk assessment`
    );

    // Ask risk manager to evaluate
    const request: RiskAssessmentRequest = {
      opportunityId,
      opportunity,
      marketCondition: this.latestMarketCondition ?? undefined,
    };

    const requestSignal: AgentSignal = {
      id: generateId(),
      agentId: 'coordinator',
      agentRole: 'arbitrage-scout',
      type: 'risk-assessment-request',
      data: request,
      confidence: signal.confidence,
      timestamp: Date.now(),
    };

    this.riskManager.onSignal(requestSignal);
  }

  private handleRiskAssessment(signal: AgentSignal): void {
    const assessment = signal.data as RiskAssessment;

    if (!assessment.approved) {
      this.metrics.opportunitiesDenied++;
      this.logger.debug(
        `[AgentCoordinator] opportunity ${assessment.opportunityId} denied: ${assessment.reason}`
      );
      this.pendingOpportunities.delete(assessment.opportunityId);
      return;
    }

    const opportunity = this.pendingOpportunities.get(assessment.opportunityId);
    if (!opportunity) {
      this.logger.warn(
        `[AgentCoordinator] risk assessment for unknown opportunity ${assessment.opportunityId}`
      );
      return;
    }

    this.metrics.opportunitiesApproved++;
    this.pendingOpportunities.delete(assessment.opportunityId);

    this.logger.info(
      `[AgentCoordinator] ✅ opportunity ${assessment.opportunityId} approved ` +
        `(risk=${assessment.riskScore.toFixed(2)}, maxSize=$${assessment.maxPositionSize.toFixed(0)}) – executing`
    );

    // Delegate to execution agent
    this.executionAgent.executeApproved(opportunity, assessment).catch(err =>
      this.logger.error('[AgentCoordinator] execution error:', err)
    );
  }

  private handleExecutionResult(signal: AgentSignal): void {
    const result = signal.data as ExecutionResult;

    if (result.success) {
      this.metrics.executionsSucceeded++;
      this.metrics.totalProfitEstimate += result.profit ?? 0;
      this.logger.info(
        `[AgentCoordinator] 💰 execution succeeded: ${result.signature} ` +
          `profit≈$${(result.profit ?? 0).toFixed(4)} (${result.executionTimeMs}ms)`
      );
    } else {
      this.metrics.executionsFailed++;
      this.logger.warn(
        `[AgentCoordinator] execution failed: ${result.error} (${result.executionTimeMs}ms)`
      );
    }
  }

  private broadcast(signal: AgentSignal): void {
    for (const agent of [
      this.marketAnalyst,
      this.arbitrageScout,
      this.riskManager,
      this.executionAgent,
    ]) {
      agent.onSignal(signal);
    }
  }

  private logMetrics(): void {
    const uptimeSec = Math.round((Date.now() - this.metrics.startedAt) / 1000);
    this.logger.info('[AgentCoordinator] ─── Final Metrics ───');
    this.logger.info(`  Uptime:               ${uptimeSec}s`);
    this.logger.info(`  Opportunities found:  ${this.metrics.opportunitiesReceived}`);
    this.logger.info(`  Approved:             ${this.metrics.opportunitiesApproved}`);
    this.logger.info(`  Denied:               ${this.metrics.opportunitiesDenied}`);
    this.logger.info(`  Executions succeeded: ${this.metrics.executionsSucceeded}`);
    this.logger.info(`  Executions failed:    ${this.metrics.executionsFailed}`);
    this.logger.info(
      `  Profit estimate:      $${this.metrics.totalProfitEstimate.toFixed(4)}`
    );
    this.logger.info('[AgentCoordinator] ────────────────────');
  }
}
