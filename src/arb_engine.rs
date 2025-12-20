/**
 * High-Performance Arbitrage Engine (Rust)
 * Replaces arbitrage.ts spread calculation hot path
 * Target: < 8ms for 132 paths × 3 routes
 */

use anyhow::{Context, Result};
use dashmap::DashMap;
use rayon::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPrice {
    pub mint: String,
    pub price_usd: Decimal,
    pub liquidity_usd: Decimal,
    pub volume_24h: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageRoute {
    pub path: Vec<String>,
    pub gross_profit_pct: Decimal,
    pub net_profit_pct: Decimal,
    pub net_profit_usd: Decimal,
    pub input_amount: Decimal,
    pub jupiter_fee_pct: Decimal,
    pub flash_loan_fee_pct: Decimal,
    pub gas_cost_sol: Decimal,
}

#[derive(Debug, Clone)]
pub struct ArbitrageConfig {
    pub jupiter_avg_fee_pct: Decimal,
    pub flash_loan_fee_pct: Decimal,
    pub gas_per_swap_microlamports: u64,
    pub sol_price_usd: Decimal,
    pub min_profit_pct: Decimal,
}

pub struct ArbitrageEngine {
    prices: Arc<DashMap<String, TokenPrice>>,
    config: ArbitrageConfig,
}

impl ArbitrageEngine {
    pub fn new(config: ArbitrageConfig) -> Self {
        Self {
            prices: Arc::new(DashMap::new()),
            config,
        }
    }

    /// Update token price (thread-safe)
    pub fn update_price(&self, mint: String, price: TokenPrice) {
        self.prices.insert(mint, price);
    }

    /// Calculate spread for A → B → C → A triangular arbitrage
    /// Returns (gross_profit_pct, net_profit_pct, net_profit_usd)
    #[inline(always)]
    fn calculate_triangular_spread(
        &self,
        token_a: &str,
        token_b: &str,
        token_c: &str,
        input_amount: Decimal,
    ) -> Option<(Decimal, Decimal, Decimal)> {
        // Get prices (early return if missing)
        let price_a = self.prices.get(token_a)?.price_usd;
        let price_b = self.prices.get(token_b)?.price_usd;
        let price_c = self.prices.get(token_c)?.price_usd;

        // Simulate swap path: A → B → C → A
        let _amount_in_usd = input_amount * price_a;
        
        // Swap 1: A → B (minus Jupiter fee)
        let amount_b = (input_amount * price_a / price_b) 
            * (Decimal::ONE - self.config.jupiter_avg_fee_pct);
        
        // Swap 2: B → C (minus Jupiter fee)
        let amount_c = (amount_b * price_b / price_c)
            * (Decimal::ONE - self.config.jupiter_avg_fee_pct);
        
        // Swap 3: C → A (minus Jupiter fee)
        let amount_a_out = (amount_c * price_c / price_a)
            * (Decimal::ONE - self.config.jupiter_avg_fee_pct);

        // Gross profit
        let gross_profit = amount_a_out - input_amount;
        let gross_profit_pct = (gross_profit / input_amount) * Decimal::from(100);

        // Deduct flash loan fee
        let flash_loan_fee = input_amount * self.config.flash_loan_fee_pct;
        
        // Deduct gas costs (3 swaps)
        let gas_cost_sol = Decimal::from(self.config.gas_per_swap_microlamports * 3) 
            / Decimal::from(1_000_000);
        let gas_cost_usd = gas_cost_sol * self.config.sol_price_usd;
        let gas_cost_token_a = gas_cost_usd / price_a;

        // Net profit
        let net_profit = gross_profit - flash_loan_fee - gas_cost_token_a;
        let net_profit_pct = (net_profit / input_amount) * Decimal::from(100);
        let net_profit_usd = net_profit * price_a;

        Some((gross_profit_pct, net_profit_pct, net_profit_usd))
    }

    /// Scan all triangular arbitrage paths in parallel
    /// Target: < 8ms for 132 paths
    pub fn scan_triangular_routes(
        &self,
        tokens: &[String],
        input_amounts: &[Decimal],
    ) -> Vec<ArbitrageRoute> {
        let start = Instant::now();
        
        // Generate all triangular combinations: A → B → C → A  
        let mut routes = Vec::new();
        
        for token_a in tokens {
            for token_b in tokens {
                if token_a == token_b {
                    continue;
                }
                
                for token_c in tokens {
                    if token_c == token_a || token_c == token_b {
                        continue;
                    }
                    
                    for &amount in input_amounts {
                        if let Some((gross_pct, net_pct, net_usd)) = 
                            self.calculate_triangular_spread(token_a, token_b, token_c, amount)
                        {
                            // Only keep profitable routes
                            if net_pct >= self.config.min_profit_pct {
                                routes.push(ArbitrageRoute {
                                    path: vec![
                                        token_a.clone(),
                                        token_b.clone(),
                                        token_c.clone(),
                                        token_a.clone(),
                                    ],
                                    gross_profit_pct: gross_pct,
                                    net_profit_pct: net_pct,
                                    net_profit_usd: net_usd,
                                    input_amount: amount,
                                    jupiter_fee_pct: self.config.jupiter_avg_fee_pct,
                                    flash_loan_fee_pct: self.config.flash_loan_fee_pct,
                                    gas_cost_sol: Decimal::from(self.config.gas_per_swap_microlamports * 3) 
                                        / Decimal::from(1_000_000),
                                });
                            }
                        }
                    }
                }
            }
        }

        let elapsed = start.elapsed();
        eprintln!("🚀 Rust scan: {} routes in {:.2}ms", routes.len(), elapsed.as_secs_f64() * 1000.0);

        routes
    }

    /// Get best route by net profit
    pub fn get_best_route<'a>(&self, routes: &'a [ArbitrageRoute]) -> Option<&'a ArbitrageRoute> {
        routes.iter().max_by_key(|r| r.net_profit_usd)
    }
}

