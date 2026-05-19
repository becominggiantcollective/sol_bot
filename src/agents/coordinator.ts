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
import { config } from '../config/index.js';
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
import {
  AgentIdentityRegistry,
  TrustlessSettlementManager,
  canonicalizeIntentData,
  computeSha256Hex,
  shouldUseTrustlessPath,
  validateExecutionProofBundle,
} from './trustless.js';

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
  private readonly opportunityIntentHashes = new Map<string, string>();

  // Trustless controls
  private readonly trustlessEnabled: boolean;
  private readonly trustlessShadowMode: boolean;
  private readonly trustlessEnforceSignatures: boolean;
  private readonly trustlessAutoFinalize: boolean;
  private readonly identityRegistry: AgentIdentityRegistry;
  private readonly settlementManager: TrustlessSettlementManager | null;

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
    this.trustlessEnabled = shouldUseTrustlessPath();
    this.trustlessShadowMode = config.trustless?.shadowMode ?? true;
    this.trustlessEnforceSignatures = config.trustless?.enforceSignatures ?? false;
    this.trustlessAutoFinalize = config.trustless?.autoFinalize ?? true;
    this.identityRegistry = new AgentIdentityRegistry();
    const settlementProgramId = config.trustless?.settlementProgramId || '';
    if (this.trustlessEnabled && !settlementProgramId) {
      throw new Error(
        'TRUSTLESS_SETTLEMENT_PROGRAM_ID must be set when TRUSTLESS_ENABLED=true'
      );
    }
    this.settlementManager = this.trustlessEnabled
      ? new TrustlessSettlementManager(
          settlementProgramId,
          config.trustless?.executionTimeoutMs ?? 30_000,
          config.trustless?.disputeWindowMs ?? 15_000
        )
      : null;

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
    this.identityRegistry.register(this.marketAnalyst.id, this.marketAnalyst.role);
    this.identityRegistry.register(this.arbitrageScout.id, this.arbitrageScout.role);
    this.identityRegistry.register(this.riskManager.id, this.riskManager.role);
    this.identityRegistry.register(this.executionAgent.id, this.executionAgent.role);

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
    if (!this.verifyTrustlessSignal(signal)) {
      return;
    }

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
    if (signal.intent?.hash) {
      this.opportunityIntentHashes.set(opportunityId, signal.intent.hash);
    }

    this.logger.info(
      `[AgentCoordinator] opportunity received (id=${opportunityId}, ` +
        `profit=${(opportunity.profitPercent * 100).toFixed(3)}%) – requesting risk assessment`
    );

    // Ask risk manager to evaluate
    const request: RiskAssessmentRequest = {
      opportunityId,
      opportunity,
      marketCondition: this.latestMarketCondition ?? undefined,
      trustlessOpportunityIntentHash: this.opportunityIntentHashes.get(opportunityId),
    };

    const requestSignal: AgentSignal = {
      id: generateId(),
      agentId: 'coordinator',
      agentRole: 'coordinator',
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
      this.opportunityIntentHashes.delete(assessment.opportunityId);
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

    if (this.trustlessEnabled) {
      const opportunityIntentHash =
        this.opportunityIntentHashes.get(assessment.opportunityId) ??
        computeSha256Hex(canonicalizeIntentData(opportunity));
      if (!this.opportunityIntentHashes.get(assessment.opportunityId)) {
        this.logger.warn(
          `[AgentCoordinator] trustless fallback hash used for opportunity ${assessment.opportunityId}`
        );
      }
      const escrow = this.settlementManager?.openEscrow(
        assessment.opportunityId,
        opportunityIntentHash
      );
      if (escrow) {
        this.logger.info(
          `[AgentCoordinator] trustless escrow opened pda=${escrow.escrowPda} ` +
            `execDeadline=${escrow.executionDeadlineMs} disputeDeadline=${escrow.disputeDeadlineMs}`
        );
      }
    }
    this.opportunityIntentHashes.delete(assessment.opportunityId);

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

    if (this.trustlessEnabled) {
      if (!result.success) {
        this.settlementManager?.finalize(result.opportunityId, 'cancel');
      }
      const proofValidation = validateExecutionProofBundle(result.proof);
      if (!proofValidation.ok) {
        this.metrics.executionsFailed++;
        this.logger.warn(
          `[AgentCoordinator] trustless proof rejected for ${result.opportunityId}: ${proofValidation.reason}`
        );
        this.settlementManager?.finalize(
          result.opportunityId,
          result.success ? 'slash' : 'cancel'
        );
        return;
      }

      const proofHash = computeSha256Hex(canonicalizeIntentData(result.proof));
      const record = this.settlementManager?.markProofSubmitted(
        result.opportunityId,
        proofHash
      );

      if (!record) {
        this.metrics.executionsFailed++;
        this.logger.warn(
          `[AgentCoordinator] trustless settlement missing for ${result.opportunityId}`
        );
        return;
      }

      if (record.status === 'timed-out') {
        this.metrics.executionsFailed++;
        this.logger.warn(
          `[AgentCoordinator] trustless settlement timed out for ${result.opportunityId}`
        );
        return;
      }

      if (this.trustlessAutoFinalize && record.status === 'pending-dispute') {
        const finalized = this.settlementManager?.finalize(
          result.opportunityId,
          'release',
          Date.now()
        );
        if (!finalized) {
          this.logger.info(
            `[AgentCoordinator] trustless dispute window active for ${result.opportunityId}; finalization deferred`
          );
        }
      } else if (record.status === 'pending-dispute') {
        this.logger.info(
          `[AgentCoordinator] trustless settlement pending dispute window for ${result.opportunityId}`
        );
      }
    }

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

  private verifyTrustlessSignal(signal: AgentSignal): boolean {
    if (!this.trustlessEnabled) return true;
    if (
      signal.type !== 'arbitrage-opportunity' &&
      signal.type !== 'risk-assessment' &&
      signal.type !== 'execution-result'
    ) {
      return true;
    }

    const verification = this.identityRegistry.verify(signal);
    if (verification.ok) return true;

    if (this.trustlessShadowMode || !this.trustlessEnforceSignatures) {
      this.logger.warn(
        `[AgentCoordinator] trustless verification warning (${signal.type}): ${verification.reason}`
      );
      return true;
    }

    this.logger.warn(
      `[AgentCoordinator] trustless verification rejected (${signal.type}): ${verification.reason}`
    );
    return false;
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
