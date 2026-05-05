//! 📊 LIVE BOT MONITOR
//! Real-time monitoring dashboard for the MEV bot

use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, signature::Keypair, signer::Signer};
use std::time::{Duration, Instant};

fn helius_rpc_url() -> String {
    let key = std::env::var("HELIUS_API_KEY")
        .expect("HELIUS_API_KEY environment variable is required");
    format!("https://mainnet.helius-rpc.com/?api-key={}", key)
}

fn jupiter_api_key() -> String {
    std::env::var("JUPITER_API_KEY")
        .expect("JUPITER_API_KEY environment variable is required")
}

const JUPITER_API: &str = "https://api.jup.ag/swap/v1";
const GECKO_API: &str = "https://api.geckoterminal.com/api/v2";

const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

#[derive(Debug, Serialize, Deserialize)]
struct JupiterQuote {
    #[serde(rename = "outAmount")]
    out_amount: String,
}

struct MonitorStats {
    start_time: Instant,
    api_calls: u64,
    api_errors: u64,
    avg_latency_ms: f64,
    sol_price: f64,
    wallet_balance: f64,
    opportunities_found: u64,
    last_opportunity: Option<String>,
}

async fn get_sol_price(client: &Client) -> Result<f64> {
    let url = format!(
        "{}/quote?inputMint={}&outputMint={}&amount={}",
        JUPITER_API, SOL_MINT, USDC_MINT, LAMPORTS_PER_SOL
    );

    let response: JupiterQuote = client
        .get(&url)
        .header("x-api-key", &jupiter_api_key())
        .send()
        .await?
        .json()
        .await?;

    let usdc: f64 = response.out_amount.parse()?;
    Ok(usdc / 1_000_000.0)
}

async fn get_new_pools(client: &Client) -> Result<Vec<(String, String, f64)>> {
    let url = format!("{}/networks/solana/new_pools?page=1", GECKO_API);
    let response: serde_json::Value = client.get(&url).send().await?.json().await?;

    let mut pools = Vec::new();
    if let Some(data) = response["data"].as_array() {
        for pool in data.iter().take(5) {
            let name = pool["attributes"]["name"]
                .as_str()
                .unwrap_or("Unknown")
                .to_string();
            let token_id = pool["relationships"]["base_token"]["data"]["id"]
                .as_str()
                .unwrap_or("")
                .replace("solana_", "");
            let liquidity: f64 = pool["attributes"]["reserve_in_usd"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);

            if !token_id.is_empty() && liquidity > 1000.0 {
                pools.push((name, token_id, liquidity));
            }
        }
    }

    Ok(pools)
}

async fn check_triangular_opportunity(client: &Client) -> Result<Option<(String, f64)>> {
    let test_amount = 10 * LAMPORTS_PER_SOL;
    let bonk_mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

    // SOL -> USDC
    let url1 = format!(
        "{}/quote?inputMint={}&outputMint={}&amount={}",
        JUPITER_API, SOL_MINT, USDC_MINT, test_amount
    );
    let q1: JupiterQuote = client
        .get(&url1)
        .header("x-api-key", &jupiter_api_key())
        .send()
        .await?
        .json()
        .await?;
    let usdc: u64 = q1.out_amount.parse()?;

    // USDC -> BONK
    let url2 = format!(
        "{}/quote?inputMint={}&outputMint={}&amount={}",
        JUPITER_API, USDC_MINT, bonk_mint, usdc
    );
    let q2: JupiterQuote = client
        .get(&url2)
        .header("x-api-key", &jupiter_api_key())
        .send()
        .await?
        .json()
        .await?;
    let bonk: u64 = q2.out_amount.parse()?;

    // BONK -> SOL
    let url3 = format!(
        "{}/quote?inputMint={}&outputMint={}&amount={}",
        JUPITER_API, bonk_mint, SOL_MINT, bonk
    );
    let q3: JupiterQuote = client
        .get(&url3)
        .header("x-api-key", &jupiter_api_key())
        .send()
        .await?
        .json()
        .await?;
    let final_sol: u64 = q3.out_amount.parse()?;

    let profit = final_sol as i64 - test_amount as i64;
    let profit_pct = (profit as f64 / test_amount as f64) * 100.0;

    // Net after fees
    let flash_fee = test_amount as f64 * 0.0001;
    let gas = 0.003 * LAMPORTS_PER_SOL as f64;
    let net_profit = profit as f64 - flash_fee - gas;
    let net_pct = (net_profit / test_amount as f64) * 100.0;

    if net_pct > 0.0 {
        Ok(Some(("SOL→USDC→BONK→SOL".to_string(), net_pct)))
    } else {
        Ok(None)
    }
}

