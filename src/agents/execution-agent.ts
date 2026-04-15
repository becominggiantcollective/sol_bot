/**
 * ExecutionAgent
 *
 * Receives approved opportunities from the coordinator (via `onSignal`)
 * and executes them using the highest-viability MEVStrategy available.
 * Emits an `execution-result` signal once done.
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/index.js';
import { MEVStrategy, ArbitrageOpportunity } from '../types/index.js';
import {
  AgentRole,
  AgentStatus,
  AgentSignal,
  ExecutionResult,
  RiskAssessment,
  TradingAgent,
} from './types.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ExecutionAgent implements TradingAgent {
  readonly id: string;
  readonly role: AgentRole = 'execution';
  status: AgentStatus = 'idle';

  private readonly logger: Logger;
  private readonly emitter: EventEmitter;
  private readonly strategies: MEVStrategy[];

  private running = false;
  private successCount = 0;
  private failureCount = 0;

  constructor(emitter: EventEmitter, strategies: MEVStrategy[]) {
    this.id = `execution-agent-${generateId()}`;
    this.logger = Logger.getInstance();
    this.emitter = emitter;
    // Order matters: strategies are tried in the order provided.
    // Recommended order: DirectSwap → FlashloanArbitrage → SandwichAttack
    this.strategies = strategies;
  }

  async start(): Promise<void> {
    this.running = true;
    this.status = 'running';
    this.logger.info('[ExecutionAgent] started – waiting for approved opportunities');
  }

  stop(): void {
    this.running = false;
    this.status = 'idle';
    this.logger.info(
      `[ExecutionAgent] stopped (success=${this.successCount}, failure=${this.failureCount})`
    );
  }

  onSignal(_signal: AgentSignal): void {
    // Execution agent reacts via executeApproved() called directly by the coordinator
  }

  /**
   * Called by the coordinator when an opportunity has been approved.
   */
  async executeApproved(
    opportunity: ArbitrageOpportunity,
    assessment: RiskAssessment
  ): Promise<void> {
    await this.execute(opportunity, assessment);
  }

  getStats(): { success: number; failure: number } {
    return { success: this.successCount, failure: this.failureCount };
  }

  // ---------------------------------------------------------------------------
  // Internal execution logic
  // ---------------------------------------------------------------------------

  private async execute(
    opportunity: ArbitrageOpportunity,
    assessment: RiskAssessment
  ): Promise<void> {
    const opportunityId = assessment.opportunityId;
    const start = Date.now();

    this.logger.info(
      `[ExecutionAgent] executing opportunity ${opportunityId} ` +
        `(risk=${assessment.riskScore.toFixed(2)}, maxSize=$${assessment.maxPositionSize.toFixed(0)})`
    );

    const strategy = this.strategies.find(s => s.isViable(opportunity));

    if (!strategy) {
      const result: ExecutionResult = {
        opportunityId,
        success: false,
        error: 'No viable execution strategy found',
        executionTimeMs: Date.now() - start,
      };
      this.failureCount++;
      this.emitResult(result);
      return;
    }

    try {
      const signature = await strategy.execute(opportunity);
      const result: ExecutionResult = {
        opportunityId,
        success: true,
        signature,
        profit: opportunity.profit,
        executionTimeMs: Date.now() - start,
      };
      this.successCount++;
      this.logger.info(
        `[ExecutionAgent] ✅ executed via ${strategy.name} → ${signature} (${result.executionTimeMs}ms)`
      );
      this.emitResult(result);
    } catch (err) {
      const result: ExecutionResult = {
        opportunityId,
        success: false,
        error: String(err),
        executionTimeMs: Date.now() - start,
      };
      this.failureCount++;
      this.logger.warn(`[ExecutionAgent] ❌ execution failed: ${err}`);
      this.emitResult(result);
    }
  }

  private emitResult(result: ExecutionResult): void {
    const signal: AgentSignal = {
      id: generateId(),
      agentId: this.id,
      agentRole: this.role,
      type: 'execution-result',
      data: result,
      confidence: result.success ? 1 : 0,
      timestamp: Date.now(),
    };
    this.emitter.emit('agent-signal', signal);
  }
}

