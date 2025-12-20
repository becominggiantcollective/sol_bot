// ML-Based Trading Predictor V2
// Enhanced with rug timing, more features, and better accuracy

import fs from 'fs';

const ML_DATA_FILE = 'ml-training-data-v2.json';
const MODEL_FILE = 'ml-model-v2.json';
const RUG_PATTERNS_FILE = 'rug-patterns.json';

// ============================================
// DATA PERSISTENCE
// ============================================
function loadData(file, defaultData) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return defaultData;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Load training data
function loadTrainingData() {
  return loadData(ML_DATA_FILE, { 
    trades: [], 
    patterns: {},
    rugPatterns: [],
    marketConditions: []
  });
}

// Load model
function loadModel() {
  return loadData(MODEL_FILE, {
    version: 2,
    weights: {
      // Core features (original)
      liquidityScore: 0.25,
      volumeScore: 0.15,
      ageScore: -0.15,
      priceVelocity: 0.15,
      volumeSpike: 0.10,
      holderConcentration: -0.20,
      
      // NEW: Rug timing features
      rugTimingRisk: -0.25,        // Fast rug pattern detected
      priceDropVelocity: -0.20,    // How fast price is dropping
      
      // NEW: Market context
      marketMomentum: 0.10,        // Overall market direction
      tokenMomentum: 0.15,         // Token-specific momentum
      
      // NEW: Pattern recognition
      pumpDumpPattern: -0.20,      // Classic pump and dump signal
      organicGrowthPattern: 0.15,  // Gradual organic growth
      whaleActivityPattern: -0.15, // Large holder movements
      
      // NEW: Social signals (if available)
      socialMomentum: 0.10,        // Twitter/Telegram activity
      
      // NEW: Trading patterns
      buyPressure: 0.15,           // More buys than sells
      spreadHealth: 0.10,          // Tight spreads = healthy
    },
    thresholds: {
      buyScore: 0.65,              // Raised threshold
      sellQuickScore: 0.80,
      rugRiskScore: 0.35,
      minConfidence: 0.6           // NEW: Minimum confidence to trade
    },
    rugTiming: {
      fastRugWindow: 10000,        // <10s = fast rug
      mediumRugWindow: 60000,      // <1min = medium rug
      avgRugTime: 1400,            // From our data: 1.4s average!
      rugWarningThreshold: 5000    // Alert if pattern matches <5s rug
    },
    stats: {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      rugsCaught: 0,
      rugsMissed: 0,
      falsePositives: 0
    }
  });
}

// Load rug patterns database
function loadRugPatterns() {
  return loadData(RUG_PATTERNS_FILE, {
    patterns: [],
    avgRugTime: 1400,
    fastestRug: 1000,
    slowestRug: 30000,
    commonFeatures: {}
  });
}

