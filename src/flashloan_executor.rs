/**
 * Flash Loan Transaction Builder (Rust)
 * Replaces executeTriangularFlashloan() from flashLoanScalper.ts
 * Target: < 12ms for full VersionedTransaction construction + signing
 */

use anyhow::{anyhow, Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    address_lookup_table::AddressLookupTableAccount,
    commitment_config::CommitmentConfig,
    compute_budget::ComputeBudgetInstruction,
    instruction::Instruction,
    message::{v0, VersionedMessage},
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    transaction::VersionedTransaction,
};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct FlashloanRoute {
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub token_c: Pubkey,
    pub amount_in: u64,
    pub expected_profit: u64,
}

pub struct FlashloanExecutor {
    rpc_client: Arc<RpcClient>,
    keypair: Arc<Keypair>,
    solend_program: Pubkey,
    jupiter_program: Pubkey,
}

impl FlashloanExecutor {
    pub fn new(
        rpc_url: &str,
        keypair: Keypair,
        solend_program: Option<Pubkey>,
        jupiter_program: Option<Pubkey>,
    ) -> Result<Self> {
        Ok(Self {
            rpc_client: Arc::new(RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            )),
            keypair: Arc::new(keypair),
            solend_program: solend_program.unwrap_or_else(|| {
                Pubkey::from_str("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo").unwrap()
            }),
            jupiter_program: jupiter_program.unwrap_or_else(|| {
                Pubkey::from_str("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4").unwrap()
            }),
        })
    }

    /// Build flash loan borrow instruction (Solend)
    fn build_flashloan_borrow_ix(
        &self,
        reserve: &Pubkey,
        amount: u64,
        user_account: &Pubkey,
    ) -> Result<Instruction> {
        // Solend flash loan instruction data
        // Discriminator: [0x9c, 0x95, 0x3f, 0x31, 0x2e, 0x2c, 0xa7, 0x8c] for flashBorrow
        let mut data = vec![0x9c, 0x95, 0x3f, 0x31, 0x2e, 0x2c, 0xa7, 0x8c];
        data.extend_from_slice(&amount.to_le_bytes());

        Ok(Instruction {
            program_id: self.solend_program,
            accounts: vec![
                // Reserve
                solana_sdk::instruction::AccountMeta::new(*reserve, false),
                // User account
                solana_sdk::instruction::AccountMeta::new(*user_account, true),
                // Instruction sysvar
                solana_sdk::instruction::AccountMeta::new_readonly(
                    solana_sdk::sysvar::instructions::ID,
                    false,
                ),
            ],
            data,
        })
    }

    /// Build flash loan repay instruction (Solend)
    fn build_flashloan_repay_ix(
        &self,
        reserve: &Pubkey,
        amount: u64,
        user_account: &Pubkey,
    ) -> Result<Instruction> {
        // Solend flash loan repay discriminator
        let mut data = vec![0x84, 0x2f, 0xc0, 0xf5, 0x6a, 0x8f, 0x10, 0xb2];
        data.extend_from_slice(&amount.to_le_bytes());

        Ok(Instruction {
            program_id: self.solend_program,
            accounts: vec![
                solana_sdk::instruction::AccountMeta::new(*reserve, false),
                solana_sdk::instruction::AccountMeta::new(*user_account, true),
            ],
            data,
        })
    }

    /// Build Jupiter swap instruction from quote data
    async fn build_jupiter_swap_ix(
        &self,
        quote_data: &[u8],
        user_pubkey: &Pubkey,
    ) -> Result<Instruction> {
        // Jupiter V6 swap instruction
        // In production, fetch this from Jupiter API
        Ok(Instruction {
            program_id: self.jupiter_program,
            accounts: vec![
                solana_sdk::instruction::AccountMeta::new(*user_pubkey, true),
                // Additional accounts from Jupiter quote...
            ],
            data: quote_data.to_vec(),
        })
    }

    /// Build complete triangular flash loan transaction
    /// Returns VersionedTransaction ready to send to Jito
    pub async fn build_triangular_flashloan_tx(
        &self,
        route: &FlashloanRoute,
        priority_fee_microlamports: u64,
        jupiter_quotes: &[Vec<u8>], // Serialized Jupiter quotes for 3 swaps
    ) -> Result<VersionedTransaction> {
        let start = Instant::now();
        let user_pubkey = self.keypair.pubkey();

        // 1. Compute budget instructions (priority fee + compute units)
        let compute_budget_ixs = vec![
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee_microlamports),
            ComputeBudgetInstruction::set_compute_unit_limit(400_000), // 400k CU for flash loan + 3 swaps
        ];

        // 2. Flash loan borrow
        let solend_reserve = Pubkey::from_str("8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36")?; // USDC reserve
        let borrow_ix = self.build_flashloan_borrow_ix(
            &solend_reserve,
            route.amount_in,
            &user_pubkey,
        )?;

        // 3. Three Jupiter swaps (A → B → C → A)
        let mut swap_ixs = Vec::new();
        for quote in jupiter_quotes {
            swap_ixs.push(self.build_jupiter_swap_ix(quote, &user_pubkey).await?);
        }

        // 4. Flash loan repay
        let repay_amount = route.amount_in; // Solend = 0% fee
        let repay_ix = self.build_flashloan_repay_ix(
            &solend_reserve,
            repay_amount,
            &user_pubkey,
        )?;

        // 5. Combine all instructions
        let mut instructions = compute_budget_ixs;
        instructions.push(borrow_ix);
        instructions.extend(swap_ixs);
        instructions.push(repay_ix);

        // 6. Get recent blockhash
        let recent_blockhash = self.rpc_client.get_latest_blockhash().await?;

        // 7. Build VersionedMessage (v0 with lookup tables)
        let message = v0::Message::try_compile(
            &user_pubkey,
            &instructions,
            &[], // Address lookup tables (empty for now)
            recent_blockhash,
        )?;

        // 8. Create VersionedTransaction
        let mut tx = VersionedTransaction {
            signatures: vec![Signature::default()],
            message: VersionedMessage::V0(message),
        };

        // 9. Sign transaction
        let keypair_ref = self.keypair.as_ref();
        match &mut tx.message {
            VersionedMessage::V0(msg) => {
                let signature = keypair_ref.sign_message(&msg.serialize());
                tx.signatures = vec![signature];
            }
            _ => {}
        }

        let elapsed = start.elapsed();
        eprintln!("🚀 Built flash loan tx in {:.2}ms", elapsed.as_secs_f64() * 1000.0);

        Ok(tx)
    }

    /// Send transaction via Jito bundle
    pub async fn send_jito_bundle(
        &self,
        tx: &VersionedTransaction,
        jito_tip_lamports: u64,
    ) -> Result<Signature> {
        let start = Instant::now();

        // Serialize transaction to base64
        let tx_bytes = bincode::serialize(tx)?;
        let tx_base64 = base64::encode(&tx_bytes);

        // Build Jito bundle request
        let jito_url = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
        let bundle_request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendBundle",
            "params": [[tx_base64]]
        });

        // Send to Jito
        let client = reqwest::Client::new();
        let response = client
            .post(jito_url)
            .json(&bundle_request)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;

        let result: serde_json::Value = response.json().await?;
        
        let signature_str = result["result"]
            .as_str()
            .ok_or_else(|| anyhow!("No signature in Jito response"))?;

        let signature = Signature::from_str(signature_str)?;

        let elapsed = start.elapsed();
        eprintln!("🚀 Sent Jito bundle in {:.2}ms", elapsed.as_secs_f64() * 1000.0);

        Ok(signature)
    }
}

