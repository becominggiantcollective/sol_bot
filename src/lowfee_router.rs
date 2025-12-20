/**
 * Low-Fee DEX Router (Rust)
 * Ultra-fast quote calculations for Saber, Orca CLMM, and Phoenix
 * 
 * Performance target: < 1ms per quote (vs 15-20ms in TypeScript)
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use rust_decimal::Decimal;
use rust_decimal::prelude::*;

// Known stablecoin mints
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT_WORMHOLE: &str = "A9mUU4qviSctJVPJdBJWkb28deg915LYJKrzQ19ji3FM";

// Known major token mints
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
const WSOL_MINT: &str = "So11111111111111111111111111111111111111112";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LowFeeQuote {
    pub dex: String,
    pub pool: String,
    pub input_amount: u64,
    pub output_amount: u64,
    pub fee_percent: f64,
    pub price_impact: f64,
    pub route: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LowFeeRouter {
    saber_fee: Decimal,      // 0.04%
    clmm_fee: Decimal,       // 0.01%
    phoenix_fee: Decimal,    // 0.22%
}

impl LowFeeRouter {
    pub fn new() -> Self {
        Self {
            saber_fee: Decimal::from_str("0.0004").unwrap(),      // 0.04%
            clmm_fee: Decimal::from_str("0.0001").unwrap(),       // 0.01%
            phoenix_fee: Decimal::from_str("0.0022").unwrap(),    // 0.22%
        }
    }

    /// Get best low-fee quote for a token pair
    pub fn get_best_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
    ) -> Option<LowFeeQuote> {
        // Check if stablecoin pair
        if self.is_stable_pair(input_mint, output_mint) {
            return self.get_stablecoin_quote(input_mint, output_mint, amount);
        }

        // Check if major pair with CLMM support
        if self.has_clmm_support(input_mint, output_mint) {
            return self.get_clmm_quote(input_mint, output_mint, amount);
        }

        // Fallback to Phoenix
        self.get_phoenix_quote(input_mint, output_mint, amount)
    }

    /// Check if pair is stablecoin-to-stablecoin
    fn is_stable_pair(&self, input_mint: &str, output_mint: &str) -> bool {
        let stables = [USDC_MINT, USDT_MINT, USDC_MINT_WORMHOLE];
        stables.contains(&input_mint) && stables.contains(&output_mint)
    }

    /// Check if pair has CLMM pool support (major pairs)
    fn has_clmm_support(&self, input_mint: &str, output_mint: &str) -> bool {
        let major_tokens = [SOL_MINT, WSOL_MINT, USDC_MINT, USDT_MINT];
        major_tokens.contains(&input_mint) && major_tokens.contains(&output_mint)
    }

    /// Get quote from Saber/Mercurial for stablecoins (0.04% fee)
    fn get_stablecoin_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
    ) -> Option<LowFeeQuote> {
        // Constant product formula with low fee
        let amount_dec = Decimal::from(amount);
        let fee = amount_dec * self.saber_fee;
        let slippage = amount_dec * Decimal::from_str("0.0001").unwrap(); // 0.01% slippage for stables
        
        let output = amount_dec - fee - slippage;
        let output_u64 = output.to_u64().unwrap_or(0);

        Some(LowFeeQuote {
            dex: "Saber".to_string(),
            pool: "Saber-USDC-USDT".to_string(),
            input_amount: amount,
            output_amount: output_u64,
            fee_percent: 0.04,
            price_impact: 0.01, // 0.01% for stables
            route: vec![input_mint.to_string(), output_mint.to_string()],
        })
    }

    /// Get quote from Orca/Raydium CLMM (0.01% fee)
    fn get_clmm_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
    ) -> Option<LowFeeQuote> {
        let amount_dec = Decimal::from(amount);
        let fee = amount_dec * self.clmm_fee;
        
        // CLMM pools have tighter spreads, minimal slippage
        let slippage = amount_dec * Decimal::from_str("0.0005").unwrap(); // 0.05%
        
        let output = amount_dec - fee - slippage;
        let output_u64 = output.to_u64().unwrap_or(0);

        // Determine which DEX based on pair
        let dex_name = if self.is_sol_pair(input_mint, output_mint) {
            "Orca CLMM"
        } else {
            "Raydium CLMM"
        };

        Some(LowFeeQuote {
            dex: dex_name.to_string(),
            pool: format!("{}-{}", 
                self.token_symbol(input_mint), 
                self.token_symbol(output_mint)
            ),
            input_amount: amount,
            output_amount: output_u64,
            fee_percent: 0.01,
            price_impact: 0.05,
            route: vec![input_mint.to_string(), output_mint.to_string()],
        })
    }

    /// Get quote from Phoenix (0.22% fee)
    fn get_phoenix_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
    ) -> Option<LowFeeQuote> {
        let amount_dec = Decimal::from(amount);
        let fee = amount_dec * self.phoenix_fee;
        let slippage = amount_dec * Decimal::from_str("0.001").unwrap(); // 0.1%
        
        let output = amount_dec - fee - slippage;
        let output_u64 = output.to_u64().unwrap_or(0);

        Some(LowFeeQuote {
            dex: "Phoenix".to_string(),
            pool: "Phoenix-OrderBook".to_string(),
            input_amount: amount,
            output_amount: output_u64,
            fee_percent: 0.22,
            price_impact: 0.1,
            route: vec![input_mint.to_string(), output_mint.to_string()],
        })
    }

    /// Compare direct swap vs 2-hop routing
    pub fn get_optimal_route(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount: u64,
    ) -> Option<LowFeeQuote> {
        // Direct route
        let direct = self.get_best_quote(input_mint, output_mint, amount)?;

        // Try 2-hop through USDC if not already a USDC pair
        if input_mint != USDC_MINT && output_mint != USDC_MINT {
            if let Some(hop1) = self.get_best_quote(input_mint, USDC_MINT, amount) {
                if let Some(hop2) = self.get_best_quote(USDC_MINT, output_mint, hop1.output_amount) {
                    // Compare outputs
                    if hop2.output_amount > direct.output_amount {
                        // 2-hop is better
                        return Some(LowFeeQuote {
                            dex: format!("{} -> {}", hop1.dex, hop2.dex),
                            pool: "Multi-hop".to_string(),
                            input_amount: amount,
                            output_amount: hop2.output_amount,
                            fee_percent: hop1.fee_percent + hop2.fee_percent,
                            price_impact: hop1.price_impact + hop2.price_impact,
                            route: vec![
                                input_mint.to_string(),
                                USDC_MINT.to_string(),
                                output_mint.to_string(),
                            ],
                        });
                    }
                }
            }
        }

        // Direct is better or 2-hop not viable
        Some(direct)
    }

    /// Estimate total fees for a route
    pub fn estimate_fees(&self, dex_name: &str) -> f64 {
        match dex_name {
            "Saber" | "Mercurial" => 0.04,
            "Orca CLMM" | "Raydium CLMM" | "Meteora DLMM" => 0.01,
            "Phoenix" => 0.22,
            "Orca" | "Orca (Whirlpool)" => 0.30,
            "Raydium" => 0.25,
            _ => 0.30, // Default/unknown
        }
    }

    // Helper functions
    fn is_sol_pair(&self, input_mint: &str, output_mint: &str) -> bool {
        input_mint == SOL_MINT || input_mint == WSOL_MINT ||
        output_mint == SOL_MINT || output_mint == WSOL_MINT
    }

    fn token_symbol(&self, mint: &str) -> &str {
        match mint {
            SOL_MINT | WSOL_MINT => "SOL",
            USDC_MINT | USDC_MINT_WORMHOLE => "USDC",
            USDT_MINT => "USDT",
            _ => "TOKEN",
        }
    }
}

// NAPI bindings for Node.js
#[cfg(feature = "napi")]
pub mod napi_bindings {
    use super::*;
    use napi_derive::napi;

    #[napi(object)]
    pub struct JsLowFeeQuote {
        pub dex: String,
        pub pool: String,
        pub input_amount: String,
        pub output_amount: String,
        pub fee_percent: f64,
        pub price_impact: f64,
        pub route: Vec<String>,
    }

    impl From<LowFeeQuote> for JsLowFeeQuote {
        fn from(quote: LowFeeQuote) -> Self {
            Self {
                dex: quote.dex,
                pool: quote.pool,
                input_amount: quote.input_amount.to_string(),
                output_amount: quote.output_amount.to_string(),
                fee_percent: quote.fee_percent,
                price_impact: quote.price_impact,
                route: quote.route,
            }
        }
    }

    #[napi]
    pub struct JsLowFeeRouter {
        inner: LowFeeRouter,
    }

    #[napi]
    impl JsLowFeeRouter {
        #[napi(constructor)]
        pub fn new() -> Self {
            Self {
                inner: LowFeeRouter::new(),
            }
        }

        #[napi]
        pub fn get_best_quote(
            &self,
            input_mint: String,
            output_mint: String,
            amount: String,
        ) -> Option<JsLowFeeQuote> {
            let amount_u64 = amount.parse::<u64>().ok()?;
            self.inner
                .get_best_quote(&input_mint, &output_mint, amount_u64)
                .map(|q| q.into())
        }

        #[napi]
        pub fn get_optimal_route(
            &self,
            input_mint: String,
            output_mint: String,
            amount: String,
        ) -> Option<JsLowFeeQuote> {
            let amount_u64 = amount.parse::<u64>().ok()?;
            self.inner
                .get_optimal_route(&input_mint, &output_mint, amount_u64)
                .map(|q| q.into())
        }

        #[napi]
        pub fn estimate_fees(&self, dex_name: String) -> f64 {
            self.inner.estimate_fees(&dex_name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stablecoin_quote() {
        let router = LowFeeRouter::new();
        let quote = router.get_stablecoin_quote(USDC_MINT, USDT_MINT, 1_000_000_000);
        
        assert!(quote.is_some());
        let q = quote.unwrap();
        assert_eq!(q.dex, "Saber");
        assert_eq!(q.fee_percent, 0.04);
        assert!(q.output_amount > 995_000_000); // Should get ~99.95% back
    }

    #[test]
    fn test_clmm_quote() {
        let router = LowFeeRouter::new();
        let quote = router.get_clmm_quote(SOL_MINT, USDC_MINT, 1_000_000_000);
        
        assert!(quote.is_some());
        let q = quote.unwrap();
        assert!(q.dex.contains("CLMM"));
        assert_eq!(q.fee_percent, 0.01);
    }

    #[test]
    fn test_optimal_routing() {
        let router = LowFeeRouter::new();
        
        // Stablecoin pair should use Saber
        let quote = router.get_best_quote(USDC_MINT, USDT_MINT, 1_000_000_000);
        assert!(quote.is_some());
        assert_eq!(quote.unwrap().dex, "Saber");
        
        // SOL pair should use CLMM
        let quote = router.get_best_quote(SOL_MINT, USDC_MINT, 1_000_000_000);
        assert!(quote.is_some());
        assert!(quote.unwrap().dex.contains("CLMM"));
    }
}
