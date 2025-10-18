use anyhow::{Result, anyhow};
use colored::Colorize;
use log::{info, debug, warn};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::Keypair,
};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use crate::raydium::RaydiumClient;
use crate::orca::OrcaClient;
use crate::marginfi::MarginFiClient;
use crate::config::Config;

#[derive(Debug)]
pub struct ArbitrageOpportunity {
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    pub raydium_output: Option<u64>,
    pub orca_output: Option<u64>,
    pub best_dex: String,
    pub best_output: u64,
    pub profit: u64,
    pub profit_percent: f64,
    pub route: String,
}

pub struct ScanResults {
    pub opportunities_found: usize,
    pub trades_executed: usize,
    pub total_profit: f64,
}

pub struct ArbitrageEngine {
    rpc_client: Arc<RpcClient>,
    wallet: Arc<Keypair>,
    config: Config,
    raydium: RaydiumClient,
    orca: OrcaClient,
    marginfi: MarginFiClient,
    // Statistics
    total_scans: u64,
    total_opportunities: u64,
    total_trades: u64,
    total_profit: f64,
}

impl ArbitrageEngine {
    pub async fn new(
        rpc_client: Arc<RpcClient>,
        wallet: Arc<Keypair>,
        config: Config,
    ) -> Result<Self> {
        let raydium = RaydiumClient::new(rpc_client.clone());
        let orca = OrcaClient::new(rpc_client.clone());
        let marginfi = MarginFiClient::new();

        Ok(Self {
            rpc_client,
            wallet,
            config,
            raydium,
            orca,
            marginfi,
            total_scans: 0,
            total_opportunities: 0,
            total_trades: 0,
            total_profit: 0.0,
        })
    }

    /// Main scan and execute loop
    pub async fn scan_and_execute(&mut self) -> Result<ScanResults> {
        self.total_scans += 1;
        
        // Define tokens to scan
        let tokens = vec![
            Pubkey::from_str("So11111111111111111111111111111111111111112")?, // SOL
            Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?, // USDC
            Pubkey::from_str("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")?, // USDT
        ];

        // Scan for opportunities
        let opportunities = self.detect_opportunities(&tokens).await?;
        
        if opportunities.is_empty() {
            return Ok(ScanResults {
                opportunities_found: 0,
                trades_executed: 0,
                total_profit: 0.0,
            });
        }

        // Display opportunities
        self.display_opportunities(&opportunities);
        
        // Execute profitable trades
        let mut trades_executed = 0;
        let mut total_profit = 0.0;

        for opp in &opportunities {
            if opp.profit_percent >= self.config.min_profit_threshold {
                info!("{}", format!("🎯 Executing: {}", opp.route).bright_yellow().bold());
                
                match self.execute_arbitrage(opp).await {
                    Ok(profit) => {
                        trades_executed += 1;
                        total_profit += profit;
                        self.total_trades += 1;
                        self.total_profit += profit;
                        info!("{}", format!("✅ Trade successful! Profit: {} SOL", profit).bright_green().bold());
                    }
                    Err(e) => {
                        warn!("{}", format!("❌ Trade failed: {}", e).bright_red());
                    }
                }
            }
        }

        Ok(ScanResults {
            opportunities_found: opportunities.len(),
            trades_executed,
            total_profit,
        })
    }

    /// Detect arbitrage opportunities across DEXes
    async fn detect_opportunities(&self, tokens: &[Pubkey]) -> Result<Vec<ArbitrageOpportunity>> {
        let mut opportunities = Vec::new();
        let test_amount = 5_000_000_000u64; // 5 SOL

        // Check all token pairs
        for i in 0..tokens.len() {
            for j in i+1..tokens.len() {
                let token_a = &tokens[i];
                let token_b = &tokens[j];

                // Try circular arbitrage: A -> B -> A
                if let Some(opp) = self.check_circular_arbitrage(token_a, token_b, test_amount).await? {
                    opportunities.push(opp);
                }
            }
        }

        // Sort by profitability
        opportunities.sort_by(|a, b| b.profit_percent.partial_cmp(&a.profit_percent).unwrap());
        
        Ok(opportunities)
    }

