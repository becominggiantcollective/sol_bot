# Yellowstone gRPC Block Logger

This Rust module demonstrates how to connect to a Yellowstone gRPC endpoint and log Solana block updates. It serves as a template for building arbitrage and MEV bots on Solana.

## Features

- ✅ Connects to Yellowstone gRPC endpoints for real-time Solana data
- ✅ Logs block updates with comprehensive information
- ✅ Demonstrates async streaming with tokio and tokio_stream
- ✅ Includes TODO stubs for transaction/mempool/arbitrage logic
- ✅ Configurable endpoint via environment variable
- ✅ Proper error handling and reconnection patterns

## Usage

### Running the Logger

```bash
# Build the project
cargo build --bin logger

# Run with default local endpoint
cargo run --bin logger

# Run with custom endpoint
YELLOWSTONE_GRPC_ENDPOINT="http://mainnet-beta.grpc.yellowstone.dev:10000" cargo run --bin logger
```

### Using as a Library

```rust
use sol_bot::BlockLogger;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let logger = BlockLogger::new("http://127.0.0.1:10000");
    logger.start().await?;
    Ok(())
}
```

## Configuration

The logger can be configured via environment variables:

- `YELLOWSTONE_GRPC_ENDPOINT`: The gRPC endpoint to connect to
  - Default: `http://127.0.0.1:10000`
  - Examples:
    - `http://mainnet-beta.grpc.yellowstone.dev:10000`
    - `https://triton.yellowstone-grpc.rpcpool.com`

## TODO Implementation Areas

The logger includes well-defined TODO sections for extending functionality:

### 1. Transaction Processing (`process_transactions`)
- Parse transaction instructions
- Identify DEX trades (Jupiter, Orca, Raydium, etc.)
- Extract price information
- Detect large volume transactions
- Monitor for specific program interactions

### 2. Mempool Monitoring (`monitor_mempool`)
- Subscribe to pending transactions
- Analyze transaction patterns before they hit blocks
- Detect frontrunning opportunities
- Monitor gas price trends
- Build pending transaction pool for analysis

### 3. Arbitrage Detection (`detect_arbitrage_opportunities`)
- Compare prices across different DEXes
- Calculate potential profit margins after fees
- Account for transaction fees and slippage
- Identify flashloan opportunities
- Execute arbitrage strategies automatically
- Monitor for liquidation opportunities in lending protocols

## Example Output

```
🌟 Yellowstone gRPC Block Logger for Solana
📍 Endpoint: http://127.0.0.1:10000
💡 Set YELLOWSTONE_GRPC_ENDPOINT environment variable to use a different endpoint
💡 Example endpoints:
   - http://127.0.0.1:10000 (local)
   - http://mainnet-beta.grpc.yellowstone.dev:10000

🚀 Starting Yellowstone gRPC Block Logger
📍 Connecting to: http://127.0.0.1:10000
✅ Connected successfully!
📡 Starting block subscription...
🎯 Block logger started! Listening for block updates...

📦 Block #123456789 | Hash: abc12345...def67890 | Parent: 123456788 | Time: 1640995200 | Txs: 42
   📏 Height: 123456789
   🎁 Rewards: 3 entries
   🔄 TODO: Analyze 42 transactions for trading opportunities
     - Tx 1: a1b2c3d4...e5f6g7h8
     - Tx 2: i9j0k1l2...m3n4o5p6
     - Tx 3: q7r8s9t0...u1v2w3x4
     - ... and 39 more transactions
```

## Dependencies

The logger uses the following key dependencies:

- `yellowstone-grpc-client = "9.0"` - Yellowstone gRPC client
- `yellowstone-grpc-proto = "9.0"` - Protocol definitions
- `tokio = { version = "1", features = ["full"] }` - Async runtime
- `tokio-stream = "0.1"` - Async streaming utilities
- `anyhow = "1.0"` - Error handling
- `tonic = "0.14"` - gRPC support
- `hex = "0.4"` - Hex encoding for transaction signatures

## Architecture

The `BlockLogger` struct provides a clean interface for:

1. **Connection Management**: Handles gRPC connection setup with proper error handling
2. **Subscription Management**: Sets up block subscriptions with appropriate filters
3. **Data Processing**: Processes incoming block updates with extensible TODO sections
4. **Logging**: Provides comprehensive logging of block information

## Development

### Running Tests

```bash
cargo test --lib
```

### Code Structure

- `src/logger.rs` - Main logger implementation
- `src/lib.rs` - Library interface
- `Cargo.toml` - Dependencies and binary configuration

## Next Steps

This template provides a solid foundation for building Solana MEV bots. To extend it:

1. Implement the TODO sections based on your specific use case
2. Add database integration for storing historical data
3. Implement trading logic and strategy execution
4. Add monitoring and alerting capabilities
5. Integrate with flashloan providers
6. Add comprehensive testing and simulation capabilities

## License

MIT License - see the repository license file for details.