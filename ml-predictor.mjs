// ML-Based Trading Predictor
// Uses historical trade data to predict outcomes

import fs from 'fs';

const ML_DATA_FILE = 'ml-training-data.json';
const MODEL_FILE = 'ml-model.json';

// Load or initialize training data
function loadTrainingData() {
  try {
    if (fs.existsSync(ML_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(ML_DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { trades: [], patterns: {} };
}

// Save training data
function saveTrainingData(data) {
  fs.writeFileSync(ML_DATA_FILE, JSON.stringify(data, null, 2));
}

// Load or initialize model weights
function loadModel() {
  try {
    if (fs.existsSync(MODEL_FILE)) {
      return JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    weights: {
      liquidityScore: 0.3,      // Higher liquidity = better
      volumeScore: 0.2,         // Higher volume = better
      ageScore: -0.1,           // Newer = riskier
      priceVelocity: 0.15,      // Fast price increase = good
      volumeSpike: 0.1,         // Volume spike = momentum
      holderConcentration: -0.15 // High concentration = rug risk
    },
    thresholds: {
      buyScore: 0.6,            // Min score to buy
      sellQuickScore: 0.8,      // Score that suggests quick sell
      rugRiskScore: 0.3         // Below this = likely rug
    },
    stats: {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0
    }
  };
}

// Save model
function saveModel(model) {
  fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
}

// Feature extraction from token data
function extractFeatures(token) {
  const features = {};
  
  // Liquidity score (0-1)
  // $50k+ is great, $2k is minimum
  features.liquidityScore = Math.min(1, (token.liquidity || 0) / 50000);
  
  // Volume score (0-1)
  // Higher volume relative to liquidity = more activity
  const volToLiq = (token.volume || 0) / Math.max(1, token.liquidity || 1);
  features.volumeScore = Math.min(1, volToLiq * 2);
  
  // Age score (0-1, inverted - newer = lower score)
  // 0 hours = 0, 1+ hours = 1
  features.ageScore = Math.min(1, (token.ageHours || 0));
  
  // Price velocity (if available)
  // How fast is price moving in last few minutes
  features.priceVelocity = token.priceVelocity || 0.5;
  
  // Volume spike detection
  // Is current volume much higher than average?
  features.volumeSpike = token.volumeSpike || 0.5;
  
  // Holder concentration (if available)
  // Top 10 holders owning >80% = bad
  features.holderConcentration = token.holderConcentration || 0.5;
  
  return features;
}

// Calculate prediction score
function predictScore(token, model) {
  const features = extractFeatures(token);
  const weights = model.weights;
  
  let score = 0.5; // Base score
  
  // Apply weighted features
  score += features.liquidityScore * weights.liquidityScore;
  score += features.volumeScore * weights.volumeScore;
  score += features.ageScore * weights.ageScore;
  score += features.priceVelocity * weights.priceVelocity;
  score += features.volumeSpike * weights.volumeSpike;
  score += features.holderConcentration * weights.holderConcentration;
  
  // Normalize to 0-1
  score = Math.max(0, Math.min(1, score));
  
  return {
    score,
    features,
    recommendation: getRecommendation(score, model.thresholds),
    confidence: calculateConfidence(features)
  };
}

// Get recommendation based on score
function getRecommendation(score, thresholds) {
  if (score >= thresholds.sellQuickScore) {
    return { action: 'BUY_QUICK_SELL', reason: 'High momentum - take quick profits' };
  } else if (score >= thresholds.buyScore) {
    return { action: 'BUY', reason: 'Good opportunity' };
  } else if (score <= thresholds.rugRiskScore) {
    return { action: 'AVOID', reason: 'High rug risk detected' };
  } else {
    return { action: 'SKIP', reason: 'Below threshold' };
  }
}

// Calculate confidence based on feature variance
function calculateConfidence(features) {
  const values = Object.values(features);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  // Lower variance = higher confidence
  return Math.max(0.3, 1 - variance);
}

// Predict optimal sell time
function predictSellTime(token, priceHistory) {
  // Analyze price pattern
  if (priceHistory.length < 3) {
    return { action: 'HOLD', reason: 'Insufficient data' };
  }
  
  // Calculate momentum
  const recentPrices = priceHistory.slice(-5);
  const momentum = recentPrices.length > 1 
    ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]
    : 0;
  
  // Detect peak pattern (price going down after going up)
  const isPeaking = priceHistory.length >= 3 &&
    priceHistory[priceHistory.length - 2] > priceHistory[priceHistory.length - 1] &&
    priceHistory[priceHistory.length - 3] < priceHistory[priceHistory.length - 2];
  
  // Detect dump pattern (rapid decline)
  const isDumping = momentum < -0.1;
  
  // Detect pump pattern (rapid increase)
  const isPumping = momentum > 0.05;
  
  if (isDumping) {
    return { action: 'SELL_NOW', reason: 'Dump detected', confidence: 0.9 };
  } else if (isPeaking) {
    return { action: 'SELL_NOW', reason: 'Peak detected', confidence: 0.8 };
  } else if (isPumping) {
    return { action: 'HOLD', reason: 'Still pumping', confidence: 0.7 };
  }
  
  return { action: 'HOLD', reason: 'No clear pattern', confidence: 0.5 };
}

// Record trade outcome for learning
function recordTradeOutcome(trade) {
  const data = loadTrainingData();
  data.trades.push({
    ...trade,
    timestamp: Date.now()
  });
  
  // Keep last 1000 trades
  if (data.trades.length > 1000) {
    data.trades = data.trades.slice(-1000);
  }
  
  saveTrainingData(data);
  
  // Retrain model if we have enough data
  if (data.trades.length >= 10 && data.trades.length % 5 === 0) {
    retrainModel(data.trades);
  }
}

// Retrain model based on historical data
function retrainModel(trades) {
  const model = loadModel();
  
  // Separate winning and losing trades
  const winners = trades.filter(t => t.profitPct > 0);
  const losers = trades.filter(t => t.profitPct <= 0);
  
  if (winners.length < 3 || losers.length < 3) {
    console.log('📊 ML: Not enough data to retrain');
    return;
  }
  
  // Calculate average features for winners vs losers
  const avgWinnerFeatures = averageFeatures(winners.map(t => t.features).filter(Boolean));
  const avgLoserFeatures = averageFeatures(losers.map(t => t.features).filter(Boolean));
  
  if (!avgWinnerFeatures || !avgLoserFeatures) return;
  
  // Adjust weights based on what differentiates winners from losers
  const learningRate = 0.1;
  
  for (const feature of Object.keys(model.weights)) {
    if (avgWinnerFeatures[feature] !== undefined && avgLoserFeatures[feature] !== undefined) {
      const diff = avgWinnerFeatures[feature] - avgLoserFeatures[feature];
      model.weights[feature] += diff * learningRate;
      // Clamp weights to reasonable range
      model.weights[feature] = Math.max(-0.5, Math.min(0.5, model.weights[feature]));
    }
  }
  
  // Update accuracy stats
  model.stats.totalPredictions = trades.length;
  model.stats.correctPredictions = winners.length;
  model.stats.accuracy = (winners.length / trades.length * 100).toFixed(1);
  
  saveModel(model);
  console.log(`🧠 ML: Model retrained | Accuracy: ${model.stats.accuracy}% | ${winners.length}W/${losers.length}L`);
}

// Calculate average features
function averageFeatures(featuresList) {
  if (!featuresList.length) return null;
  
  const result = {};
  const keys = Object.keys(featuresList[0]);
  
  for (const key of keys) {
    const values = featuresList.map(f => f[key]).filter(v => typeof v === 'number');
    result[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  
  return result;
}

// Predict rug probability
function predictRugProbability(token) {
  let rugScore = 0;
  
  // Low liquidity = higher rug risk
  if ((token.liquidity || 0) < 5000) rugScore += 0.2;
  if ((token.liquidity || 0) < 2000) rugScore += 0.3;
  
  // Very new token = higher rug risk
  if ((token.ageHours || 0) < 0.1) rugScore += 0.2;
  
  // Low volume relative to liquidity = suspicious
  const volRatio = (token.volume || 0) / Math.max(1, token.liquidity || 1);
  if (volRatio < 0.05) rugScore += 0.15;
  
  // High holder concentration (if available)
  if ((token.topHolderPct || 0) > 80) rugScore += 0.3;
  
  return {
    probability: Math.min(1, rugScore),
    riskLevel: rugScore > 0.6 ? 'HIGH' : rugScore > 0.3 ? 'MEDIUM' : 'LOW',
    factors: []
  };
}

// Main prediction function for sniper
export function analyzeToken(token) {
  const model = loadModel();
  const prediction = predictScore(token, model);
  const rugRisk = predictRugProbability(token);
  
  return {
    ...prediction,
    rugRisk,
    shouldTrade: prediction.recommendation.action === 'BUY' || 
                 prediction.recommendation.action === 'BUY_QUICK_SELL',
    suggestedStrategy: prediction.score >= 0.8 
      ? { target: 8, stop: 5, maxHold: 5 }   // Quick flip
      : { target: 10, stop: 10, maxHold: 10 } // Standard
  };
}

// Analyze price action for sell decision
export function analyzePriceAction(priceHistory, entryPrice, currentPnl) {
  const sellPrediction = predictSellTime({}, priceHistory);
  
  // Additional momentum analysis
  const recentPrices = priceHistory.slice(-3);
  const isReversingDown = recentPrices.length >= 2 && 
    recentPrices[recentPrices.length - 1] < recentPrices[recentPrices.length - 2];
  
  // If we're in profit and momentum is reversing, suggest sell
  if (currentPnl > 3 && isReversingDown) {
    return { 
      action: 'SELL', 
      reason: 'Profit secured - momentum reversing',
      confidence: 0.75
    };
  }
  
  return sellPrediction;
}

// Record trade for learning
export { recordTradeOutcome };

// Get model stats
export function getModelStats() {
  const model = loadModel();
  const data = loadTrainingData();
  return {
    ...model.stats,
    tradesRecorded: data.trades.length,
    weights: model.weights
  };
}

// Test the predictor
if (process.argv[1].includes('ml-predictor')) {
  console.log('🧠 ML Predictor Test\n');
  
  const testToken = {
    symbol: 'TEST',
    liquidity: 25000,
    volume: 5000,
    ageHours: 0.1
  };
  
  const result = analyzeToken(testToken);
  console.log('Test Token:', testToken);
  console.log('Prediction:', JSON.stringify(result, null, 2));
  console.log('\nModel Stats:', getModelStats());
}