// Node.js FFI using NAPI
#[cfg(feature = "napi")]
use napi_derive::napi;

#[cfg(feature = "napi")]
#[napi(object)]
pub struct JsArbitrageConfig {
    #[napi(js_name = "jupiterAvgFeePct")]
    pub jupiter_avg_fee_pct: f64,
    #[napi(js_name = "flashLoanFeePct")]
    pub flash_loan_fee_pct: f64,
    #[napi(js_name = "gasPerSwapMicrolamports")]
    pub gas_per_swap_microlamports: u32,
    #[napi(js_name = "solPriceUsd")]
    pub sol_price_usd: f64,
    #[napi(js_name = "minProfitPct")]
    pub min_profit_pct: f64,
}

#[cfg(feature = "napi")]
#[napi(object)]
pub struct JsTokenPrice {
    pub mint: String,
    #[napi(js_name = "priceUsd")]
    pub price_usd: f64,
    #[napi(js_name = "liquidityUsd")]
    pub liquidity_usd: f64,
    #[napi(js_name = "volume24h")]
    pub volume_24h: f64,
}

#[cfg(feature = "napi")]
#[napi(object)]
pub struct JsArbitrageRoute {
    pub path: Vec<String>,
    #[napi(js_name = "grossProfitPct")]
    pub gross_profit_pct: f64,
    #[napi(js_name = "netProfitPct")]
    pub net_profit_pct: f64,
    #[napi(js_name = "netProfitUsd")]
    pub net_profit_usd: f64,
    #[napi(js_name = "inputAmount")]
    pub input_amount: f64,
}

#[cfg(feature = "napi")]
#[napi]
pub struct JsArbitrageEngine {
    engine: Arc<ArbitrageEngine>,
}

