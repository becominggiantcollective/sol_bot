# Flash Loan Receiver Program

This is a Solana program that receives flash loans from SPL Token Lending and executes arbitrage trades.

## Why You Need This

With 0.062 SOL, you can't execute large arbitrage trades. BUT with flashloans, you can:
- Borrow MILLIONS of dollars worth of tokens
- Execute arbitrage trades
- Repay the loan + fee
- Keep the profit
- All in ONE transaction using just your 0.062 SOL for gas!

## Quick Setup

### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Install Solana CLI
```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

### 3. Create Solana Keypair for Program
```bash
solana-keygen new --outfile ~/.config/solana/flashloan-receiver-keypair.json
```

### 4. Build the Program
```bash
cd flashloan-receiver
cargo build-bpf
```

### 5. Deploy to Devnet (FREE - for testing)
```bash
# Switch to devnet
solana config set --url https://api.devnet.solana.com

# Airdrop some SOL for deployment (FREE on devnet)
solana airdrop 2

# Deploy the program
solana program deploy target/deploy/flashloan_receiver.so
```

This will give you a program ID like: `7abc123...xyz`

### 6. Deploy to Mainnet (when ready)
```bash
# Switch to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# You'll need ~2-3 SOL for deployment (one-time cost)
# Deploy the program
solana program deploy target/deploy/flashloan_receiver.so
```

### 7. Update Your Bot
Add the deployed program ID to `src/core/flashloan.ts`:
```typescript
// Replace this line:
programId = new PublicKey('LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi');

// With your deployed program ID:
programId = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID_HERE');
```

## How Flash Loans Work

1. Bot detects arbitrage opportunity (e.g., 0.5% profit)
2. Bot calls SPL Token Lending to borrow $100,000 worth of SOL (0.03% fee)
3. Flash loan receiver program receives the funds
4. Bot executes arbitrage trades with the borrowed funds
5. Bot repays $100,000 + $30 fee (0.03%)
6. Bot keeps $470 profit (0.5% - 0.03% = 0.47%)
7. **All happens in ONE transaction!**

With just 0.062 SOL for gas, you can now trade with millions! 🚀

## Cost Breakdown

- Deployment to devnet: **FREE** (for testing)
- Deployment to mainnet: **~2-3 SOL one-time** (program rent)
- Per trade gas: **~0.00001 SOL** (very cheap!)
- Flash loan fee: **0.03%** of borrowed amount
- Your capital at risk: **0.062 SOL only** (just for gas)

## Example Trade

Opportunity: Buy SOL on Orca, sell on Raydium for 0.5% profit

**Without flashloan (your current setup):**
- Capital: 0.062 SOL ($12)
- Profit: $0.06 (0.5% of $12)
- Not worth the gas fees!

**With flashloan:**
- Borrow: 1000 SOL ($200,000)
- Profit: $1,000 (0.5% of $200,000)
- Fee: $60 (0.03% of $200,000)
- Net profit: **$940 per trade!**
- Your risk: Just 0.062 SOL for gas

## Next Steps

1. Deploy receiver program to devnet
2. Test with devnet tokens (FREE)
3. Once working, deploy to mainnet
4. Start making real profits!

## Need Help?

If you get stuck deploying, let me know and I'll walk you through it step by step!
