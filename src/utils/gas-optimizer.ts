/**
 * GAS OPTIMIZER - Jito Bundle Integration & Gas Estimation
 * 
 * Fixes:
 * 1. Accurate gas estimation with buffer
 * 2. Profit calculations that include gas costs
 * 3. Jito bundle support to avoid burning gas on failed transactions
 */

import { Connection, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';

// Jito Block Engine endpoints
const JITO_ENDPOINTS = {
  mainnet: [
    'https://mainnet.block-engine.jito.wtf',
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://ny.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf',
  ],
};

// Gas estimation constants (in lamports)
const GAS_CONSTANTS = {
  BASE_FEE: 5000,                    // Base transaction fee
  COMPUTE_UNIT_PRICE: 1,             // Price per compute unit
  AVG_COMPUTE_UNITS: 200000,         // Average compute units for swap
  FLASHLOAN_COMPUTE_UNITS: 400000,   // Flash loans use more compute
  PRIORITY_FEE_MULTIPLIER: 2.5,      // Multiply by 2.5x during high activity
  BUFFER_MULTIPLIER: 1.3,            // Add 30% buffer for safety
  JITO_TIP_MIN: 10000,               // Min Jito tip (0.00001 SOL)
  JITO_TIP_COMPETITIVE: 100000,      // Competitive tip (0.0001 SOL)
};

export interface GasEstimate {
  estimatedGas: number;        // Base gas estimate in lamports
  withBuffer: number;          // Gas with 30% buffer
  withPriorityFee: number;     // Gas with priority fee during congestion
  jitoTip: number;             // Recommended Jito tip
  totalCost: number;           // Total cost including all fees
  inSOL: number;               // Total cost in SOL
}

export interface JitoBundleResult {
  bundleId: string;
  status: 'pending' | 'confirmed' | 'failed';
  signature?: string;
  error?: string;
}

export class GasOptimizer {
  private connection: Connection;
  private jitoEndpoint: string;

  constructor(connection: Connection) {
    this.connection = connection;
    // Round-robin between Jito endpoints
    this.jitoEndpoint = JITO_ENDPOINTS.mainnet[
      Math.floor(Math.random() * JITO_ENDPOINTS.mainnet.length)
    ];
  }

  /**
   * Estimate gas costs for a transaction with buffer
   */
  async estimateGas(
    transaction: Transaction | VersionedTransaction,
    isFlashloan: boolean = false,
    highPriority: boolean = false
  ): Promise<GasEstimate> {
    // Base compute units
    const computeUnits = isFlashloan 
      ? GAS_CONSTANTS.FLASHLOAN_COMPUTE_UNITS 
      : GAS_CONSTANTS.AVG_COMPUTE_UNITS;

    // Calculate base gas cost
    let estimatedGas = GAS_CONSTANTS.BASE_FEE + 
      (computeUnits * GAS_CONSTANTS.COMPUTE_UNIT_PRICE);

    // Add buffer for safety (30%)
    const withBuffer = Math.floor(estimatedGas * GAS_CONSTANTS.BUFFER_MULTIPLIER);

    // Add priority fee if needed
    let withPriorityFee = withBuffer;
    if (highPriority) {
      withPriorityFee = Math.floor(withBuffer * GAS_CONSTANTS.PRIORITY_FEE_MULTIPLIER);
    }

    // Jito tip (higher tip = better inclusion)
    const jitoTip = highPriority 
      ? GAS_CONSTANTS.JITO_TIP_COMPETITIVE 
      : GAS_CONSTANTS.JITO_TIP_MIN;

    // Total cost with Jito
    const totalCost = withPriorityFee + jitoTip;

    return {
      estimatedGas,
      withBuffer,
      withPriorityFee,
      jitoTip,
      totalCost,
      inSOL: totalCost / 1e9,  // Convert to SOL
    };
  }

  /**
   * Calculate profit after all costs (gas + fees + flash loan fee)
   */
  calculateNetProfit(
    grossProfit: number,          // Gross profit in lamports
    gasEstimate: GasEstimate,
    flashLoanAmount: number = 0,  // Flash loan amount in lamports
    flashLoanFeePct: number = 0.003  // Solend = 0.3%
  ): {
    grossProfit: number;
    gasCost: number;
    flashLoanFee: number;
    netProfit: number;
    isProfitable: boolean;
    profitInSOL: number;
  } {
    const flashLoanFee = Math.floor(flashLoanAmount * flashLoanFeePct);
    const totalCosts = gasEstimate.totalCost + flashLoanFee;
    const netProfit = grossProfit - totalCosts;

    return {
      grossProfit,
      gasCost: gasEstimate.totalCost,
      flashLoanFee,
      netProfit,
      isProfitable: netProfit > 0,
      profitInSOL: netProfit / 1e9,
    };
  }

  /**
   * Submit transaction via Jito bundle (no gas burned on revert)
   */
  async submitJitoBundle(
    transactions: (Transaction | VersionedTransaction)[],
    jitoTip: number = GAS_CONSTANTS.JITO_TIP_MIN
  ): Promise<JitoBundleResult> {
    try {
      // Serialize transactions
      const serializedTxs = transactions.map(tx => {
        if (tx instanceof Transaction) {
          return tx.serialize().toString('base64');
        } else {
          return Buffer.from(tx.serialize()).toString('base64');
        }
      });

      // Send bundle to Jito
      const response = await fetch(`${this.jitoEndpoint}/api/v1/bundles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [serializedTxs],
        }),
      });

      const data = await response.json() as any;

      if (data.error) {
        return {
          bundleId: '',
          status: 'failed',
          error: data.error.message || 'Unknown error',
        };
      }

      const bundleId = data.result;

      // Poll for bundle status
      const status = await this.pollBundleStatus(bundleId);

      return {
        bundleId,
        status: status.confirmed ? 'confirmed' : status.failed ? 'failed' : 'pending',
        signature: status.signature,
        error: status.error,
      };
    } catch (error) {
      return {
        bundleId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Poll bundle status until confirmed or failed
   */
  private async pollBundleStatus(
    bundleId: string,
    maxAttempts: number = 30,
    delayMs: number = 1000
  ): Promise<{
    confirmed: boolean;
    failed: boolean;
    signature?: string;
    error?: string;
  }> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.jitoEndpoint}/api/v1/bundles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        });

        const data = await response.json() as any;

        if (data.result?.value?.[0]) {
          const bundle = data.result.value[0];
          
          if (bundle.confirmation_status === 'confirmed') {
            return {
              confirmed: true,
              failed: false,
              signature: bundle.transactions?.[0],
            };
          }

          if (bundle.confirmation_status === 'failed') {
            return {
              confirmed: false,
              failed: true,
              error: 'Bundle failed validation',
            };
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        // Continue polling on errors
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return {
      confirmed: false,
      failed: true,
      error: 'Bundle timeout - status unknown',
    };
  }

  /**
   * Submit transaction with fallback: Try Jito first, fall back to regular RPC
   */
  async submitTransactionSafe(
    transaction: Transaction | VersionedTransaction,
    gasEstimate: GasEstimate,
    useJito: boolean = true
  ): Promise<{
    success: boolean;
    signature?: string;
    method: 'jito' | 'rpc';
    error?: string;
  }> {
    // Try Jito first if enabled
    if (useJito) {
      const jitoResult = await this.submitJitoBundle([transaction], gasEstimate.jitoTip);
      
      if (jitoResult.status === 'confirmed') {
        return {
          success: true,
          signature: jitoResult.signature,
          method: 'jito',
        };
      }

      // Jito failed - fall back to regular RPC
      console.warn(`Jito bundle failed: ${jitoResult.error}, falling back to RPC`);
    }

    // Fall back to regular RPC submission
    try {
      let signature: string;
      
      if (transaction instanceof Transaction) {
        signature = await this.connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          }
        );
      } else {
        signature = await this.connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: false,
            maxRetries: 2,
          }
        );
      }

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        method: 'rpc',
      };
    } catch (error) {
      return {
        success: false,
        method: 'rpc',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Calculate minimum flash loan amount needed (including gas buffer)
   */
  calculateFlashLoanAmount(
    targetAmount: number,      // Amount needed for trade in lamports
    gasEstimate: GasEstimate,
    flashLoanFeePct: number = 0.003
  ): number {
    // Need: targetAmount + gas + flash loan fee on total
    // Formula: borrowed = (targetAmount + gas) / (1 - fee)
    const needed = targetAmount + gasEstimate.totalCost;
    const borrowAmount = Math.ceil(needed / (1 - flashLoanFeePct));
    
    return borrowAmount;
  }
}

export default GasOptimizer;
