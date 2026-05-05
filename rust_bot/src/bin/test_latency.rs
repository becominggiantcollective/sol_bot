//! 🧪 LATENCY & STRATEGY TESTER
//! Tests Jupiter API response times and validates arbitrage calculations

use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

fn jupiter_api_key() -> String {
    std::env::var("JUPITER_API_KEY")
        .expect("JUPITER_API_KEY environment variable is required")
}

const JUPITER_API: &str = "https://api.jup.ag/swap/v1";

const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK_MINT: &str = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JUP_MINT: &str = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const WIF_MINT: &str = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const MSOL_MINT: &str = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const USDC_DECIMALS: u64 = 1_000_000;

#[derive(Debug, Serialize, Deserialize)]
struct JupiterQuote {
    #[serde(rename = "inputMint")]
    input_mint: String,
    #[serde(rename = "inAmount")]
    in_amount: String,
    #[serde(rename = "outputMint")]
    output_mint: String,
    #[serde(rename = "outAmount")]
    out_amount: String,
    #[serde(rename = "priceImpactPct")]
    price_impact_pct: Option<String>,
}

struct LatencyResult {
    pair: String,
    latency_ms: u128,
    success: bool,
    in_amount: f64,
    out_amount: f64,
}

struct TriangularResult {
    path: String,
    latency_ms: u128,
    gross_pct: f64,
    net_pct: f64,
    profitable: bool,
}

async fn get_quote(
    client: &Client,
    input_mint: &str,
    output_mint: &str,
    amount: u64,
) -> Result<(JupiterQuote, Duration)> {
    let url = format!(
        "{}/quote?inputMint={}&outputMint={}&amount={}&slippageBps=50",
        JUPITER_API, input_mint, output_mint, amount
    );

    let start = Instant::now();
    let response = client
        .get(&url)
        .header("x-api-key", &jupiter_api_key())
        .send()
        .await?
        .json::<JupiterQuote>()
        .await?;
    let elapsed = start.elapsed();

    Ok((response, elapsed))
}

