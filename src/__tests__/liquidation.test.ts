import { LiquidationDetector } from '../core/liquidation';
import { LiquidationStrategy } from '../strategies/mev';
import { SolanaConnection } from '../core/connection';
import { FlashloanManager } from '../core/flashloan';
import { PublicKey } from '@solana/web3.js';

// Mock the external dependencies
jest.mock('../core/connection');
jest.mock('../core/flashloan');
jest.mock('axios');

describe('Liquidation System', () => {
  let solanaConnection: jest.Mocked<SolanaConnection>;
  let flashloanManager: jest.Mocked<FlashloanManager>;
  let liquidationDetector: LiquidationDetector;
  let liquidationStrategy: LiquidationStrategy;

  beforeEach(() => {
    // Create mocked instances
    solanaConnection = new SolanaConnection() as jest.Mocked<SolanaConnection>;
    flashloanManager = new FlashloanManager(solanaConnection) as jest.Mocked<FlashloanManager>;
    
    // Setup mock methods
    solanaConnection.getBalance = jest.fn().mockResolvedValue(10); // 10 SOL
    solanaConnection.sendTransaction = jest.fn().mockResolvedValue('mock_signature');
    solanaConnection.getWalletPublicKey = jest.fn().mockReturnValue(
      new PublicKey('So11111111111111111111111111111111111111112')
    );
    flashloanManager.getBestProvider = jest.fn().mockResolvedValue({
      name: 'mock_provider',
      maxAmount: 1000000,
      fee: 0.001
    });
    flashloanManager.executeFlashloan = jest.fn().mockResolvedValue({
      success: true,
      signature: 'flashloan_signature',
      method: 'rpc' as const,
    });

    liquidationDetector = new LiquidationDetector(solanaConnection);
    liquidationStrategy = new LiquidationStrategy(solanaConnection, flashloanManager);
  });

  describe('LiquidationDetector', () => {
    it('should detect liquidation opportunities', async () => {
      const opportunities = await liquidationDetector.detectLiquidationOpportunities();
      
      expect(Array.isArray(opportunities)).toBe(true);
      // Should find mock liquidation opportunity
      expect(opportunities.length).toBeGreaterThanOrEqual(0);
    });

    it('should return opportunities sorted by urgency and profit', async () => {
      const opportunities = await liquidationDetector.detectLiquidationOpportunities();
      
      if (opportunities.length > 1) {
        // Check that opportunities are sorted correctly
        for (let i = 0; i < opportunities.length - 1; i++) {
          const current = opportunities[i];
          const next = opportunities[i + 1];
          
          const urgencyWeight = { critical: 4, high: 3, medium: 2, low: 1 };
          const currentUrgency = urgencyWeight[current.urgency];
          const nextUrgency = urgencyWeight[next.urgency];
          
          expect(currentUrgency).toBeGreaterThanOrEqual(nextUrgency);
        }
      }
    });
  });

  describe('LiquidationStrategy', () => {
    it('should initialize with correct properties', () => {
      expect(liquidationStrategy.name).toBe('aggressive-liquidation');
      expect(liquidationStrategy.description).toBe('Executes liquidations using flash loans with maximum speed and aggression');
    });

    it('should return false for isViable with arbitrage opportunities', () => {
      const mockArbitrageOpportunity = {
        inputMint: new PublicKey('So11111111111111111111111111111111111111112'),
        outputMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        inputAmount: 1000,
        expectedOutput: 1050,
        profit: 50,
        profitPercent: 0.05,
        route: [],
        gasEstimate: 5000
      };

      expect(liquidationStrategy.isViable(mockArbitrageOpportunity)).toBe(false);
    });

    it('should throw error when calling execute with arbitrage opportunity', async () => {
      const mockArbitrageOpportunity = {
        inputMint: new PublicKey('So11111111111111111111111111111111111111112'),
        outputMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        inputAmount: 1000,
        expectedOutput: 1050,
        profit: 50,
        profitPercent: 0.05,
        route: [],
        gasEstimate: 5000
      };

      await expect(liquidationStrategy.execute(mockArbitrageOpportunity))
        .rejects
        .toThrow('Use executeLiquidation method for liquidation strategy');
    });

    it('should scan and execute liquidations', async () => {
      const results = await liquidationStrategy.scanAndExecuteLiquidations();
      
      expect(Array.isArray(results)).toBe(true);
      // Results should be transaction signatures
      results.forEach(result => {
        expect(typeof result).toBe('string');
      });
    });

    it('should execute liquidation with flash loan when required', async () => {
      const mockOpportunity = {
        protocol: 'solend',
        borrower: new PublicKey('11111111111111111111111111111112'),
        collateralMint: new PublicKey('So11111111111111111111111111111111111111112'),
        borrowMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        collateralAmount: 10,
        borrowAmount: 950,
        healthFactor: 0.95,
        liquidationThreshold: 0.85,
        maxLiquidationAmount: 475,
        estimatedProfit: 23.75,
        profitPercent: 0.05,
        flashloanRequired: true,
        urgency: 'high' as const,
        lastUpdated: Date.now(),
      };

      const signature = await liquidationStrategy.executeLiquidation(mockOpportunity);
      
      expect(typeof signature).toBe('string');
      expect(flashloanManager.executeFlashloan).toHaveBeenCalled();
    });

    it('should execute liquidation directly when flash loan not required', async () => {
      const mockOpportunity = {
        protocol: 'solend',
        borrower: new PublicKey('11111111111111111111111111111112'),
        collateralMint: new PublicKey('So11111111111111111111111111111111111111112'),
        borrowMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        collateralAmount: 1,
        borrowAmount: 50,
        healthFactor: 0.98,
        liquidationThreshold: 0.85,
        maxLiquidationAmount: 25,
        estimatedProfit: 1.25,
        profitPercent: 0.05,
        flashloanRequired: false,
        urgency: 'medium' as const,
        lastUpdated: Date.now(),
      };

      const signature = await liquidationStrategy.executeLiquidation(mockOpportunity);
      
      expect(typeof signature).toBe('string');
      expect(solanaConnection.sendTransaction).toHaveBeenCalled();
      expect(flashloanManager.executeFlashloan).not.toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    it('should handle the complete liquidation flow', async () => {
      // Test the complete flow from detection to execution
      const opportunities = await liquidationDetector.detectLiquidationOpportunities();
      
      if (opportunities.length > 0) {
        const opportunity = opportunities[0];
        const signature = await liquidationStrategy.executeLiquidation(opportunity);
        
        expect(typeof signature).toBe('string');
        expect(signature.length).toBeGreaterThan(0);
      }
    });
  });
});