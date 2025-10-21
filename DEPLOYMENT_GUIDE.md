# 🚀 Complete Guide: Solend Account Derivation & Flashloan Deployment

## Overview

This guide shows you how to:
1. Complete the Solend account derivation in TypeScript
2. Build and deploy the flashloan receiver program to mainnet
3. Integrate the deployed program with the bot

---

## Part 1: Complete Solend Account Derivation

The bot currently has placeholder logic for Solend reserves. Here's how to complete it:

### Current Status (in `src/core/flashloan.ts`)

The code has hardcoded reserve addresses for SOL and USDC:

```typescript
const SOLEND_RESERVES: Record<string, { address: string; liquiditySupply: string; feeReceiver: string }> = {
  'So11111111111111111111111111111111111111112': { // SOL
    address: '8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36',
    liquiditySupply: '8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf',
    feeReceiver: 'CpYwHrVN8gxWXe7fWz5zFmX8EJrhqQxhQJQtFpN7PdPD',
  },
  // ...
};
```

### What You Need to Do

**Option A: Use Hardcoded Addresses (Simpler, Faster)**

The hardcoded addresses are already correct for Solend Main Pool. Just verify they're up-to-date:

1. Visit Solend's GitHub: https://github.com/solendprotocol/public
2. Check the latest reserve addresses in their SDK
3. Update the `SOLEND_RESERVES` object if needed

**Option B: Fetch Dynamically (More Robust)**

Install Solend SDK and fetch reserves on-chain:

```bash
npm install @solendprotocol/solend-sdk
```

Then update `src/core/flashloan.ts`:

```typescript
import { SolendMarket } from '@solendprotocol/solend-sdk';

private async getSolendReserve(mint: PublicKey): Promise<{ reserve: any; reserveAddress: PublicKey }> {
  // Fetch Solend market
  const market = await SolendMarket.initialize(
    this.solanaConnection.getConnection(),
    'production' // or 'devnet' for testing
  );
  
  // Find reserve for the token
  const reserve = market.reserves.find(r => r.config.liquidityToken.mint === mint.toString());
  
  if (!reserve) {
    throw new Error(`No Solend reserve found for mint: ${mint.toString()}`);
  }
  
  return {
    reserve: reserve.config,
    reserveAddress: new PublicKey(reserve.config.address),
  };
}
```

**Recommendation**: Start with Option A (hardcoded) since it's already working. You can upgrade to Option B later for production.

---

## Part 2: Build the Flashloan Receiver Program

### Prerequisites

1. Install Rust and Solana CLI:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
```

2. Configure Solana CLI for mainnet:
```bash
# Generate a new keypair (if you don't have one)
solana-keygen new --outfile ~/.config/solana/mainnet-deployer.json

# Set to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Set your keypair
solana config set --keypair ~/.config/solana/mainnet-deployer.json

# Check balance (you'll need SOL for deployment)
solana balance

# If balance is 0, you need to fund this wallet
# Get the address:
solana address
```

### Build the Program

```bash
cd flashloan-receiver

# Install Solana build tools
cargo install --git https://github.com/solana-labs/solana cargo-build-sbf

# Build the program
cargo build-sbf

# This creates: target/deploy/flashloan_receiver.so
```

### Test on Devnet First (Recommended)

Before deploying to mainnet, test on devnet:

```bash
# Switch to devnet
solana config set --url https://api.devnet.solana.com

# Request airdrop for testing (2 SOL)
solana airdrop 2

# Deploy to devnet
solana program deploy target/deploy/flashloan_receiver.so

# Save the program ID that's printed!
# Example output: Program Id: 7xYZ...ABC123
```

### Deploy to Mainnet

⚠️ **Important**: You need ~2-3 SOL in your deployer wallet for mainnet deployment.

```bash
# Switch back to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Check you have enough SOL
solana balance

# Deploy to mainnet
solana program deploy target/deploy/flashloan_receiver.so

# SAVE THE PROGRAM ID!
# Example output: Program Id: FLashXYZ...ABC123
```

**Cost**: Deploying to mainnet costs approximately:
- Program deployment: ~1.5 SOL (rent-exempt minimum)
- Transaction fees: ~0.01 SOL
- **Total**: ~1.5-2 SOL (~$200-300 at current prices)

---

## Part 3: Update Bot Configuration

After deployment, update the bot to use your deployed program:

### 1. Update `src/core/flashloan.ts`

Find the line with `LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi` and add your receiver program:

```typescript
export class SolendFlashloanProvider implements FlashloanProvider {
  name = 'spl-token-lending';
  programId = new PublicKey('LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi'); // SPL Token Lending
  
  // ADD THIS: Your deployed flashloan receiver program
  receiverProgramId = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID_HERE');
  
