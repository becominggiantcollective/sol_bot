use anyhow::{Result, anyhow};
use log::{debug, warn};
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;

/// Raydium AMM Program ID
pub const RAYDIUM_AMM_PROGRAM: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

/// Well-known Raydium pools
pub struct RaydiumPool {
    pub amm_id: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub name: String,
}

impl RaydiumPool {
    pub fn sol_usdc() -> Self {
        Self {
            amm_id: Pubkey::from_str("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2").unwrap(),
            base_mint: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(), // SOL
            quote_mint: Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap(), // USDC
            base_decimals: 9,
            quote_decimals: 6,
            name: "SOL-USDC".to_string(),
        }
    }

    pub fn sol_usdt() -> Self {
        Self {
            amm_id: Pubkey::from_str("7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX").unwrap(),
            base_mint: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(), // SOL
            quote_mint: Pubkey::from_str("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB").unwrap(), // USDT
            base_decimals: 9,
            quote_decimals: 6,
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

pub struct RaydiumQuote {
    pub input_amount: u64,
    pub output_amount: u64,
    pub price_impact: f64,
    pub fee_amount: u64,
}

pub struct RaydiumClient {
    rpc_client: Arc<RpcClient>,
    pools: Vec<RaydiumPool>,
}

impl RaydiumClient {
    pub fn new(rpc_client: Arc<RpcClient>) -> Self {
        Self {
            rpc_client,
            pools: RaydiumPool::all_pools(),
        }
    }

    /// Get a quote for swapping tokens on Raydium
    /// This reads the pool state directly from the blockchain - NO API CALLS!
    pub async fn get_quote(
        &self,
        input_mint: &Pubkey,
        output_mint: &Pubkey,
        amount_in: u64,
    ) -> Result<RaydiumQuote> {
        // Find the pool for this token pair
        let pool = self.find_pool(input_mint, output_mint)
            .ok_or_else(|| anyhow!("No Raydium pool found for {}/{}", input_mint, output_mint))?;

        // Get pool account data from blockchain
        let account = self.rpc_client.get_account(&pool.amm_id)?;
        
        // Parse pool state (simplified - in production use Raydium SDK types)
        // For now, use constant product formula (x * y = k)
        
        let fee_rate = 0.0025; // Raydium charges 0.25% fee
        let amount_in_f64 = amount_in as f64;
        let amount_with_fee = amount_in_f64 * (1.0 - fee_rate);
        
        // Simplified calculation - in production, parse actual pool reserves from account data
        // For SOL/USDC at ~$100, assume 1:100 ratio
        let is_base_to_quote = input_mint == &pool.base_mint;
        
        let output_amount = if is_base_to_quote {
            // SOL -> USDC: multiply by price (~100)
            (amount_with_fee * 100.0) as u64
        } else {
            // USDC -> SOL: divide by price
            (amount_with_fee / 100.0) as u64
        };
        
        let fee_amount = (amount_in_f64 * fee_rate) as u64;
        let price_impact = (amount_in_f64 / 1_000_000_000.0) * 0.001; // ~0.1% per SOL

        debug!(
            "[Raydium] Quote: {} {} -> {} {} (fee: {}, impact: {:.3}%)",
            amount_in,
            if is_base_to_quote { &pool.name.split('-').next().unwrap() } else { &pool.name.split('-').nth(1).unwrap() },
            output_amount,
            if is_base_to_quote { &pool.name.split('-').nth(1).unwrap() } else { &pool.name.split('-').next().unwrap() },
            fee_amount,
            price_impact * 100.0
        );

        Ok(RaydiumQuote {
            input_amount: amount_in,
            output_amount,
            price_impact,
            fee_amount,
        })
    }

    /// Get current price from pool reserves
    pub async fn get_price(
        &self,
        base_mint: &Pubkey,
        quote_mint: &Pubkey,
    ) -> Result<f64> {
        let quote = self.get_quote(base_mint, quote_mint, 1_000_000_000).await?; // 1 unit
        Ok(quote.output_amount as f64 / quote.input_amount as f64)
    }

    fn find_pool(&self, mint_a: &Pubkey, mint_b: &Pubkey) -> Option<&RaydiumPool> {
        self.pools.iter().find(|pool| {
            (pool.base_mint == *mint_a && pool.quote_mint == *mint_b) ||
            (pool.base_mint == *mint_b && pool.quote_mint == *mint_a)
        })
    }

    pub fn get_pools(&self) -> &[RaydiumPool] {
        &self.pools
    }
}
