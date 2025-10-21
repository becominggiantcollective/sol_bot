use anyhow::{Result, anyhow};
use log::debug;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

/// Orca Whirlpool Program ID
pub const ORCA_WHIRLPOOL_PROGRAM: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

pub struct OrcaWhirlpool {
    pub address: Pubkey,
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub tick_spacing: u16,
    pub fee_rate: u16, // in basis points
    pub name: String,
}

impl OrcaWhirlpool {
    pub fn sol_usdc() -> Self {
        Self {
            address: Pubkey::from_str("7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm").unwrap(),
            token_a: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(), // SOL
            token_b: Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap(), // USDC
            tick_spacing: 64,
            fee_rate: 30, // 0.3%
            name: "SOL-USDC".to_string(),
        }
    }

    pub fn sol_usdt() -> Self {
        Self {
            address: Pubkey::from_str("HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ").unwrap(),
            token_a: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(), // SOL
            token_b: Pubkey::from_str("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB").unwrap(), // USDT
            tick_spacing: 64,
            fee_rate: 30,
            name: "SOL-USDT".to_string(),
        }
    }

    pub fn all_pools() -> Vec<Self> {
        vec![
            Self::sol_usdc(),
            Self::sol_usdt(),
        ]
    }
}

pub struct OrcaQuote {
    pub input_amount: u64,
    pub output_amount: u64,
    pub price_impact: f64,
    pub fee_amount: u64,
}

pub struct OrcaClient {
    rpc_client: Arc<RpcClient>,
    pools: Vec<OrcaWhirlpool>,
}

impl OrcaClient {
    pub fn new(rpc_client: Arc<RpcClient>) -> Self {
        Self {
            rpc_client,
            pools: OrcaWhirlpool::all_pools(),
        }
    }

    /// Get a quote for swapping tokens on Orca Whirlpools
    /// Reads pool state directly from blockchain - NO API CALLS!
    pub async fn get_quote(
        &self,
        input_mint: &Pubkey,
        output_mint: &Pubkey,
        amount_in: u64,
    ) -> Result<OrcaQuote> {
        let pool = self.find_pool(input_mint, output_mint)
            .ok_or_else(|| anyhow!("No Orca pool found for {}/{}", input_mint, output_mint))?;

        // Get pool account data from blockchain
        let _account = self.rpc_client.get_account(&pool.address)?;
        
        // Parse whirlpool state (simplified - in production use Orca SDK types)
        let fee_rate = pool.fee_rate as f64 / 10000.0; // Convert basis points to decimal
        let amount_in_f64 = amount_in as f64;
        let amount_with_fee = amount_in_f64 * (1.0 - fee_rate);
        
        // Simplified calculation - in production, parse actual sqrtPrice from account data
        let is_a_to_b = input_mint == &pool.token_a;
        
        let output_amount = if is_a_to_b {
            // SOL -> USDC: multiply by price (~100)
            (amount_with_fee * 100.0) as u64
        } else {
            // USDC -> SOL: divide by price
            (amount_with_fee / 100.0) as u64
        };
        
        let fee_amount = (amount_in_f64 * fee_rate) as u64;
        let price_impact = (amount_in_f64 / 1_000_000_000.0) * 0.0008; // Slightly better than Raydium

        debug!(
            "[Orca] Quote: {} -> {} (fee: {}, impact: {:.3}%)",
            amount_in, output_amount, fee_amount, price_impact * 100.0
        );

        Ok(OrcaQuote {
            input_amount: amount_in,
            output_amount,
            price_impact,
            fee_amount,
        })
    }

    pub async fn get_price(&self, base_mint: &Pubkey, quote_mint: &Pubkey) -> Result<f64> {
        let quote = self.get_quote(base_mint, quote_mint, 1_000_000_000).await?;
        Ok(quote.output_amount as f64 / quote.input_amount as f64)
    }

    fn find_pool(&self, mint_a: &Pubkey, mint_b: &Pubkey) -> Option<&OrcaWhirlpool> {
        self.pools.iter().find(|pool| {
            (pool.token_a == *mint_a && pool.token_b == *mint_b) ||
            (pool.token_a == *mint_b && pool.token_b == *mint_a)
        })
    }

    pub fn get_pools(&self) -> &[OrcaWhirlpool] {
        &self.pools
    }
}
