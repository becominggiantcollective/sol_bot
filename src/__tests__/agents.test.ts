/**
 * Tests for the multi-agent trading system.
 *
 * We test each agent in isolation (using mock EventEmitters and stubs)
 * so no real network calls are made.
 */

import { EventEmitter } from 'events';
import { MarketAnalystAgent } from '../agents/market-analyst';
import { ArbitrageScoutAgent } from '../agents/arbitrage-scout';
import { RiskManagerAgent } from '../agents/risk-manager';

// ---------------------------------------------------------------------------
// Module mocks – must be declared before static imports that pull in
// modules with import.meta.url or other node-ESM-only constructs.
// ---------------------------------------------------------------------------

jest.mock('../core/arbitrage', () => ({
  detectOpportunities: jest.fn().mockResolvedValue([]),
}));
jest.mock('../core/connection', () => ({
  SolanaConnection: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue(1.0),
    getWalletPublicKey: jest.fn().mockReturnValue(null),
    sendTransaction: jest.fn().mockResolvedValue('mock-sig'),
    getConnection: jest.fn().mockReturnValue({}),
  })),
}));
jest.mock('../core/flashloan', () => ({
  FlashloanManager: jest.fn().mockImplementation(() => ({
    getBestProvider: jest.fn().mockResolvedValue(null),
    executeFlashloan: jest.fn().mockResolvedValue('mock-fl-sig'),
  })),
  SolendFlashloanProvider: jest.fn(),
}));
jest.mock('../strategies/direct-swap', () => ({
  DirectSwapStrategy: jest.fn().mockImplementation(() => ({
    name: 'direct-swap',
    isViable: jest.fn().mockReturnValue(false),
    execute: jest.fn().mockResolvedValue('mock-tx'),
  })),
}));
jest.mock('../strategies/mev', () => ({
  FlashloanArbitrageStrategy: jest.fn().mockImplementation(() => ({
    name: 'flashloan-arbitrage',
    isViable: jest.fn().mockReturnValue(false),
    execute: jest.fn().mockResolvedValue('mock-tx'),
  })),
  SandwichAttackStrategy: jest.fn().mockImplementation(() => ({
    name: 'sandwich-attack',
    isViable: jest.fn().mockReturnValue(false),
    execute: jest.fn().mockResolvedValue('mock-tx'),
  })),
  LiquidationStrategy: jest.fn().mockImplementation(() => ({})),
}));

