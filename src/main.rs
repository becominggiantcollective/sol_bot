use anyhow::Result;
use colored::Colorize;
use log::{info, debug, warn, error};
use std::time::Duration;
use tokio::time;
use solana_client::rpc_client::RpcClient;
use std::sync::Arc;

mod scanner;
mod executor;
mod metrics;

use scanner::ArbitrageScanner;
use executor::TradeExecutor;
use metrics::BotMetrics;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize dotenv
    dotenv::dotenv().ok();

    // Set up simple logging
    env_logger::builder()
        .filter_level(log::LevelFilter::Info)
        .try_init()
        .ok();

    println!("{}", "🚀 Solana Flashloan Arbitrage Bot (Rust Edition)".bright_green().bold());
    println!("{}", "━".repeat(70).bright_black());
    
    info!("Loading configuration...");
    
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
    
    let scan_interval = std::env::var("SCAN_INTERVAL_SECONDS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(20);

    let min_profit = std::env::var("MIN_PROFIT_THRESHOLD")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.002); // 0.2% minimum

    let max_slippage = std::env::var("MAX_SLIPPAGE")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.005); // 0.5%

    let max_flashloan = std::env::var("MAX_FLASHLOAN_AMOUNT")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(500000.0); // $500k

    println!("RPC Endpoint: {}", rpc_url.bright_cyan());
    println!("Scan Interval: {}s", scan_interval.to_string().bright_blue());
    println!("Min Profit Threshold: {}%", (min_profit * 100.0).to_string().bright_green());
    println!("Max Slippage: {}%", (max_slippage * 100.0).to_string().bright_yellow());
    println!("Max Flashloan: ${:.0}", max_flashloan.to_string().bright_cyan());
    println!("{}", "━".repeat(70).bright_black());
    println!("");
    println!("{}", "✅ Bot initialized - Ready for production".bright_green());
    println!("{}", "🔍 Starting opportunity scanner...".bright_cyan());
    println!("{}", "💡 Tip: Fund wallet to enable live trading".bright_yellow());
    println!("");

    // Initialize components
    let rpc_client = Arc::new(RpcClient::new(rpc_url.clone()));
    let scanner = ArbitrageScanner::new(rpc_client, min_profit).await?;
    let executor = TradeExecutor::new(&rpc_url).await?;
    let mut metrics = BotMetrics::new();

    // Main loop
    let mut interval = time::interval(Duration::from_secs(scan_interval));
    let mut iteration = 0u64;

    loop {
        interval.tick().await;
        iteration += 1;

        println!("{}", format!("━━━ Scan #{} ({} scans/hour) ━━━", iteration, (3600 / scan_interval)).bright_black());
        
        // Scan for opportunities
        match scanner.scan_opportunities().await {
            Ok(opportunities) => {
                if opportunities.is_empty() {
                    debug!("No profitable opportunities found in scan #{}", iteration);
                } else {
                    println!("{}", format!("🎯 Found {} opportunity(ies)!", opportunities.len()).bright_green().bold());
                    
                    for (idx, opp) in opportunities.iter().enumerate() {
                        let profit_pct = opp.profit_percentage * 100.0;
                        println!("  {}. {} → {} ({}%)", 
                            idx + 1,
                            opp.route[0].bright_yellow(),
                            opp.route[opp.route.len() - 1].bright_yellow(),
                            format!("{:.2}", profit_pct).bright_green()
                        );
                        
                        metrics.opportunities_found += 1;
                        
                        // Try to execute if profitable enough
                        if opp.profit_percentage > min_profit {
                            println!("     ⚡ Attempting execution...");
                            match executor.execute_trade(&opp).await {
                                Ok(sig) => {
                                    println!("     ✅ Success! Tx: {}", sig.to_string().bright_green());
                                    metrics.successful_trades += 1;
                                    metrics.total_profit += opp.estimated_profit;
                                }
                                Err(e) => {
                                    warn!("     ❌ Execution failed: {}", e);
                                    metrics.failed_trades += 1;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!("Scanner error: {}", e);
                metrics.scan_errors += 1;
            }
        }

        // Display metrics every 10 scans
        if iteration % 10 == 0 {
            println!("");
            println!("{}", "📊 METRICS".bright_cyan().bold());
            println!("   Scans: {} | Opportunities: {} | Trades: {} | Profit: ${:.2}",
                iteration.to_string().bright_blue(),
                metrics.opportunities_found.to_string().bright_yellow(),
                format!("{}/{}", metrics.successful_trades, metrics.failed_trades).bright_magenta(),
                metrics.total_profit.to_string().bright_green()
            );
            println!("");
        }
    }
}