// ============================================
// ENHANCED FEATURE EXTRACTION
// ============================================
function extractFeatures(token, marketData = {}) {
  const features = {};
  
  // === ORIGINAL FEATURES (improved) ===
  
  // Liquidity score (0-1) - use log scale for better distribution
  const liq = token.liquidity || 0;
  features.liquidityScore = Math.min(1, Math.log10(Math.max(1, liq)) / 5); // 100K = 1.0
  
  // Volume score - relative to liquidity
  const vol = token.volume || 0;
  const volToLiq = vol / Math.max(1, liq);
  features.volumeScore = Math.min(1, volToLiq);
  
  // Age score (inverted - newer = riskier)
  const ageHours = token.ageHours || 0;
  features.ageScore = ageHours < 0.1 ? 0.1 : Math.min(1, ageHours / 24);
  
  // Price velocity
  features.priceVelocity = normalizeFeature(token.priceVelocity, -0.5, 0.5);
  
  // Volume spike
  features.volumeSpike = normalizeFeature(token.volumeSpike, 0, 5);
  
  // Holder concentration (high = bad)
  features.holderConcentration = (token.topHolderPct || 50) / 100;
  
  // === NEW: RUG TIMING FEATURES ===
  
  // Rug timing risk - based on historical patterns
  features.rugTimingRisk = calculateRugTimingRisk(token);
  
  // Price drop velocity - how fast is it dropping
  if (token.priceHistory && token.priceHistory.length > 1) {
    const recent = token.priceHistory.slice(-3);
    const dropRate = recent.length > 1 
      ? (recent[recent.length - 1] - recent[0]) / recent[0]
      : 0;
    features.priceDropVelocity = Math.max(0, -dropRate); // Only count drops
  } else {
    features.priceDropVelocity = 0;
  }
  
  // === NEW: MARKET CONTEXT ===
  
  // Overall market momentum (SOL/BTC trend)
  features.marketMomentum = normalizeFeature(marketData.solMomentum || 0, -0.1, 0.1);
  
  // Token-specific momentum
  features.tokenMomentum = normalizeFeature(token.momentum || 0, -0.2, 0.2);
  
  // === NEW: PATTERN RECOGNITION ===
  
  // Pump and dump pattern detection
  features.pumpDumpPattern = detectPumpDumpPattern(token);
  
  // Organic growth pattern
  features.organicGrowthPattern = detectOrganicGrowth(token);
  
  // Whale activity
  features.whaleActivityPattern = token.whaleActivity || 0;
  
  // === NEW: SOCIAL SIGNALS ===
  features.socialMomentum = normalizeFeature(token.socialScore || 0.5, 0, 1);
  
  // === NEW: TRADING PATTERNS ===
  
  // Buy pressure (more buys = bullish)
  const buys = token.buyCount || 0;
  const sells = token.sellCount || 0;
  features.buyPressure = (buys + sells) > 0 ? buys / (buys + sells) : 0.5;
  
  // Spread health (tight spread = healthy market)
  const spread = token.spread || 0.02;
  features.spreadHealth = Math.max(0, 1 - spread * 10); // 1% spread = 0.9 score
  
  return features;
}

// Normalize feature to 0-1 range
function normalizeFeature(value, min, max) {
  if (value === undefined || value === null) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// Calculate rug timing risk based on patterns
function calculateRugTimingRisk(token) {
  const patterns = loadRugPatterns();
  let risk = 0;
  
  // Check against known rug patterns
  const features = {
    lowLiquidity: (token.liquidity || 0) < 5000,
    veryNew: (token.ageHours || 0) < 0.05,
    highConcentration: (token.topHolderPct || 0) > 80,
    suspiciousVolume: (token.volume || 0) > (token.liquidity || 1) * 2,
    rapidPriceIncrease: (token.priceChange1m || 0) > 50
  };
  
  // Each matching pattern increases risk
  if (features.lowLiquidity) risk += 0.2;
  if (features.veryNew) risk += 0.25;
  if (features.highConcentration) risk += 0.3;
  if (features.suspiciousVolume) risk += 0.15;
  if (features.rapidPriceIncrease) risk += 0.1;
  
  // Compare to historical rug patterns
  if (patterns.patterns.length > 0) {
    const matchScore = patterns.patterns.reduce((score, pattern) => {
      let matches = 0;
      if (pattern.lowLiquidity === features.lowLiquidity) matches++;
      if (pattern.veryNew === features.veryNew) matches++;
      if (pattern.highConcentration === features.highConcentration) matches++;
      return score + (matches >= 2 ? 0.1 : 0);
    }, 0);
    risk += Math.min(0.3, matchScore);
  }
  
  return Math.min(1, risk);
}

// Detect pump and dump pattern
function detectPumpDumpPattern(token) {
  if (!token.priceHistory || token.priceHistory.length < 5) return 0;
  
  const prices = token.priceHistory;
  const mid = Math.floor(prices.length / 2);
  
  // First half: rapid increase
  const firstHalf = prices.slice(0, mid);
  const firstGain = (firstHalf[firstHalf.length - 1] - firstHalf[0]) / firstHalf[0];
  
  // Second half: decline
  const secondHalf = prices.slice(mid);
  const secondChange = (secondHalf[secondHalf.length - 1] - secondHalf[0]) / secondHalf[0];
  
  // Pump: >20% gain followed by decline
  if (firstGain > 0.2 && secondChange < 0) {
    return Math.min(1, firstGain * Math.abs(secondChange) * 10);
  }
  
  return 0;
}

// Detect organic growth pattern
function detectOrganicGrowth(token) {
  if (!token.priceHistory || token.priceHistory.length < 5) return 0.5;
  
  const prices = token.priceHistory;
  
  // Check for steady growth without huge spikes
  let steadyGrowth = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = (prices[i] - prices[i-1]) / prices[i-1];
    if (change > 0 && change < 0.1) steadyGrowth++;
  }
  
  return steadyGrowth / (prices.length - 1);
}

