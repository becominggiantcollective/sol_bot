use anyhow::{Context, Result};
use std::collections::HashMap;
use tokio_stream::StreamExt;
use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::prelude::{SubscribeRequest, SubscribeUpdateBlock};

/// A Yellowstone gRPC client for logging Solana block updates
pub struct BlockLogger {
    endpoint: String,
}

impl BlockLogger {
    /// Create a new BlockLogger instance
    pub fn new(endpoint: &str) -> Self {
        Self {
            endpoint: endpoint.to_string(),
        }
    }

    /// Start the block logging process
    pub async fn start(&self) -> Result<()> {
        println!("🚀 Starting Yellowstone gRPC Block Logger");
        println!("📍 Connecting to: {}", self.endpoint);

        // Create interceptor (None means no authentication token)
        // If you need an auth token, replace None with Some("your_token".to_string())
        let auth_token: Option<String> = None;

        // Connect to the gRPC endpoint using the builder pattern
        let builder = GeyserGrpcClient::build_from_shared(self.endpoint.clone())
            .context("Failed to build gRPC client")?;
            
        let mut client = builder
            .x_token(auth_token)
            .map_err(|e| anyhow::anyhow!("Failed to set token: {}", e))?
            .connect()
            .await
            .context("Failed to connect to Yellowstone gRPC endpoint")?;

        println!("✅ Connected successfully!");

        // Create subscription request for blocks
        let mut blocks = HashMap::new();
        blocks.insert("client".to_string(), yellowstone_grpc_proto::prelude::SubscribeRequestFilterBlocks {
            account_include: vec![],
            include_transactions: Some(true),
            include_accounts: Some(false), 
            include_entries: Some(false),
        });

        let request = SubscribeRequest {
            from_slot: None,
            slots: HashMap::new(),
            accounts: HashMap::new(),
            transactions: HashMap::new(),
            transactions_status: HashMap::new(),
            blocks,
            blocks_meta: HashMap::new(),
            entry: HashMap::new(),
            commitment: None,
            accounts_data_slice: vec![],
            ping: None,
        };

        println!("📡 Starting block subscription...");

        // Subscribe to block updates
        let mut stream = client
            .subscribe_once(request)
            .await
            .context("Failed to create subscription stream")?;

        println!("🎯 Block logger started! Listening for block updates...");

        // Process incoming updates
        while let Some(update) = stream.next().await {
            match update {
                Ok(update) => {
                    if let Some(update_oneof) = update.update_oneof {
                        match update_oneof {
                            yellowstone_grpc_proto::prelude::subscribe_update::UpdateOneof::Block(block) => {
                                self.log_block_update(&block).await;
                                
                                // TODO: Add transaction processing logic
                                self.process_transactions(&block).await;
                                
                                // TODO: Add mempool monitoring logic
                                self.monitor_mempool().await;
                                
                                // TODO: Add arbitrage opportunity detection
                                self.detect_arbitrage_opportunities(&block).await;
                            }
                            _ => {
                                println!("📊 Received non-block update");
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ Error receiving update: {}", e);
                    // Consider reconnection logic here
                    break;
                }
            }
        }

        println!("🔄 Stream ended. Exiting...");
        Ok(())
    }

    /// Log block update information to console
    async fn log_block_update(&self, block: &SubscribeUpdateBlock) {
        let slot = block.slot;
        let blockhash = &block.blockhash;
        let parent_slot = block.parent_slot;
        
        // Handle optional fields safely
        let block_time = block.block_time.map(|t| format!("{}", t.timestamp)).unwrap_or_else(|| "N/A".to_string());
        let transaction_count = block.transactions.len();

        println!(
            "📦 Block #{} | Hash: {}...{} | Parent: {} | Time: {} | Txs: {}",
            slot,
            &blockhash[..8.min(blockhash.len())],
            &blockhash[blockhash.len().saturating_sub(8)..],
            parent_slot,
            block_time,
            transaction_count
        );

        if let Some(block_height) = block.block_height {
            println!("   📏 Height: {}", block_height.block_height);
        }
        
        // Handle rewards safely
        if let Some(rewards) = &block.rewards {
            if !rewards.rewards.is_empty() {
                println!("   🎁 Rewards: {} entries", rewards.rewards.len());
            }
        }
    }

    /// TODO: Process transactions within the block
    async fn process_transactions(&self, block: &SubscribeUpdateBlock) {
        // TODO: Implement transaction processing logic
        // - Parse transaction instructions
        // - Identify DEX trades (Jupiter, Orca, Raydium, etc.)
        // - Extract price information 
        // - Detect large volume transactions
        // - Monitor for specific program interactions
        
        if !block.transactions.is_empty() {
            println!("   🔄 TODO: Analyze {} transactions for trading opportunities", block.transactions.len());
            
            // Example: Log first few transaction signatures  
            for (i, tx) in block.transactions.iter().take(3).enumerate() {
                let signature = hex::encode(&tx.signature);
                println!("     - Tx {}: {}...{}", i+1, &signature[..8], &signature[signature.len()-8..]);
            }
            if block.transactions.len() > 3 {
                println!("     - ... and {} more transactions", block.transactions.len() - 3);
            }
        }
    }

    /// TODO: Monitor mempool for pending transactions
    async fn monitor_mempool(&self) {
        // TODO: Implement mempool monitoring logic
        // - Subscribe to pending transactions
        // - Analyze transaction patterns before they hit blocks
        // - Detect frontrunning opportunities
        // - Monitor gas price trends
        // - Build pending transaction pool for analysis
        
        // Uncomment for verbose logging:
        // println!("   📊 TODO: Monitor mempool for pending transactions");
    }

    /// TODO: Detect arbitrage opportunities from block data
    async fn detect_arbitrage_opportunities(&self, _block: &SubscribeUpdateBlock) {
        // TODO: Implement arbitrage detection logic
        // - Compare prices across different DEXes (Jupiter, Orca, Raydium, Serum)
        // - Calculate potential profit margins after fees
        // - Account for transaction fees and slippage
        // - Identify flashloan opportunities  
        // - Execute arbitrage strategies automatically
        // - Monitor for liquidation opportunities in lending protocols
        
        // Uncomment for verbose logging:
        // println!("   💰 TODO: Scan for arbitrage opportunities");
    }
}

/// Main function to demonstrate the block logger
#[tokio::main]
async fn main() -> Result<()> {
    // Use a configurable endpoint
    let endpoint = std::env::var("YELLOWSTONE_GRPC_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:10000".to_string());
    
    println!("🌟 Yellowstone gRPC Block Logger for Solana");
    println!("📍 Endpoint: {}", endpoint);
    println!("💡 Set YELLOWSTONE_GRPC_ENDPOINT environment variable to use a different endpoint");
    println!("💡 Example endpoints:");
    println!("   - http://127.0.0.1:10000 (local)");
    println!("   - http://mainnet-beta.grpc.yellowstone.dev:10000");
    println!();
    
    let logger = BlockLogger::new(&endpoint);
    
    // Start logging (this will run indefinitely)
    if let Err(e) = logger.start().await {
        eprintln!("💥 Logger failed: {}", e);
        println!("💡 Make sure your Yellowstone gRPC endpoint is correct and accessible");
        std::process::exit(1);
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logger_creation() {
        let endpoint = "http://test-endpoint:10000";
        let logger = BlockLogger::new(endpoint);
        assert_eq!(logger.endpoint, endpoint);
    }

    #[test] 
    fn test_default_endpoint() {
        let logger = BlockLogger::new("http://127.0.0.1:10000");
        assert_eq!(logger.endpoint, "http://127.0.0.1:10000");
    }

    #[test]
    fn test_production_endpoint() {
        let logger = BlockLogger::new("http://mainnet-beta.grpc.yellowstone.dev:10000");
        assert_eq!(logger.endpoint, "http://mainnet-beta.grpc.yellowstone.dev:10000");
    }
}