  // ...
}
```

### 2. Update the `createFlashloanInstructions` method

Replace the current implementation with proper flashloan instructions:

```typescript
async createFlashloanInstructions(
  amount: number,
  mint: PublicKey,
  instructions: TransactionInstruction[]
): Promise<TransactionInstruction[]> {
  const flashloanInstructions: TransactionInstruction[] = [];
  const wallet = this.solanaConnection.getWalletPublicKey();
  
  // Get reserve for the token
  const { reserve, reserveAddress } = await this.getSolendReserve(mint);
  
  // Build FlashLoan instruction (discriminator 13)
  const data = Buffer.alloc(17);
  data.writeUInt8(13, 0); // FlashLoan instruction
  data.writeBigUInt64LE(BigInt(amount), 1);
  
  const flashloanIx = new TransactionInstruction({
    programId: this.programId, // SPL Token Lending program
    keys: [
      { pubkey: reserveAddress, isSigner: false, isWritable: true },
      { pubkey: reserve.liquiditySupply, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: this.receiverProgramId, isSigner: false, isWritable: false }, // Your deployed program
    ],
    data,
  });
  
  flashloanInstructions.push(flashloanIx);
  
  // Add arbitrage instructions (these will be executed by the receiver program)
  flashloanInstructions.push(...instructions);
  
  return flashloanInstructions;
}
```

### 3. Update Environment Variables

Create/update `.env`:

```bash
# Your wallet for trading
WALLET_PRIVATE_KEY=[your,private,key,array]
WALLET_PUBLIC_KEY=YourPublicKeyHere

# Flashloan receiver program (your deployed program)
FLASHLOAN_RECEIVER_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID_HERE

# Solana RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

---

## Part 4: Testing the Complete Flow

### Test on Devnet

1. Deploy to devnet (as shown above)
2. Update bot config with devnet program ID
3. Run the bot:

```bash
# Set to devnet in .env
SOLANA_RPC_URL=https://api.devnet.solana.com

# Run the bot
npm run dev
```

4. Monitor for errors and verify flashloan execution

### Test on Mainnet (Small Amounts)

Once devnet testing is successful:

1. Deploy to mainnet
2. Update bot config with mainnet program ID
3. Start with small amounts to verify
4. Monitor closely for the first few trades

---

## Part 5: Verify Deployment

### Check Your Deployed Program

```bash
# View program info
solana program show YOUR_PROGRAM_ID

# Check program is executable
solana program dump YOUR_PROGRAM_ID output.so
```

### Monitor Program Usage

```bash
# Watch for transactions
solana transaction-history YOUR_PROGRAM_ID
```

---

## Troubleshooting

### "Insufficient funds for deployment"

You need at least 2 SOL in your deployer wallet:

```bash
solana balance
# If < 2 SOL, transfer more SOL to your deployer address
```

### "Program deployment failed"

Check the build:

```bash
cd flashloan-receiver
cargo clean
cargo build-sbf
# Should complete without errors
```

### "Invalid instruction data"

The receiver program expects specific account ordering. Verify the accounts match the SPL Token Lending spec.

---

## Security Checklist

Before deploying to mainnet:

- [ ] Test thoroughly on devnet
- [ ] Review all code for security issues
- [ ] Verify program builds without warnings
- [ ] Test with small amounts first
- [ ] Have a kill switch to stop the bot
- [ ] Monitor all transactions closely
- [ ] Keep private keys secure
- [ ] Consider using a program upgrade authority

---

## Cost Summary

**Devnet (Free)**:
- Deployment: Free (use airdropped SOL)
- Testing: Free

**Mainnet**:
- Program deployment: ~1.5-2 SOL (~$200-300)
- Transaction fees: ~0.001 SOL per trade (~$0.15)
- Initial wallet balance: 0.1+ SOL recommended

---

## Quick Start Commands

```bash
# 1. Build the program
cd flashloan-receiver
cargo build-sbf

# 2. Deploy to devnet (test first!)
solana config set --url https://api.devnet.solana.com
solana airdrop 2
solana program deploy target/deploy/flashloan_receiver.so

# 3. Save the program ID, update bot config

# 4. Test the bot
npm run dev

# 5. Once tested, deploy to mainnet
solana config set --url https://api.mainnet-beta.solana.com
solana program deploy target/deploy/flashloan_receiver.so

# 6. Update bot with mainnet program ID and run!
```

---

## Additional Resources

- **SPL Token Lending Docs**: https://spl.solana.com/token-lending
- **Solana CLI Docs**: https://docs.solana.com/cli
- **Solend SDK**: https://github.com/solendprotocol/public
- **Deploy Programs**: https://docs.solana.com/cli/deploy-a-program

---

## Support

If you encounter issues:

1. Check Solana status: https://status.solana.com
2. Verify RPC endpoint is responding
3. Check program logs: `solana logs YOUR_PROGRAM_ID`
4. Review transaction errors in Solana Explorer

---

**Ready to deploy?** Follow the steps above carefully, test on devnet first, then deploy to mainnet!
