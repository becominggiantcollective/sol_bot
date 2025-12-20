/**
 * Sol Bot - High-Performance Solana Trading Bot
 * Rust modules for performance-critical hot paths
 */

pub mod arb_engine;
pub mod flashloan_executor;
pub mod lowfee_router;

// Re-export for convenience
pub use arb_engine::{ArbitrageEngine, ArbitrageConfig, ArbitrageRoute, TokenPrice};
pub use flashloan_executor::{FlashloanExecutor, FlashloanRoute};
pub use lowfee_router::{LowFeeRouter, LowFeeQuote};

// Node.js FFI exports
#[cfg(feature = "napi")]
pub use arb_engine::{JsArbitrageEngine, JsArbitrageConfig, JsTokenPrice, JsArbitrageRoute};
#[cfg(feature = "napi")]
pub use flashloan_executor::{JsFlashloanExecutor, JsFlashloanRoute};
#[cfg(feature = "napi")]
pub use lowfee_router::napi_bindings::{JsLowFeeRouter, JsLowFeeQuote};
