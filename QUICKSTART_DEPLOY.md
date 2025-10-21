# ⚡ Quick Start: Deploy Flashloan to Mainnet

**Time needed**: 15-30 minutes  
**Cost**: ~2 SOL (~$300) for mainnet deployment

---

## Prerequisites

You need:
- [x] 2+ SOL for mainnet deployment (or use devnet for free testing)
- [x] Solana CLI installed
- [x] Rust installed

### Install Tools (if not already installed)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify
solana --version
cargo --version
```

---

## Step 1: Generate Deployment Wallet

```bash
# Create a new keypair for deploying
solana-keygen new --outfile ~/.config/solana/mainnet-deployer.json

# This will show your public address - SAVE IT!
# Example: 7xYZ1234...
```

---

## Step 2: Fund Your Deployment Wallet

### For Mainnet:

Transfer ~2 SOL to the address from Step 1.

```bash
# Check your balance
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair ~/.config/solana/mainnet-deployer.json
solana balance

# Should show: 2+ SOL
```

### For Devnet (Free Testing):

```bash
# Switch to devnet
solana config set --url https://api.devnet.solana.com
solana config set --keypair ~/.config/solana/mainnet-deployer.json

# Request free SOL
solana airdrop 2

# Check balance
solana balance
```

---

## Step 3: Deploy Using the Script

The easiest way is to use the provided script:

```bash
cd /path/to/sol_bot

# Run the deployment script
./deploy-flashloan.sh

# Follow the prompts:
# 1. Choose network (1 for devnet, 2 for mainnet)
# 2. Confirm if mainnet
# 3. Wait for deployment (~2 minutes)
```

The script will:
- ✅ Build the flashloan receiver program
- ✅ Deploy to your chosen network
- ✅ Show you the Program ID
- ✅ Save the Program ID to a file

**Example output:**
```
✅ Deployment successful!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Program ID: FLash1234abcd5678efgh...
Network: mainnet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Step 4: Update Bot Configuration

After deployment, update two files:

### 1. Update `.env`

Add the program ID to your `.env` file:

```bash
# Your deployed flashloan receiver program
FLASHLOAN_RECEIVER_PROGRAM_ID=FLash1234abcd5678efgh...

# Other existing config...
WALLET_PRIVATE_KEY=[your,private,key]
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### 2. Update `src/core/flashloan.ts`

Add this line after line 9:

```typescript
export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'spl-token-lending';
  programId = new PublicKey('LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi');
  
  // ADD THIS LINE:
  receiverProgramId = new PublicKey(process.env.FLASHLOAN_RECEIVER_PROGRAM_ID || 'FLash1234abcd5678efgh...');
  
  maxAmount = 100000000000000;
  // ... rest of code
}
```

---

## Step 5: Test the Bot

### Test on Devnet First (Recommended):

```bash
# Make sure .env has devnet RPC
SOLANA_RPC_URL=https://api.devnet.solana.com

# Run the bot
npm run dev

# Watch for:
# ✅ "Flashloan receiver program loaded"
# ✅ "Scanning for arbitrage opportunities..."
# ✅ Price feeds updating
```

### Run on Mainnet:

```bash
# Update .env to mainnet
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Run the bot
npm start

# Monitor closely!
```

---

## Manual Deployment (Alternative)

If you prefer manual deployment:

```bash
# 1. Build the program
cd flashloan-receiver
cargo install --git https://github.com/solana-labs/solana cargo-build-sbf
cargo build-sbf

# 2. Deploy to mainnet
solana config set --url https://api.mainnet-beta.solana.com
solana program deploy target/deploy/flashloan_receiver.so

# 3. Copy the Program ID from the output
# 4. Update .env and flashloan.ts as shown above
```

---

## Verification

Verify your program is deployed:

```bash
# Check program exists
solana program show YOUR_PROGRAM_ID

# Should show:
# Program Id: YOUR_PROGRAM_ID
# Owner: BPFLoaderUpgradeab1e...
# Authority: (your wallet)
# Executable: true
```

---

## Troubleshooting

### "Insufficient funds"
You need at least 2 SOL. Check balance with `solana balance`.

### "Build failed"
Make sure Rust is updated:
```bash
rustup update
cargo clean
cargo build-sbf
```

### "Program deployment failed"
Check Solana status: https://status.solana.com  
Try again in a few minutes.

### "Bot can't find program"
Make sure:
1. Program ID is in `.env`
2. Program ID is in `src/core/flashloan.ts`
3. RPC URL matches deployment network (devnet vs mainnet)

---

## Cost Breakdown

**Devnet**: FREE (use airdropped SOL)

**Mainnet**:
- Program deployment: ~1.5 SOL (rent-exempt minimum)
- Transaction fees: ~0.01 SOL
- **Total**: ~1.5-2 SOL (~$200-300)

---

## Next Steps After Deployment

1. ✅ Program deployed
2. ✅ Bot configured
3. → Test with small amounts
4. → Monitor first few trades closely
5. → Scale up gradually
6. → Monitor profitability
7. → Optimize parameters

---

## Quick Reference Commands

```bash
# Check deployment status
solana program show YOUR_PROGRAM_ID

# View recent transactions
solana transaction-history YOUR_PROGRAM_ID

# Check bot wallet balance
solana balance YOUR_TRADING_WALLET

# View program logs (useful for debugging)
solana logs YOUR_PROGRAM_ID
```

---

## Success Checklist

Before going live:

- [ ] Program deployed successfully
- [ ] Program ID saved and configured
- [ ] Tested on devnet successfully
- [ ] Bot starts without errors
- [ ] Price feeds working
- [ ] Arbitrage detection working
- [ ] Trading wallet funded
- [ ] Monitoring setup ready

---

**Ready?** Run `./deploy-flashloan.sh` and follow the prompts!

For detailed information, see `DEPLOYMENT_GUIDE.md`.
