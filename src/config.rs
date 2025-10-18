use anyhow::{Context, Result};
use solana_sdk::signature::{Keypair, read_keypair_file};
use std::time::Duration;

#[derive(Clone)]
pub struct Config {
    pub rpc_url: String,
    pub wallet: Keypair,
    pub min_profit_threshold: f64,
    pub max_flashloan_amount: u64,
    pub scan_interval: Duration,
    pub max_slippage_bps: u64,
    pub priority_fee_lamports: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let rpc_url = std::env::var("SOLANA_RPC_URL")
            .context("SOLANA_RPC_URL not set")?;

        let wallet_path = std::env::var("WALLET_PATH")
            .unwrap_or_else(|_| {
                // Try common locations
                if std::path::Path::new("./wallet.json").exists() {
                    "./wallet.json".to_string()
                } else {
                    std::env::var("HOME")
                        .map(|h| format!("{}/.config/solana/id.json", h))
                        .unwrap_or_else(|_| "id.json".to_string())
                }
            });

        let wallet = read_keypair_file(&wallet_path)
            .with_context(|| format!("Failed to read wallet from: {}", wallet_path))?;

        let min_profit_threshold = std::env::var("MIN_PROFIT_THRESHOLD")
            .unwrap_or_else(|_| "0.005".to_string())
            .parse::<f64>()
            .context("Invalid MIN_PROFIT_THRESHOLD")?;

        let max_flashloan_amount = std::env::var("MAX_FLASHLOAN_AMOUNT")
            .unwrap_or_else(|_| "10000000000".to_string()) // 10 SOL default
            .parse::<u64>()
            .context("Invalid MAX_FLASHLOAN_AMOUNT")?;

        let scan_interval_secs = std::env::var("SCAN_INTERVAL_SECONDS")
            .unwrap_or_else(|_| "20".to_string())
            .parse::<u64>()
            .context("Invalid SCAN_INTERVAL_SECONDS")?;

        let max_slippage_bps = std::env::var("MAX_SLIPPAGE_BPS")
            .unwrap_or_else(|_| "50".to_string()) // 0.5% default
            .parse::<u64>()
            .context("Invalid MAX_SLIPPAGE_BPS")?;

        let priority_fee_lamports = std::env::var("PRIORITY_FEE_LAMPORTS")
            .unwrap_or_else(|_| "10000".to_string()) // 0.00001 SOL default
            .parse::<u64>()
            .context("Invalid PRIORITY_FEE_LAMPORTS")?;

        Ok(Self {
            rpc_url,
            wallet,
            min_profit_threshold,
            max_flashloan_amount,
            scan_interval: Duration::from_secs(scan_interval_secs),
            max_slippage_bps,
            priority_fee_lamports,
        })
    }
}