async fn test_single_quote_latency(client: &Client) -> Vec<LatencyResult> {
    println!("\n============================================================");
    println!("📊 SINGLE QUOTE LATENCY TEST");
    println!("============================================================\n");

    let pairs = vec![
        ("SOL", "USDC", SOL_MINT, USDC_MINT, LAMPORTS_PER_SOL),
        ("USDC", "SOL", USDC_MINT, SOL_MINT, 100 * USDC_DECIMALS),
        ("SOL", "BONK", SOL_MINT, BONK_MINT, LAMPORTS_PER_SOL),
        ("SOL", "JUP", SOL_MINT, JUP_MINT, LAMPORTS_PER_SOL),
        ("SOL", "WIF", SOL_MINT, WIF_MINT, LAMPORTS_PER_SOL),
        ("SOL", "mSOL", SOL_MINT, MSOL_MINT, LAMPORTS_PER_SOL),
    ];

    let mut results = Vec::new();

    for (from, to, input_mint, output_mint, amount) in pairs {
        match get_quote(client, input_mint, output_mint, amount).await {
            Ok((quote, elapsed)) => {
                let out: f64 = quote.out_amount.parse().unwrap_or(0.0);
                let result = LatencyResult {
                    pair: format!("{} → {}", from, to),
                    latency_ms: elapsed.as_millis(),
                    success: true,
                    in_amount: amount as f64,
                    out_amount: out,
                };
                println!(
                    "  ✅ {} → {}: {}ms | Output: {:.6}",
                    from,
                    to,
                    elapsed.as_millis(),
                    if to == "USDC" {
                        out / USDC_DECIMALS as f64
                    } else if to == "BONK" {
                        out / 100000.0
                    } else {
                        out / LAMPORTS_PER_SOL as f64
                    }
                );
                results.push(result);
            }
            Err(e) => {
                println!("  ❌ {} → {}: FAILED - {}", from, to, e);
                results.push(LatencyResult {
                    pair: format!("{} → {}", from, to),
                    latency_ms: 0,
                    success: false,
                    in_amount: 0.0,
                    out_amount: 0.0,
                });
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Stats
    let successful: Vec<_> = results.iter().filter(|r| r.success).collect();
    if !successful.is_empty() {
        let avg = successful.iter().map(|r| r.latency_ms).sum::<u128>() / successful.len() as u128;
        let min = successful.iter().map(|r| r.latency_ms).min().unwrap_or(0);
        let max = successful.iter().map(|r| r.latency_ms).max().unwrap_or(0);

        println!("\n  📈 Latency Stats:");
        println!("     Min: {}ms | Avg: {}ms | Max: {}ms", min, avg, max);
        println!(
            "     Success Rate: {}/{}",
            successful.len(),
            results.len()
        );
    }

    results
}

async fn test_triangular_arbitrage(client: &Client) -> Vec<TriangularResult> {
    println!("\n============================================================");
    println!("🔺 TRIANGULAR ARBITRAGE TEST");
    println!("============================================================\n");

    let paths = vec![
        ("SOL", "USDC", "BONK", SOL_MINT, USDC_MINT, BONK_MINT),
        ("SOL", "USDC", "JUP", SOL_MINT, USDC_MINT, JUP_MINT),
        ("SOL", "USDC", "WIF", SOL_MINT, USDC_MINT, WIF_MINT),
        ("SOL", "mSOL", "USDC", SOL_MINT, MSOL_MINT, USDC_MINT),
    ];

    let mut results = Vec::new();
    let test_amount = 10 * LAMPORTS_PER_SOL; // 10 SOL

    for (a, b, c, mint_a, mint_b, mint_c) in paths {
        println!("  Testing: {} → {} → {} → {}", a, b, c, a);

        let start = Instant::now();

        // Leg 1: A → B
        let leg1 = get_quote(client, mint_a, mint_b, test_amount).await;
        if leg1.is_err() {
            println!("    ❌ Leg 1 failed\n");
            continue;
        }
        let (q1, _) = leg1.unwrap();
        let amount_b: u64 = q1.out_amount.parse().unwrap_or(0);

        // Leg 2: B → C
        let leg2 = get_quote(client, mint_b, mint_c, amount_b).await;
        if leg2.is_err() {
            println!("    ❌ Leg 2 failed\n");
            continue;
        }
        let (q2, _) = leg2.unwrap();
        let amount_c: u64 = q2.out_amount.parse().unwrap_or(0);

        // Leg 3: C → A
        let leg3 = get_quote(client, mint_c, mint_a, amount_c).await;
        if leg3.is_err() {
            println!("    ❌ Leg 3 failed\n");
            continue;
        }
        let (q3, _) = leg3.unwrap();
        let final_amount: u64 = q3.out_amount.parse().unwrap_or(0);

        let total_latency = start.elapsed().as_millis();

        // Calculate profits
        let gross_profit = final_amount as i64 - test_amount as i64;
        let gross_pct = (gross_profit as f64 / test_amount as f64) * 100.0;

        // Costs: 0.01% flash loan + ~0.003 SOL gas
        let flash_fee = (test_amount as f64 * 0.0001) as i64;
        let gas_cost = (0.003 * LAMPORTS_PER_SOL as f64) as i64;
        let net_profit = gross_profit - flash_fee - gas_cost;
        let net_pct = (net_profit as f64 / test_amount as f64) * 100.0;

        let profitable = net_pct > 0.0;
        let status = if profitable { "✅ PROFIT" } else { "❌ Loss" };

        println!("    Latency: {}ms (all 3 legs)", total_latency);
        println!(
            "    Input:  {:.4} SOL → Output: {:.4} SOL",
            test_amount as f64 / LAMPORTS_PER_SOL as f64,
            final_amount as f64 / LAMPORTS_PER_SOL as f64
        );
        println!(
            "    Gross: {:+.4}% | Net: {:+.4}% | {}",
            gross_pct, net_pct, status
        );
        println!();

        results.push(TriangularResult {
            path: format!("{} → {} → {} → {}", a, b, c, a),
            latency_ms: total_latency,
            gross_pct,
            net_pct,
            profitable,
        });

        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    results
}

async fn test_cross_dex_arbitrage(client: &Client) {
    println!("\n============================================================");
    println!("🔄 CROSS-DEX ARBITRAGE TEST (Round-trip)");
    println!("============================================================\n");

    let tokens = vec![
        ("BONK", BONK_MINT),
        ("JUP", JUP_MINT),
        ("WIF", WIF_MINT),
        ("mSOL", MSOL_MINT),
    ];

    let test_amount = 10 * LAMPORTS_PER_SOL;

    for (name, mint) in tokens {
        println!("  Testing SOL → {} → SOL:", name);

        let start = Instant::now();

        // Buy
        let buy = get_quote(client, SOL_MINT, mint, test_amount).await;
        if buy.is_err() {
            println!("    ❌ Buy failed\n");
            continue;
        }
        let (buy_quote, _) = buy.unwrap();
        let token_amount: u64 = buy_quote.out_amount.parse().unwrap_or(0);

        // Sell
        let sell = get_quote(client, mint, SOL_MINT, token_amount).await;
        if sell.is_err() {
            println!("    ❌ Sell failed\n");
            continue;
        }
        let (sell_quote, _) = sell.unwrap();
        let return_amount: u64 = sell_quote.out_amount.parse().unwrap_or(0);

        let latency = start.elapsed().as_millis();

        let gross_profit = return_amount as i64 - test_amount as i64;
        let gross_pct = (gross_profit as f64 / test_amount as f64) * 100.0;

        let flash_fee = (test_amount as f64 * 0.0001) as i64;
        let gas_cost = (0.002 * LAMPORTS_PER_SOL as f64) as i64;
        let net_profit = gross_profit - flash_fee - gas_cost;
        let net_pct = (net_profit as f64 / test_amount as f64) * 100.0;

        let status = if net_pct > 0.0 {
            "✅ PROFIT"
        } else {
            "❌ Loss"
        };

        println!("    Latency: {}ms", latency);
        println!(
            "    10 SOL → {:.2} {} → {:.4} SOL",
            if name == "BONK" {
                token_amount as f64 / 100000.0
            } else {
                token_amount as f64 / LAMPORTS_PER_SOL as f64
            },
            name,
            return_amount as f64 / LAMPORTS_PER_SOL as f64
        );
        println!(
            "    Gross: {:+.4}% | Net: {:+.4}% | {}",
            gross_pct, net_pct, status
        );
        println!();

        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn test_burst_latency(client: &Client) {
    println!("\n============================================================");
    println!("⚡ BURST LATENCY TEST (10 rapid quotes)");
    println!("============================================================\n");

    let mut latencies = Vec::new();
    let test_amount = LAMPORTS_PER_SOL;

    for i in 1..=10 {
        let start = Instant::now();
        let result = get_quote(client, SOL_MINT, USDC_MINT, test_amount).await;
        let elapsed = start.elapsed().as_millis();

        if result.is_ok() {
            latencies.push(elapsed);
            println!("  Quote {}: {}ms", i, elapsed);
        } else {
            println!("  Quote {}: FAILED", i);
        }
    }

    if !latencies.is_empty() {
        let avg = latencies.iter().sum::<u128>() / latencies.len() as u128;
        let min = *latencies.iter().min().unwrap();
        let max = *latencies.iter().max().unwrap();

        // Calculate P95
        let mut sorted = latencies.clone();
        sorted.sort();
        let p95_idx = (sorted.len() as f64 * 0.95) as usize;
        let p95 = sorted.get(p95_idx.min(sorted.len() - 1)).unwrap_or(&0);

        println!("\n  📈 Burst Stats:");
        println!("     Min: {}ms | Avg: {}ms | Max: {}ms | P95: {}ms", min, avg, max, p95);
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    println!(
        r#"
╔═══════════════════════════════════════════════════════════════════════════════╗
║           🧪 MEV BOT - LATENCY & STRATEGY TESTER 🧪                           ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Testing:                                                                     ║
║  • Jupiter API latency (single quotes)                                        ║
║  • Triangular arbitrage calculations                                          ║
║  • Cross-DEX round-trip profitability                                         ║
║  • Burst latency under load                                                   ║
║                                                                               ║
║  Flash Loan Fee: 0.01% (Mango) | Gas: ~0.002-0.003 SOL                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"#
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    // Run all tests
    test_single_quote_latency(&client).await;
    test_triangular_arbitrage(&client).await;
    test_cross_dex_arbitrage(&client).await;
    test_burst_latency(&client).await;

    println!("\n============================================================");
    println!("✅ ALL TESTS COMPLETE");
    println!("============================================================\n");

    Ok(())
}