// ============================================
// PREDICTION ENGINE
// ============================================
function predictScore(token, model, marketData = {}) {
  const features = extractFeatures(token, marketData);
  const weights = model.weights;
  
  let score = 0.5; // Base score
  let totalWeight = 0;
  
  // Apply weighted features
  for (const [feature, weight] of Object.entries(weights)) {
    if (features[feature] !== undefined) {
      score += features[feature] * weight;
      totalWeight += Math.abs(weight);
    }
  }
  
  // Normalize
  score = Math.max(0, Math.min(1, score));
  
  // Calculate confidence based on feature completeness and variance
  const confidence = calculateConfidence(features, token);
  
  return {
    score,
    features,
    confidence,
    recommendation: getRecommendation(score, confidence, model.thresholds),
    rugRisk: features.rugTimingRisk,
    estimatedRugTime: estimateRugTime(features)
  };
}

// Get recommendation
function getRecommendation(score, confidence, thresholds) {
  // Require minimum confidence
  if (confidence < thresholds.minConfidence) {
    return { action: 'SKIP', reason: `Low confidence (${(confidence * 100).toFixed(0)}%)` };
  }
  
  if (score >= thresholds.sellQuickScore) {
    return { action: 'BUY_QUICK_SELL', reason: 'High momentum - take quick profits', exitTime: 10 };
  } else if (score >= thresholds.buyScore) {
    return { action: 'BUY', reason: 'Good opportunity', exitTime: 30 };
  } else if (score <= thresholds.rugRiskScore) {
    return { action: 'AVOID', reason: 'High rug risk detected' };
  }
  
  return { action: 'SKIP', reason: 'Below threshold' };
}

// Calculate confidence
function calculateConfidence(features, token) {
  let confidence = 0.5;
  
  // More data = higher confidence
  const dataPoints = Object.values(features).filter(v => v !== 0.5 && v !== undefined).length;
  confidence += dataPoints * 0.03;
  
  // Historical data increases confidence
  if (token.priceHistory && token.priceHistory.length > 5) confidence += 0.1;
  if (token.volume > 0) confidence += 0.05;
  if (token.liquidity > 10000) confidence += 0.1;
  
  // Consistent features = higher confidence
  const values = Object.values(features).filter(v => typeof v === 'number');
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  confidence += Math.max(0, 0.2 - variance);
  
  return Math.max(0.3, Math.min(0.95, confidence));
}

// Estimate time until potential rug
function estimateRugTime(features) {
  const patterns = loadRugPatterns();
  
  // High rug risk = fast rug
  if (features.rugTimingRisk > 0.7) {
    return { seconds: 5, confidence: 'high', warning: '⚠️ FAST RUG LIKELY' };
  } else if (features.rugTimingRisk > 0.5) {
    return { seconds: 30, confidence: 'medium', warning: '⚡ Quick exit needed' };
  } else if (features.rugTimingRisk > 0.3) {
    return { seconds: 120, confidence: 'low', warning: 'Monitor closely' };
  }
  
  return { seconds: 300, confidence: 'low', warning: 'Normal risk' };
}

// ============================================
// LEARNING & TRAINING
// ============================================

