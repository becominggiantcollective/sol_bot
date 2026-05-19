import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';
import {
  AgentRole,
  AgentSignal,
  ExecutionProofBundle,
  SettlementLifecycleState,
  TrustlessAgentIntent,
  TrustlessAgentSignature,
  TrustlessIntentPayloadKind,
  TrustlessSettlementRecord,
} from './types.js';

const TRUSTLESS_SCHEMA_VERSION = '1.0.0';
const WORKFLOW_ID = 'arbitrage-risk-execution-v1';
const SETTLEMENT_PDA_SEED = 'trustless-settlement';

const PAYLOAD_KIND_BY_SIGNAL: Partial<Record<string, TrustlessIntentPayloadKind>> = {
  'arbitrage-opportunity': 'arbitrage-opportunity',
  'risk-assessment': 'risk-assessment',
  'execution-result': 'execution-result',
};

function normalizeForCanonicalJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    'toBase58' in (value as { toBase58?: () => string }) &&
    typeof (value as { toBase58?: () => string }).toBase58 === 'function'
  ) {
    return (value as PublicKey).toBase58();
  }
  if (Array.isArray(value)) return value.map(v => normalizeForCanonicalJson(v));
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeForCanonicalJson(source[key]);
    }
    return out;
  }
  return value;
}