// Import coordinator AFTER mocks are registered so the mock factories apply
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AgentCoordinator } = require('../agents/coordinator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A scan interval long enough to prevent actual network calls during tests */
const MOCK_LONG_INTERVAL_MS = 9_999_000;

function makeOpportunity(profitPercent = 0.003) {
  const { PublicKey } = require('@solana/web3.js');
  return {
    inputMint: new PublicKey('So11111111111111111111111111111111111111112'),
    outputMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    inputAmount: 1000,
    expectedOutput: 1003,
    profit: 3,
    profitPercent,
    route: [{ dex: 'jupiter', priceImpact: 0.001 } as any],
    gasEstimate: 0.001,
  };
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

describe('AgentSignal type safety', () => {
  it('has the expected signal type union', () => {
    const validTypes = [
      'market-condition',
      'arbitrage-opportunity',
      'liquidation-opportunity',
      'risk-assessment-request',
      'risk-assessment',
      'execution-result',
      'halt',
    ] as const;

    expect(validTypes).toHaveLength(7);
    expect(validTypes).toContain('market-condition');
    expect(validTypes).toContain('risk-assessment');
  });
});

// ---------------------------------------------------------------------------
// MarketAnalystAgent
// ---------------------------------------------------------------------------

describe('MarketAnalystAgent', () => {
  it('computeTrend returns a valid trend value', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).priceHistory = [150, 151, 152, 151, 153, 154];
    const condition = (agent as any).computeTrend();
    expect(['bullish', 'bearish', 'sideways']).toContain(condition);
  });

  it('computeVolatility returns low for stable prices', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).priceHistory = [100, 100, 100, 100, 100, 100];
    expect((agent as any).computeVolatility()).toBe('low');
  });

  it('computeVolatility returns high for volatile prices', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).priceHistory = [100, 140, 80, 130, 70, 120];
    expect((agent as any).computeVolatility()).toBe('high');
  });

  it('computeTrend returns bearish for falling prices', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).priceHistory = [200, 180, 160, 140, 120, 100];
    expect((agent as any).computeTrend()).toBe('bearish');
  });

  it('computeTrend returns bullish for rising prices', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).priceHistory = [100, 110, 120, 130, 140, 160];
    expect((agent as any).computeTrend()).toBe('bullish');
  });

  it('computeRiskLevel is higher for bearish+high-volatility', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    const riskHigh = (agent as any).computeRiskLevel('bearish', 'high', 'low');
    const riskLow = (agent as any).computeRiskLevel('bullish', 'low', 'high');
    expect(riskHigh).toBeGreaterThan(riskLow);
  });

  it('getLastCondition returns null on startup', () => {
    const agent = new MarketAnalystAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    expect(agent.getLastCondition()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ArbitrageScoutAgent
// ---------------------------------------------------------------------------

describe('ArbitrageScoutAgent', () => {
  it('starts with zero opportunities found', () => {
    const agent = new ArbitrageScoutAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    expect(agent.getTotalOpportunitiesFound()).toBe(0);
  });

  it('emits arbitrage-opportunity signals for each found opportunity', () => {
    const emitter = new EventEmitter();
    const agent = new ArbitrageScoutAgent(emitter, MOCK_LONG_INTERVAL_MS);
    const opp = makeOpportunity(0.005);

    const signals: any[] = [];
    emitter.on('agent-signal', s => signals.push(s));

    (agent as any).emitOpportunity(opp);

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('arbitrage-opportunity');
    expect(signals[0].data).toMatchObject({ profitPercent: 0.005 });
  });

  it('confidence is capped at 0.95', () => {
    const emitter = new EventEmitter();
    const agent = new ArbitrageScoutAgent(emitter, MOCK_LONG_INTERVAL_MS);
    const opp = makeOpportunity(99); // absurdly high profit %

    const signals: any[] = [];
    emitter.on('agent-signal', s => signals.push(s));
    (agent as any).emitOpportunity(opp);

    expect(signals[0].confidence).toBeLessThanOrEqual(0.95);
  });

  it('stop() sets status to idle', () => {
    const agent = new ArbitrageScoutAgent(new EventEmitter(), MOCK_LONG_INTERVAL_MS);
    (agent as any).running = true;
    agent.stop();
    expect(agent.status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// RiskManagerAgent
// ---------------------------------------------------------------------------

describe('RiskManagerAgent', () => {
  function makeRiskManager() {
    const emitter = new EventEmitter();
    const agent = new RiskManagerAgent(emitter);
    agent.start();
    return { agent, emitter };
  }

  it('approves a clearly profitable, low-risk opportunity', () => {
    const { agent } = makeRiskManager();
    const opp = makeOpportunity(0.01); // 1% profit
    const result = (agent as any).assess({
      opportunityId: 'test-opp-1',
      opportunity: opp,
      marketCondition: {
        trend: 'bullish',
        volatility: 'low',
        liquidity: 'high',
        riskLevel: 0.1,
        timestamp: Date.now(),
      },
    }) as any;

    expect(result.approved).toBe(true);
    expect(result.riskScore).toBeLessThan(0.8);
  });

  it('rejects an opportunity below the minimum profit threshold', () => {
    const { agent } = makeRiskManager();
    const opp = makeOpportunity(0.0001); // 0.01% – well below 0.2% threshold
    const result = (agent as any).assess({
      opportunityId: 'test-opp-2',
      opportunity: opp,
      marketCondition: null,
    }) as any;
    expect(result.approved).toBe(false);
  });

  it('rejects in high-volatility conditions with small absolute profit', () => {
    const { agent } = makeRiskManager();
    const opp = makeOpportunity(0.003);
    opp.profit = 1; // small dollar profit
    const result = (agent as any).assess({
      opportunityId: 'test-opp-3',
      opportunity: opp,
      marketCondition: {
        trend: 'bearish',
        volatility: 'high',
        liquidity: 'low',
        riskLevel: 0.8,
        timestamp: Date.now(),
      },
    }) as any;
    expect(result.approved).toBe(false);
  });

  it('emits a risk-assessment signal via EventEmitter', () => {
    const { agent, emitter } = makeRiskManager();
    const received: any[] = [];
    emitter.on('agent-signal', s => received.push(s));

    const opp = makeOpportunity(0.01);
    agent.onSignal({
      id: 'sig-1',
      agentId: 'coordinator',
      agentRole: 'arbitrage-scout',
      type: 'risk-assessment-request',
      data: { opportunityId: 'test-emit', opportunity: opp, marketCondition: null },
      confidence: 0.8,
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('risk-assessment');
  });

  it('tracks approved/denied stats correctly', () => {
    const { agent } = makeRiskManager();
    const goodOpp = makeOpportunity(0.01);
    const badOpp = makeOpportunity(0.0001);

    (agent as any).assess({ opportunityId: 'a', opportunity: goodOpp });
    (agent as any).assess({ opportunityId: 'b', opportunity: badOpp });

    const stats = agent.getStats();
    expect(stats.approved).toBe(1);
    expect(stats.denied).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AgentCoordinator (integration-light test – no real network)
// ---------------------------------------------------------------------------

describe('AgentCoordinator', () => {
  function makeCoordinator() {
    const { SolanaConnection } = require('../core/connection');
    const { FlashloanManager } = require('../core/flashloan');
    return new AgentCoordinator(new SolanaConnection(), new FlashloanManager());
  }

  it('starts with zeroed metrics', () => {
    const coordinator = makeCoordinator();
    const metrics = coordinator.getMetrics();
    expect(metrics.opportunitiesReceived).toBe(0);
    expect(metrics.executionsSucceeded).toBe(0);
  });

  it('getMetrics returns a snapshot (not a reference)', () => {
    const coordinator = makeCoordinator();
    const m1 = coordinator.getMetrics();
    const m2 = coordinator.getMetrics();
    expect(m1).not.toBe(m2);
    expect(m1).toEqual(m2);
  });
});