fn clear_screen() {
    print!("\x1B[2J\x1B[H");
}

fn format_duration(secs: u64) -> String {
    let hours = secs / 3600;
    let mins = (secs % 3600) / 60;
    let secs = secs % 60;
    format!("{:02}:{:02}:{:02}", hours, mins, secs)
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();

    let private_key = std::env::var("WALLET_IDK_PRIVATE_KEY")
        .or_else(|_| std::env::var("WALLET_PRIVATE_KEY"))
        .expect("WALLET_PRIVATE_KEY not set");

    let wallet = Keypair::from_base58_string(&private_key);
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;
    let rpc = RpcClient::new_with_commitment(
        helius_rpc_url(),
        CommitmentConfig::confirmed(),
    );

    let mut stats = MonitorStats {
        start_time: Instant::now(),
        api_calls: 0,
        api_errors: 0,
        avg_latency_ms: 0.0,
        sol_price: 0.0,
        wallet_balance: 0.0,
        opportunities_found: 0,
        last_opportunity: None,
    };

    let mut latencies: Vec<f64> = Vec::new();
    let mut cycle = 0u64;

    loop {
        cycle += 1;
        clear_screen();

        // Get wallet balance
        if let Ok(balance) = rpc.get_balance(&wallet.pubkey()) {
            stats.wallet_balance = balance as f64 / LAMPORTS_PER_SOL as f64;
        }

        // Get SOL price with latency tracking
        let start = Instant::now();
        if let Ok(price) = get_sol_price(&client).await {
            let latency = start.elapsed().as_millis() as f64;
            latencies.push(latency);
            if latencies.len() > 100 {
                latencies.remove(0);
            }
            stats.avg_latency_ms = latencies.iter().sum::<f64>() / latencies.len() as f64;
            stats.sol_price = price;
            stats.api_calls += 1;
        } else {
            stats.api_errors += 1;
        }

        // Check for triangular opportunity
        if let Ok(Some((path, pct))) = check_triangular_opportunity(&client).await {
            stats.opportunities_found += 1;
            stats.last_opportunity = Some(format!("{}: +{:.4}%", path, pct));
            stats.api_calls += 3;
        } else {
            stats.api_calls += 3;
        }

        // Get new pools
        let new_pools = get_new_pools(&client).await.unwrap_or_default();
        stats.api_calls += 1;

        let runtime = stats.start_time.elapsed().as_secs();
        let success_rate = if stats.api_calls > 0 {
            ((stats.api_calls - stats.api_errors) as f64 / stats.api_calls as f64) * 100.0
        } else {
            100.0
        };

        // Display dashboard
        println!(
            r#"
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    📊 MEV BOT MONITOR - LIVE DASHBOARD 📊                     ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  🔑 Wallet: {}                              ║
║  💰 Balance: {:.6} SOL (${:.2})                                          ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  ⏱️  PERFORMANCE                                                              ║
║  ─────────────────────────────────────────────────────────────────────────    ║
║  Runtime:        {}                                                      ║
║  Cycle:          {}                                                          ║
║  API Calls:      {}                                                         ║
║  API Errors:     {} ({:.1}% success)                                        ║
║  Avg Latency:    {:.1}ms                                                      ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  💹 MARKET                                                                    ║
║  ─────────────────────────────────────────────────────────────────────────    ║
║  SOL Price:      ${:.2}                                                     ║
║  Opportunities:  {}                                                          ║
║  Last Opp:       {}  ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  🆕 NEW POOLS (Last 5)                                                        ║
║  ─────────────────────────────────────────────────────────────────────────    ║"#,
            wallet.pubkey(),
            stats.wallet_balance,
            stats.wallet_balance * stats.sol_price,
            format_duration(runtime),
            cycle,
            stats.api_calls,
            stats.api_errors,
            success_rate,
            stats.avg_latency_ms,
            stats.sol_price,
            stats.opportunities_found,
            stats.last_opportunity.as_deref().unwrap_or("None yet"),
        );

        for (name, _mint, liquidity) in new_pools.iter().take(5) {
            let display_name = if name.len() > 30 {
                format!("{}...", &name[..27])
            } else {
                name.clone()
            };
            println!(
                "║  • {:<35} | Liq: ${:<10.0}               ║",
                display_name, liquidity
            );
        }

        println!(
            r#"║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Press Ctrl+C to exit                                                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝"#
        );

        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