// Record trade outcome with enhanced data
export function recordTradeOutcome(trade) {
  const data = loadTrainingData();
  
  // Enhanced trade record
  const record = {
    ...trade,
    timestamp: Date.now(),
    features: trade.features || extractFeatures(trade.token || {}),
    isRug: trade.profitPct < -20,
    rugTime: trade.holdTimeMs,
    exitReason: trade.exitReason
  };
  
  data.trades.push(record);
  
  // Track rug patterns separately
  if (record.isRug) {
    const rugPatterns = loadRugPatterns();
    rugPatterns.patterns.push({
      timestamp: Date.now(),
      holdTime: trade.holdTimeMs,
      features: record.features,
      loss: trade.profitPct,
      lowLiquidity: (trade.token?.liquidity || 0) < 5000,
      veryNew: (trade.token?.ageHours || 0) < 0.05,
      highConcentration: (trade.token?.topHolderPct || 0) > 80
    });
    
    // Update average rug time
    const rugTimes = rugPatterns.patterns.map(p => p.holdTime).filter(t => t > 0);
    if (rugTimes.length > 0) {
      rugPatterns.avgRugTime = rugTimes.reduce((a, b) => a + b, 0) / rugTimes.length;
      rugPatterns.fastestRug = Math.min(...rugTimes);
      rugPatterns.slowestRug = Math.max(...rugTimes);
    }
    
    // Keep last 100 rug patterns
    if (rugPatterns.patterns.length > 100) {
      rugPatterns.patterns = rugPatterns.patterns.slice(-100);
    }
    
    saveData(RUG_PATTERNS_FILE, rugPatterns);
    console.log(`🚨 RUG RECORDED: ${trade.holdTimeMs}ms | Loss: ${trade.profitPct.toFixed(1)}%`);
  }
  
  // Keep last 1000 trades
  if (data.trades.length > 1000) {
    data.trades = data.trades.slice(-1000);
  }
  
  saveData(ML_DATA_FILE, data);
  
  // Retrain model periodically
  if (data.trades.length >= 10 && data.trades.length % 5 === 0) {
    retrainModel(data.trades);
  }
}

// Enhanced model retraining
function retrainModel(trades) {
  const model = loadModel();
  
  const winners = trades.filter(t => t.profitPct > 0);
  const losers = trades.filter(t => t.profitPct <= 0);
  const rugs = trades.filter(t => t.isRug);
  
  if (winners.length < 3 || losers.length < 3) {
    console.log('📊 ML: Not enough data to retrain');
    return;
  }
  
  // Calculate average features
  const avgWinner = averageFeatures(winners.map(t => t.features).filter(Boolean));
  const avgLoser = averageFeatures(losers.map(t => t.features).filter(Boolean));
  const avgRug = rugs.length > 0 ? averageFeatures(rugs.map(t => t.features).filter(Boolean)) : null;
  
  if (!avgWinner || !avgLoser) return;
  
  const learningRate = 0.15; // Slightly higher for faster learning
  
  // Adjust weights based on winner vs loser difference
  for (const feature of Object.keys(model.weights)) {
    if (avgWinner[feature] !== undefined && avgLoser[feature] !== undefined) {
      const diff = avgWinner[feature] - avgLoser[feature];
      model.weights[feature] += diff * learningRate;
      model.weights[feature] = Math.max(-0.5, Math.min(0.5, model.weights[feature]));
    }
  }
  
  // EXTRA: Penalize features that are high in rugs
  if (avgRug) {
    for (const feature of Object.keys(model.weights)) {
      if (avgRug[feature] !== undefined && avgRug[feature] > 0.7) {
        // This feature was high during rugs - penalize it
        model.weights[feature] -= 0.05;
      }
    }
  }
  
  // Update stats
  model.stats.totalPredictions = trades.length;
  model.stats.correctPredictions = winners.length;
  model.stats.accuracy = (winners.length / trades.length * 100).toFixed(1);
  model.stats.rugsCaught = rugs.filter(r => r.prediction?.rugRisk > 0.5).length;
  model.stats.rugsMissed = rugs.length - model.stats.rugsCaught;
  
  saveData(MODEL_FILE, model);
  console.log(`🧠 ML V2: Retrained | Accuracy: ${model.stats.accuracy}% | Rugs caught: ${model.stats.rugsCaught}/${rugs.length}`);
}