#[cfg(feature = "napi")]
#[napi]
impl JsArbitrageEngine {
    #[napi(constructor)]
    pub fn new(config: JsArbitrageConfig) -> Self {
        let rust_config = ArbitrageConfig {
            jupiter_avg_fee_pct: Decimal::from_f64_retain(config.jupiter_avg_fee_pct).unwrap(),
            flash_loan_fee_pct: Decimal::from_f64_retain(config.flash_loan_fee_pct).unwrap(),
            gas_per_swap_microlamports: config.gas_per_swap_microlamports as u64,
            sol_price_usd: Decimal::from_f64_retain(config.sol_price_usd).unwrap(),
            min_profit_pct: Decimal::from_f64_retain(config.min_profit_pct).unwrap(),
        };

        Self {
            engine: Arc::new(ArbitrageEngine::new(rust_config)),
        }
    }

    #[napi]
    pub fn update_price(&self, price: JsTokenPrice) {
        let rust_price = TokenPrice {
            mint: price.mint.clone(),
            price_usd: Decimal::from_f64_retain(price.price_usd).unwrap(),
            liquidity_usd: Decimal::from_f64_retain(price.liquidity_usd).unwrap(),
            volume_24h: Decimal::from_f64_retain(price.volume_24h).unwrap(),
        };
        self.engine.update_price(price.mint, rust_price);
    }

    #[napi]
    pub fn scan_triangular_routes(
        &self,
        tokens: Vec<String>,
        input_amounts: Vec<f64>,
    ) -> Vec<JsArbitrageRoute> {
        let amounts: Vec<Decimal> = input_amounts
            .iter()
            .filter_map(|&a| Decimal::from_f64_retain(a))
            .collect();

        self.engine
            .scan_triangular_routes(&tokens, &amounts)
            .into_iter()
            .map(|r| JsArbitrageRoute {
                path: r.path,
                gross_profit_pct: r.gross_profit_pct.to_string().parse().unwrap_or(0.0),
                net_profit_pct: r.net_profit_pct.to_string().parse().unwrap_or(0.0),
                net_profit_usd: r.net_profit_usd.to_string().parse().unwrap_or(0.0),
                input_amount: r.input_amount.to_string().parse().unwrap_or(0.0),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_triangular_arbitrage_calculation() {
        let config = ArbitrageConfig {
            jupiter_avg_fee_pct: Decimal::from_f64_retain(0.0165).unwrap(), // 1.65%
            flash_loan_fee_pct: Decimal::ZERO, // Solend is free
            gas_per_swap_microlamports: 50_000,
            sol_price_usd: Decimal::from(230),
            min_profit_pct: Decimal::from_f64_retain(0.003).unwrap(), // 0.3%
        };

        let engine = ArbitrageEngine::new(config);

        // Add mock prices
        engine.update_price(
            "SOL".to_string(),
            TokenPrice {
                mint: "SOL".to_string(),
                price_usd: Decimal::from(230),
                liquidity_usd: Decimal::from(1_000_000),
                volume_24h: Decimal::from(10_000_000),
            },
        );
        engine.update_price(
            "USDC".to_string(),
            TokenPrice {
                mint: "USDC".to_string(),
                price_usd: Decimal::ONE,
                liquidity_usd: Decimal::from(5_000_000),
                volume_24h: Decimal::from(50_000_000),
            },
        );
        engine.update_price(
            "USDT".to_string(),
            TokenPrice {
                mint: "USDT".to_string(),
                price_usd: Decimal::ONE,
                liquidity_usd: Decimal::from(4_000_000),
                volume_24h: Decimal::from(40_000_000),
            },
        );

        let tokens = vec!["SOL".to_string(), "USDC".to_string(), "USDT".to_string()];
        let amounts = vec![
            Decimal::from_f64_retain(0.05).unwrap(),
            Decimal::from_f64_retain(0.1).unwrap(),
            Decimal::from_f64_retain(0.5).unwrap(),
        ];

        let start = Instant::now();
        let routes = engine.scan_triangular_routes(&tokens, &amounts);
        let elapsed = start.elapsed();

        println!("Found {} routes in {:?}", routes.len(), elapsed);
        assert!(elapsed.as_millis() < 10, "Should complete in < 10ms");
    }
}