    /// Check for circular arbitrage opportunity: A -> B -> A
    async fn check_circular_arbitrage(
        &self,
        token_a: &Pubkey,
        token_b: &Pubkey,
        amount: u64,
    ) -> Result<Option<ArbitrageOpportunity>> {
        // Get quotes from both DEXes for A -> B
        let raydium_quote_ab = self.raydium.get_quote(token_a, token_b, amount).await.ok();
        let orca_quote_ab = self.orca.get_quote(token_a, token_b, amount).await.ok();

        if raydium_quote_ab.is_none() && orca_quote_ab.is_none() {
            return Ok(None);
        }

        // Find best DEX for first leg
        let (best_dex_1, amount_b) = if let (Some(ray), Some(orc)) = (&raydium_quote_ab, &orca_quote_ab) {
            if ray.output_amount > orc.output_amount {
                ("Raydium", ray.output_amount)
            } else {
                ("Orca", orc.output_amount)
            }
        } else if let Some(ray) = &raydium_quote_ab {
            ("Raydium", ray.output_amount)
        } else {
            ("Orca", orca_quote_ab.as_ref().unwrap().output_amount)
        };

        // Get quotes for B -> A (reverse)
        let raydium_quote_ba = self.raydium.get_quote(token_b, token_a, amount_b).await.ok();
        let orca_quote_ba = self.orca.get_quote(token_b, token_a, amount_b).await.ok();

        if raydium_quote_ba.is_none() && orca_quote_ba.is_none() {
            return Ok(None);
        }

        // Find best DEX for second leg
        let (best_dex_2, amount_a_final) = if let (Some(ray), Some(orc)) = (&raydium_quote_ba, &orca_quote_ba) {
            if ray.output_amount > orc.output_amount {
                ("Raydium", ray.output_amount)
            } else {
                ("Orca", orc.output_amount)
            }
        } else if let Some(ray) = &raydium_quote_ba {
            ("Raydium", ray.output_amount)
        } else {
            ("Orca", orca_quote_ba.as_ref().unwrap().output_amount)
        };

        // Calculate profit
        let profit = if amount_a_final > amount {
            amount_a_final - amount
        } else {
            return Ok(None); // No profit
        };

        // Account for flashloan fee (0.01%)
        let flashloan_fee = self.marginfi.calculate_fee(amount);
        let net_profit = if profit > flashloan_fee {
            profit - flashloan_fee
        } else {
            return Ok(None);
        };

        let profit_percent = (net_profit as f64) / (amount as f64);

        // Only return if above minimum threshold
        if profit_percent < self.config.min_profit_threshold {
            return Ok(None);
        }

        let token_a_symbol = self.get_token_symbol(token_a);
        let token_b_symbol = self.get_token_symbol(token_b);
        let route = format!("{} → {} ({}) → {} ({}) = +{:.3}%",
            token_a_symbol, token_b_symbol, best_dex_1,
            token_a_symbol, best_dex_2, profit_percent * 100.0
        );

        Ok(Some(ArbitrageOpportunity {
            input_mint: *token_a,
            output_mint: *token_b,
            amount_in: amount,
            raydium_output: raydium_quote_ab.map(|q| q.output_amount),
            orca_output: orca_quote_ab.map(|q| q.output_amount),
            best_dex: format!("{} -> {}", best_dex_1, best_dex_2),
            best_output: amount_a_final,
            profit: net_profit,
            profit_percent,
            route,
        }))
    }

    /// Execute arbitrage trade with flashloan
    async fn execute_arbitrage(&self, opp: &ArbitrageOpportunity) -> Result<f64> {
        // In production, this would:
        // 1. Build MarginFi flashloan instruction
        // 2. Build swap instructions for both legs
        // 3. Add repay flashloan instruction
        // 4. Send transaction with priority fee
        
        // For now, simulate execution
        warn!("{}", "⚠️  SIMULATION MODE - Not executing real transactions yet".yellow());
        warn!("{}", "⚠️  Implement transaction building in production".yellow());
        
        // Simulate success/failure (90% success rate in simulation)
        let success = rand::random::<f64>() > 0.1;
        
        if success {
            Ok(opp.profit as f64 / 1_000_000_000.0) // Convert to SOL
        } else {
            Err(anyhow!("Simulation: Transaction would have failed"))
        }
    }

    fn display_opportunities(&self, opportunities: &[ArbitrageOpportunity]) {
        info!("{}", format!("Found {} opportunities:", opportunities.len()).bright_cyan().bold());
        
        for (i, opp) in opportunities.iter().enumerate().take(5) {
            let profit_sol = opp.profit as f64 / 1_000_000_000.0;
            let profit_display = if opp.profit_percent >= self.config.min_profit_threshold {
                format!("{:.6} SOL ({:.2}%)", profit_sol, opp.profit_percent * 100.0).bright_green().bold()
            } else {
                format!("{:.6} SOL ({:.2}%)", profit_sol, opp.profit_percent * 100.0).bright_black()
            };
            
            info!("  {}. {} → {}", i + 1, opp.route.bright_yellow(), profit_display);
        }
    }

    fn get_token_symbol(&self, mint: &Pubkey) -> String {
        let symbols = HashMap::from([
            ("So11111111111111111111111111111111111111112", "SOL"),
            ("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"),
            ("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"),
            ("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK"),
        ]);
        
        symbols.get(mint.to_string().as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| mint.to_string()[..4].to_string())
    }

    pub fn get_stats(&self) -> (u64, u64, u64, f64) {
        (self.total_scans, self.total_opportunities, self.total_trades, self.total_profit)
    }
}