// Calculate average features
function averageFeatures(featuresList) {
  if (!featuresList.length) return null;
  
  const result = {};
  const allKeys = new Set(featuresList.flatMap(f => Object.keys(f)));
  
  for (const key of allKeys) {
    const values = featuresList.map(f => f[key]).filter(v => typeof v === 'number');
    result[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  
  return result;
}

// ============================================
// EXPORTS
// ============================================

// Main analysis function
export function analyzeToken(token, marketData = {}) {
  const model = loadModel();
  const prediction = predictScore(token, model, marketData);
  
  return {
    ...prediction,
    shouldTrade: (prediction.recommendation.action === 'BUY' || 
                  prediction.recommendation.action === 'BUY_QUICK_SELL') &&
                  prediction.confidence >= model.thresholds.minConfidence,
    suggestedStrategy: prediction.score >= 0.8 
      ? { target: 6, stop: 3, maxHold: 10 }   // Quick flip - tighter stops
      : { target: 10, stop: 5, maxHold: 30 }, // Standard
    version: 2
  };
}

// Quick rug check
export function quickRugCheck(token) {
  const features = extractFeatures(token);
  return {
    isLikelyRug: features.rugTimingRisk > 0.6,
    risk: features.rugTimingRisk,
    estimatedTime: estimateRugTime(features),
    warning: features.rugTimingRisk > 0.7 ? '🚨 HIGH RUG RISK' :
             features.rugTimingRisk > 0.5 ? '⚠️ MEDIUM RUG RISK' : '✅ LOW RISK'
  };
}

// Get model stats
export function getModelStats() {
  const model = loadModel();
  const data = loadTrainingData();
  const rugPatterns = loadRugPatterns();
  
  return {
    ...model.stats,
    version: model.version,
    tradesRecorded: data.trades.length,
    rugsRecorded: rugPatterns.patterns.length,
    avgRugTime: `${(rugPatterns.avgRugTime / 1000).toFixed(1)}s`,
    fastestRug: `${(rugPatterns.fastestRug / 1000).toFixed(1)}s`,
    weights: model.weights,
    thresholds: model.thresholds
  };
}

// Migrate data from v1
export function migrateFromV1() {
  try {
    if (fs.existsSync('ml-training-data.json')) {
      const v1Data = JSON.parse(fs.readFileSync('ml-training-data.json', 'utf8'));
      const v2Data = loadTrainingData();
      
      for (const trade of v1Data.trades || []) {
        // Check if already migrated
        if (!v2Data.trades.find(t => t.timestamp === trade.timestamp)) {
          v2Data.trades.push({
            ...trade,
            isRug: trade.profitPct < -20,
            rugTime: trade.holdTimeMs
          });
        }
      }
      
      saveData(ML_DATA_FILE, v2Data);
      console.log(`✅ Migrated ${v1Data.trades?.length || 0} trades from V1`);
      
      // Extract rug patterns
      const rugs = v2Data.trades.filter(t => t.isRug);
      if (rugs.length > 0) {
        const rugPatterns = loadRugPatterns();
        for (const rug of rugs) {
          rugPatterns.patterns.push({
            timestamp: rug.timestamp,
            holdTime: rug.holdTimeMs || rug.rugTime,
            features: rug.features,
            loss: rug.profitPct
          });
        }
        saveData(RUG_PATTERNS_FILE, rugPatterns);
      }
    }
  } catch (e) {
    console.error('Migration error:', e.message);
  }
}

// Test
if (process.argv[1].includes('ml-predictor-v2')) {
  console.log('🧠 ML Predictor V2 Test\n');
  
  // Try to migrate from v1
  migrateFromV1();
  
  const testToken = {
    symbol: 'TEST',
    liquidity: 25000,
    volume: 5000,
    ageHours: 0.1,
    topHolderPct: 45,
    priceHistory: [1.0, 1.05, 1.08, 1.06, 1.04]
  };
  
  const result = analyzeToken(testToken);
  console.log('Test Token:', testToken.symbol);
  console.log('Prediction:', JSON.stringify(result, null, 2));
  console.log('\nModel Stats:', getModelStats());
  
  // Test rug detection
  const ruggyToken = {
    symbol: 'RUGGY',
    liquidity: 2000,
    volume: 10000,
    ageHours: 0.01,
    topHolderPct: 90,
  };
  
  console.log('\n--- Rug Check Test ---');
  console.log('Ruggy Token:', ruggyToken.symbol);
  console.log('Rug Check:', quickRugCheck(ruggyToken));
}
