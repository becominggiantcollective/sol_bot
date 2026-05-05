/**
 * RiskManagerAgent
 *
 * Evaluates every `risk-assessment-request` signal from the coordinator,
 * applies position-sizing rules and market-condition overlays, then
 * emits a `risk-assessment` signal back so the coordinator knows whether
 * to proceed with the trade and at what size.
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/index.js';
import { config } from '../config/index.js';
import { ArbitrageOpportunity } from '../types/index.js';
import {
  AgentRole,
  AgentStatus,
  AgentSignal,
  MarketCondition,
  RiskAssessment,
  RiskAssessmentRequest,
  TradingAgent,
} from './types.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class RiskManagerAgent implements TradingAgent {
  readonly id: string;
  readonly role: AgentRole = 'risk-manager';
  status: AgentStatus = 'idle';

  private readonly logger: Logger;
  private readonly emitter: EventEmitter;

  private running = false;
  private lastMarketCondition: MarketCondition | null = null;
  private assessmentsApproved = 0;
  private assessmentsDenied = 0;

  constructor(emitter: EventEmitter) {
    this.id = `risk-manager-${generateId()}`;
    this.logger = Logger.getInstance();
    this.emitter = emitter;
  }

  async start(): Promise<void> {
    this.running = true;
    this.status = 'running';
    this.logger.info('[RiskManagerAgent] started – listening for assessment requests');
    // This agent is event-driven; no polling loop required.
  }

  stop(): void {
    this.running = false;
    this.status = 'idle';
    this.logger.info(
      `[RiskManagerAgent] stopped (approved=${this.assessmentsApproved}, denied=${this.assessmentsDenied})`
    );
  }

  onSignal(signal: AgentSignal): void {
    if (!this.running) return;

    if (signal.type === 'market-condition') {
      this.lastMarketCondition = signal.data as MarketCondition;
      return;
    }

    if (signal.type === 'risk-assessment-request') {
      const request = signal.data as RiskAssessmentRequest;
      const assessment = this.assess(request);
      this.emitAssessment(assessment);
    }
  }

  getStats(): { approved: number; denied: number } {
    return {
      approved: this.assessmentsApproved,
      denied: this.assessmentsDenied,
    };
  }

  // ---------------------------------------------------------------------------
  // Core risk logic
  // ---------------------------------------------------------------------------

  private assess(request: RiskAssessmentRequest): RiskAssessment {
    const { opportunityId, opportunity, marketCondition } = request;
    const condition = marketCondition ?? this.lastMarketCondition;

    // 1. Base risk score from opportunity metrics
    const priceImpactRisk = this.priceImpactScore(opportunity);
    const profitabilityScore = this.profitabilityScore(opportunity);
    const marketRisk = condition ? condition.riskLevel * 0.3 : 0.15;

    const riskScore = Math.min(
      1,
      priceImpactRisk + (1 - profitabilityScore) * 0.3 + marketRisk
    );

    // 2. Hard rejection conditions
    if (riskScore >= 0.8) {
      this.assessmentsDenied++;
      return {
        opportunityId,
        approved: false,
        maxPositionSize: 0,
        recommendedSlippage: 0,
        riskScore,
        reason: `Risk score ${riskScore.toFixed(2)} exceeds threshold 0.8`,
      };
    }

    if (opportunity.profitPercent < config.trading.minProfitThreshold) {
      this.assessmentsDenied++;
      return {
        opportunityId,
        approved: false,
        maxPositionSize: 0,
        recommendedSlippage: 0,
        riskScore,
        reason: `Profit ${(opportunity.profitPercent * 100).toFixed(3)}% below min threshold ${(config.trading.minProfitThreshold * 100).toFixed(3)}%`,
      };
    }

    if (condition?.volatility === 'high' && opportunity.profit < 50) {
      this.assessmentsDenied++;
      return {
        opportunityId,
        approved: false,
        maxPositionSize: 0,
        recommendedSlippage: 0,
        riskScore,
        reason: 'High market volatility: minimum profit requirement not met',
      };
    }

    // 3. Approved – compute adjusted position size
    const baseMax = config.trading.maxPositionSize;
    // Scale down based on risk: higher risk → smaller position
    const sizeFactor = 1 - riskScore * 0.5;
    const maxPositionSize = Math.min(
      baseMax * sizeFactor,
      opportunity.inputAmount * 2
    );

    // Recommend slightly wider slippage tolerance in volatile conditions
    const baseSlippage = config.trading.maxSlippage;
    const recommendedSlippage =
      condition?.volatility === 'high'
        ? Math.min(baseSlippage * 1.5, 0.05)
        : baseSlippage;

    this.assessmentsApproved++;
    return {
      opportunityId,
      approved: true,
      maxPositionSize,
      recommendedSlippage,
      riskScore,
      reason: `Approved: risk=${riskScore.toFixed(2)}, profit=${(opportunity.profitPercent * 100).toFixed(3)}%`,
    };
  }

  private priceImpactScore(opp: ArbitrageOpportunity): number {
    const maxImpact = Math.max(...opp.route.map(r => r.priceImpact));
    return Math.min(0.5, maxImpact * 10); // 5% impact → 0.5 score
  }

  private profitabilityScore(opp: ArbitrageOpportunity): number {
    // Normalise profit% to [0, 1]; cap at 5%
    return Math.min(1, opp.profitPercent / 0.05);
  }

  private emitAssessment(assessment: RiskAssessment): void {
    const signal: AgentSignal = {
      id: generateId(),
      agentId: this.id,
      agentRole: this.role,
      type: 'risk-assessment',
      data: assessment,
      confidence: 1 - assessment.riskScore,
      timestamp: Date.now(),
    };
    this.emitter.emit('agent-signal', signal);
  }
}