export function canonicalizeIntentData(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function computeSha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function computeHmacSha256Hex(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  try {
    const lhs = Buffer.from(a, 'hex');
    const rhs = Buffer.from(b, 'hex');
    if (lhs.length !== rhs.length) return false;
    return crypto.timingSafeEqual(lhs, rhs);
  } catch {
    return false;
  }
}

function getRoleSecret(role: AgentRole): string {
  const key = `TRUSTLESS_AGENT_SECRET_${role.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key] || '';
}

export function createTrustlessIntent(signal: AgentSignal): TrustlessAgentIntent | null {
  const payloadKind = PAYLOAD_KIND_BY_SIGNAL[signal.type];
  if (!payloadKind) return null;

  const payload = normalizeForCanonicalJson(signal.data);
  const material = {
    schemaVersion: TRUSTLESS_SCHEMA_VERSION,
    workflowId: WORKFLOW_ID,
    payloadKind,
    signalType: signal.type,
    signalId: signal.id,
    emitter: {
      agentId: signal.agentId,
      agentRole: signal.agentRole,
    },
    confidence: signal.confidence,
    timestamp: signal.timestamp,
    payload,
  };
  const canonicalJson = canonicalizeIntentData(material);
  const hash = computeSha256Hex(canonicalJson);
  return {
    schemaVersion: TRUSTLESS_SCHEMA_VERSION,
    workflowId: WORKFLOW_ID,
    payloadKind,
    canonicalJson,
    hash,
  };
}

export function signTrustlessIntent(
  intent: TrustlessAgentIntent,
  role: AgentRole,
  agentId: string
): TrustlessAgentSignature | null {
  const secret = getRoleSecret(role);
  if (!secret) return null;
  return {
    algorithm: 'HMAC-SHA256',
    signerId: agentId,
    keyId: `role:${role}:v1`,
    signature: computeHmacSha256Hex(intent.hash, secret),
    signedAt: Date.now(),
  };
}

export class AgentIdentityRegistry {
  private readonly idToRole = new Map<string, AgentRole>();

  register(agentId: string, role: AgentRole): void {
    this.idToRole.set(agentId, role);
  }

  verify(signal: AgentSignal): { ok: boolean; reason?: string } {
    if (!signal.intent || !signal.signature) {
      return { ok: false, reason: 'Missing trustless intent or signature' };
    }

    const role = this.idToRole.get(signal.agentId) ?? signal.agentRole;
    const secret = getRoleSecret(role);
    if (!secret) return { ok: false, reason: `No trustless secret configured for role=${role}` };

    if (signal.signature.signerId !== signal.agentId) {
      return { ok: false, reason: 'Signer id does not match emitting agent id' };
    }

    const computed = computeHmacSha256Hex(signal.intent.hash, secret);
    if (!safeHexEqual(computed, signal.signature.signature)) {
      return { ok: false, reason: 'Invalid trustless signature' };
    }

    return { ok: true };
  }
}

export function attachTrustlessEnvelope(signal: AgentSignal): AgentSignal {
  const intent = createTrustlessIntent(signal);
  if (!intent) return signal;
  const signature = signTrustlessIntent(intent, signal.agentRole, signal.agentId);
  return {
    ...signal,
    intent,
    signature: signature ?? undefined,
  };
}

export function validateExecutionProofBundle(
  proof: ExecutionProofBundle | undefined,
  nowMs = Date.now()
): { ok: boolean; reason?: string } {
  if (!proof) return { ok: false, reason: 'Missing execution proof bundle' };
  if (!proof.transactionSignature) return { ok: false, reason: 'Missing transaction signature' };
  if (proof.finishedAtMs < proof.startedAtMs) {
    return { ok: false, reason: 'Invalid execution timestamps' };
  }
  if (proof.observedAtMs > nowMs + 5_000) {
    return { ok: false, reason: 'Proof observation timestamp is in the future' };
  }
  const elapsed = proof.finishedAtMs - proof.startedAtMs;
  if (proof.maxExecutionTimeMs > 0 && elapsed > proof.maxExecutionTimeMs) {
    return { ok: false, reason: `Execution exceeded timeout (${elapsed}ms)` };
  }
  return { ok: true };
}

export class TrustlessSettlementManager {
  private readonly programId: PublicKey;
  private readonly executionTimeoutMs: number;
  private readonly disputeWindowMs: number;
  private readonly records = new Map<string, TrustlessSettlementRecord>();

  constructor(programId: string, executionTimeoutMs: number, disputeWindowMs: number) {
    this.programId = new PublicKey(programId);
    if (executionTimeoutMs <= 0) {
      throw new Error('TRUSTLESS_EXECUTION_TIMEOUT_MS must be > 0');
    }
    if (disputeWindowMs < 0) {
      throw new Error('TRUSTLESS_DISPUTE_WINDOW_MS must be >= 0');
    }
    this.executionTimeoutMs = executionTimeoutMs;
    this.disputeWindowMs = disputeWindowMs;
  }

  deriveEscrowPda(opportunityId: string, opportunityIntentHash: string): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SETTLEMENT_PDA_SEED),
        Buffer.from(opportunityId).subarray(0, 32),
        Buffer.from(opportunityIntentHash, 'hex').subarray(0, 32),
      ],
      this.programId
    );
    return pda;
  }

  openEscrow(
    opportunityId: string,
    opportunityIntentHash: string,
    nowMs = Date.now()
  ): TrustlessSettlementRecord {
    const escrowPda = this.deriveEscrowPda(opportunityId, opportunityIntentHash).toBase58();
    const record: TrustlessSettlementRecord = {
      workflowId: WORKFLOW_ID,
      schemaVersion: TRUSTLESS_SCHEMA_VERSION,
      opportunityId,
      opportunityIntentHash,
      escrowPda,
      status: 'pending-execution',
      openedAtMs: nowMs,
      executionDeadlineMs: nowMs + this.executionTimeoutMs,
      disputeDeadlineMs: nowMs + this.executionTimeoutMs + this.disputeWindowMs,
    };
    this.records.set(opportunityId, record);
    return record;
  }

  markProofSubmitted(
    opportunityId: string,
    executionProofHash: string,
    nowMs = Date.now()
  ): TrustlessSettlementRecord | null {
    const record = this.records.get(opportunityId);
    if (!record) return null;
    if (nowMs > record.executionDeadlineMs) {
      record.status = 'timed-out';
      record.closedAtMs = nowMs;
      this.records.set(opportunityId, record);
      return record;
    }
    record.executionProofHash = executionProofHash;
    record.proofSubmittedAtMs = nowMs;
    record.status = this.disputeWindowMs > 0 ? 'pending-dispute' : 'released';
    if (record.status === 'released') {
      record.closedAtMs = nowMs;
    }
    this.records.set(opportunityId, record);
    return record;
  }

  finalize(
    opportunityId: string,
    decision: 'release' | 'cancel' | 'slash',
    nowMs = Date.now()
  ): TrustlessSettlementRecord | null {
    const record = this.records.get(opportunityId);
    if (!record) return null;
    if (decision === 'release' && this.disputeWindowMs > 0 && nowMs < record.disputeDeadlineMs) {
      return null;
    }
    const status: SettlementLifecycleState =
      decision === 'release' ? 'released' : decision === 'slash' ? 'slashed' : 'cancelled';
    record.status = status;
    record.closedAtMs = nowMs;
    this.records.set(opportunityId, record);
    return record;
  }

  get(opportunityId: string): TrustlessSettlementRecord | null {
    return this.records.get(opportunityId) ?? null;
  }
}

export function shouldUseTrustlessPath(): boolean {
  return config.trustless?.enabled === true;
}
