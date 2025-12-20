#!/usr/bin/env node

console.log('🧪 FLASH LOAN SNIPER - CONFIGURATION TESTER\n');

// Test scenarios
const testScenarios = [
  { age: 0.5, liquidity: 1000, riskScore: 80, desc: "Very new token, low liquidity, high risk" },
  { age: 2, liquidity: 5000, riskScore: 40, desc: "New token, moderate liquidity, medium risk" },
  { age: 8, liquidity: 15000, riskScore: 20, desc: "Established token, good liquidity, low risk" },
  { age: 24, liquidity: 50000, riskScore: 10, desc: "Mature token, high liquidity, very low risk" }
];

// Test configurations
const configs = [
  { riskMode: 'conservative', flashloanAmounts: [0.5, 1, 2, 3] },
  { riskMode: 'moderate', flashloanAmounts: [1, 2, 3, 5] },
  { riskMode: 'aggressive', flashloanAmounts: [2, 3, 5, 10] }
];

for (const config of configs) {
  console.log(`🎯 RISK MODE: ${config.riskMode.toUpperCase()}`);
  console.log(`   Flash Loan Amounts: ${config.flashloanAmounts.join(', ')} SOL`);

  for (const scenario of testScenarios) {
    // Mock the CONFIG for testing
    global.CONFIG = {
      riskMode: config.riskMode,
      flashloanAmounts: config.flashloanAmounts,
      riskMultipliers: {
        conservative: { minLiquidity: 5000, maxAgeHours: 2, sizeMultiplier: 0.5 },
        moderate: { minLiquidity: 2000, maxAgeHours: 6, sizeMultiplier: 1.0 },
        aggressive: { minLiquidity: 1000, maxAgeHours: 24, sizeMultiplier: 1.5 }
      },
      profitStrategies: {
        small: { targetPct: 5, stopLossPct: 3, maxHoldMin: 5, flashloanMax: 1 },
        medium: { targetPct: 15, stopLossPct: 8, maxHoldMin: 15, flashloanMax: 3 },
        large: { targetPct: 25, stopLossPct: 12, maxHoldMin: 30, flashloanMax: 5 }
      }
    };

    // Simple trade size calculation
    const riskConfig = CONFIG.riskMultipliers[CONFIG.riskMode];
    let baseSize = Math.min(...CONFIG.flashloanAmounts);

    if (scenario.age < 1) baseSize *= 0.3;
    else if (scenario.age < 6) baseSize *= 0.6;

    if (scenario.liquidity < riskConfig.minLiquidity) baseSize *= 0.5;
    if (scenario.riskScore > 50) baseSize *= 0.7;

    baseSize *= riskConfig.sizeMultiplier;

    const validAmounts = CONFIG.flashloanAmounts.filter(amount => amount <= baseSize);
    const tradeSize = validAmounts.length > 0 ? Math.max(...validAmounts) : Math.min(...CONFIG.flashloanAmounts);

    // Strategy selection
    let strategy;
    if (scenario.age < 1 || scenario.riskScore > 70 || scenario.liquidity < 2000) {
      strategy = CONFIG.profitStrategies.small;
    } else if (scenario.age < 12 || scenario.liquidity < 10000) {
      strategy = CONFIG.profitStrategies.medium;
    } else {
      strategy = CONFIG.profitStrategies.large;
    }

    console.log(`   ${scenario.age}h/$${scenario.liquidity}/${scenario.riskScore}risk: ${tradeSize} SOL → ${strategy.targetPct}% target (${strategy.maxHoldMin}min)`);
  }
  console.log('');
}

console.log('💡 USAGE EXAMPLES:');
console.log('  Conservative small gains: FLASH_LOAN_AMOUNTS="0.5,1,2" RISK_MODE="conservative"');
console.log('  Moderate balanced: FLASH_LOAN_AMOUNTS="1,2,3,5" RISK_MODE="moderate"');
console.log('  Aggressive high risk: FLASH_LOAN_AMOUNTS="2,5,10" RISK_MODE="aggressive"');
console.log('  Custom amounts: FLASH_LOAN_AMOUNTS="0.1,0.5,1,2" RISK_MODE="conservative"');