// Node.js FFI
#[cfg(feature = "napi")]
use napi_derive::napi;

#[cfg(feature = "napi")]
#[napi(object)]
pub struct JsFlashloanRoute {
    pub token_a: String,
    pub token_b: String,
    pub token_c: String,
    pub amount_in: String, // u64 as string
    pub expected_profit: String,
}

#[cfg(feature = "napi")]
#[napi]
pub struct JsFlashloanExecutor {
    executor: Arc<FlashloanExecutor>,
}

#[cfg(feature = "napi")]
#[napi]
impl JsFlashloanExecutor {
    #[napi(constructor)]
    pub fn new(rpc_url: String, keypair_bytes: Vec<u8>) -> napi::Result<Self> {
        let keypair = Keypair::from_bytes(&keypair_bytes)
            .map_err(|e| napi::Error::from_reason(format!("Invalid keypair: {}", e)))?;

        let executor = FlashloanExecutor::new(&rpc_url, keypair, None, None)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self {
            executor: Arc::new(executor),
        })
    }

    #[napi]
    pub async fn build_and_send_flashloan(
        &self,
        route: JsFlashloanRoute,
        priority_fee: u32,
        jupiter_quotes: Vec<String>, // Base64 encoded
        jito_tip: String,
    ) -> napi::Result<String> {
        let rust_route = FlashloanRoute {
            token_a: Pubkey::from_str(&route.token_a)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?,
            token_b: Pubkey::from_str(&route.token_b)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?,
            token_c: Pubkey::from_str(&route.token_c)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?,
            amount_in: route.amount_in.parse()
                .map_err(|e: std::num::ParseIntError| napi::Error::from_reason(e.to_string()))?,
            expected_profit: route.expected_profit.parse()
                .map_err(|e: std::num::ParseIntError| napi::Error::from_reason(e.to_string()))?,
        };

        // Decode Jupiter quotes
        let decoded_quotes: Result<Vec<Vec<u8>>, _> = jupiter_quotes
            .iter()
            .map(|q| base64::decode(q))
            .collect();
        let decoded_quotes = decoded_quotes
            .map_err(|e| napi::Error::from_reason(format!("Base64 decode error: {}", e)))?;

        // Build transaction
        let tx = self
            .executor
            .build_triangular_flashloan_tx(&rust_route, priority_fee as u64, &decoded_quotes)
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        // Send via Jito
        let jito_tip_lamports: u64 = jito_tip.parse()
            .map_err(|e: std::num::ParseIntError| napi::Error::from_reason(e.to_string()))?;

        let signature = self
            .executor
            .send_jito_bundle(&tx, jito_tip_lamports)
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(signature.to_string())
    }
}
