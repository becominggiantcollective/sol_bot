use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::env;
use std::str::FromStr;

fn main() {
    // Wallet pubkey selection with safe fallbacks
    let pubkey_str = env::var("WALLET_IDK_PUBLIC_KEY")
        .or_else(|_| env::var("WALLET_PUBLIC_KEY"))
        .or_else(|_| env::var("PRIMARY_PUBLIC_KEY"))
        .unwrap_or_else(|_| {
            eprintln!("Missing WALLET_IDK_PUBLIC_KEY (or WALLET_PUBLIC_KEY/PRIMARY_PUBLIC_KEY). Export it before running.");
            std::process::exit(1);
        });

    let rpc = pick_rpc_endpoint();
    println!("RPC endpoint: {}", rpc);
    println!("Wallet: {}", pubkey_str);

    let client = RpcClient::new(rpc);
    let pubkey = match Pubkey::from_str(&pubkey_str) {
        Ok(pk) => pk,
        Err(err) => {
            eprintln!("Invalid public key: {}", err);
            std::process::exit(1);
        }
    };

    match client.get_balance(&pubkey) {
        Ok(lamports) => {
            let sol = lamports as f64 / 1_000_000_000.0;
            println!("Balance: {} lamports ({} SOL)", lamports, sol);
        }
        Err(err) => {
            eprintln!("Failed to fetch balance: {}", err);
            std::process::exit(1);
        }
    }
}

fn pick_rpc_endpoint() -> String {
    // Priority: RPC_ENDPOINT override -> ALCHEMY -> SOLANA_RPC_URL -> HELIUS -> default mainnet
    if let Ok(rpc) = env::var("RPC_ENDPOINT") {
        return rpc;
    }
    if let Ok(rpc) = env::var("ALCHEMY_RPC_URL") {
        return rpc;
    }
    if let Ok(rpc) = env::var("SOLANA_RPC_URL") {
        return rpc;
    }
    if let Ok(rpc) = env::var("HELIUS_RPC_URL") {
        return rpc;
    }
    "https://api.mainnet-beta.solana.com".to_string()
}
