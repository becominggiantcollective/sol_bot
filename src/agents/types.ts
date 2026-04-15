// Agent types and interfaces for the multi-agent trading system.
//
// Signal flow:
//   MarketAnalystAgent  → signal: market-condition        → Coordinator
//   ArbitrageScoutAgent → signal: arbitrage-opportunity   → Coordinator
//   Coordinator         → signal: risk-assessment-request → RiskManagerAgent
//   RiskManagerAgent    → signal: risk-assessment         → Coordinator
//   Coordinator         → (approved) → ExecutionAgent
//   ExecutionAgent      → signal: execution-result        → Coordinator

import { ArbitrageOpportunity } from '../types/index.js';

// ---------------------------------------------------------------------------
// Agent roles and status
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'market-analyst'
  | 'arbitrage-scout'
  | 'risk-manager'
  | 'execution';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error';

// ---------------------------------------------------------------------------
// Signal bus
// ---------------------------------------------------------------------------

export type SignalType =
  | 'market-condition'
  | 'arbitrage-opportunity'
  | 'liquidation-opportunity'
  | 'risk-assessment-request'
  | 'risk-assessment'
  | 'execution-result'
  | 'halt';

export interface AgentSignal {
  /** Unique signal identifier */
  id: string;
  /** ID of the agent that emitted this signal */
  agentId: string;
  /** Role of the agent that emitted this signal */
  agentRole: AgentRole;
  type: SignalType;
  data: unknown;
  /** Confidence score [0, 1] – 1 = highest confidence */
  confidence: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Domain-specific signal payloads
// ---------------------------------------------------------------------------

export interface MarketCondition {
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
  liquidity: 'low' | 'medium' | 'high';
  /** Composite risk level [0, 1] – higher means riskier */
  riskLevel: number;
  timestamp: number;
}

export interface RiskAssessmentRequest {
  opportunityId: string;
  opportunity: ArbitrageOpportunity;
  marketCondition?: MarketCondition;
}

export interface RiskAssessment {
  opportunityId: string;
  approved: boolean;
  /** Adjusted maximum position size in USD */
  maxPositionSize: number;
  /** Recommended slippage tolerance [0, 1] */
  recommendedSlippage: number;
  /** Risk score [0, 1] – 0 is safest */
  riskScore: number;
  reason: string;
}

export interface ExecutionResult {
  opportunityId: string;
  success: boolean;
  signature?: string;
  profit?: number;
  error?: string;
  executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Core agent interface
// ---------------------------------------------------------------------------

export interface TradingAgent {
  readonly id: string;
  readonly role: AgentRole;
  status: AgentStatus;
  /** Start the agent's internal loop */
  start(): Promise<void>;
  /** Gracefully stop the agent */
  stop(): void;
  /** Receive a signal from another agent or the coordinator */
  onSignal(signal: AgentSignal): void;
}
