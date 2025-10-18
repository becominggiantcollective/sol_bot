use anyhow::Result;
use log::info;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

/// MarginFi Program ID
pub const MARGINFI_PROGRAM: &str = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";

/// MarginFi flashloan fee: 0.01% (cheapest on Solana!)
pub const MARGINFI_FLASHLOAN_FEE: f64 = 0.0001;

pub struct MarginFiClient {
    program_id: Pubkey,
}

impl MarginFiClient {
    pub fn new() -> Self {
        Self {
            program_id: Pubkey::from_str(MARGINFI_PROGRAM).unwrap(),
        }
    }

    /// Calculate flashloan fee for a given amount
    pub fn calculate_fee(&self, amount: u64) -> u64 {
        ((amount as f64) * MARGINFI_FLASHLOAN_FEE) as u64
    }

    /// Get maximum flashloan amount for a token
    pub fn get_max_flashloan(&self, _mint: &Pubkey) -> u64 {
        // In production, query the MarginFi bank account to get available liquidity
        // For now, return a conservative estimate
        10_000_000_000 // 10 SOL
    }

    /// Check if a token is supported for flashloans
    pub fn is_supported(&self, mint: &Pubkey) -> bool {
        // MarginFi supports SOL, USDC, USDT, and other major tokens
        let supported_tokens = vec![
            "So11111111111111111111111111111111111111112", // SOL
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
            "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
        ];
        
        supported_tokens.iter().any(|&token| {
            Pubkey::from_str(token).unwrap() == *mint
        })
    }

    pub fn program_id(&self) -> &Pubkey {
        &self.program_id
    }
}

impl Default for MarginFiClient {
    fn default() -> Self {
        Self::new()
    }
}
