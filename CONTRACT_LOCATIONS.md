# 📜 Smart Contract / Program Locations Guide

## Understanding Solana "Contracts"

In Solana, what Ethereum calls "smart contracts" are called **Programs**. Your bot interacts with deployed programs but doesn't deploy them itself.

---

## 🏦 **1. SOLEND FLASHLOAN PROGRAM**

### On-Chain Contract (Already Deployed)
- **Program ID**: `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo`
- **Language**: Rust
- **Deployed**: Yes, on Solana mainnet
- **You control it**: NO - it's already deployed and owned by Solend

### Source Code Location (In Your Project)
```
📁 solana-program-library/token-lending/program/
  ├── src/
  │   ├── instruction.rs     ← FlashLoan instruction definition (line 326)
  │   ├── processor.rs       ← Flashloan execution logic
  │   ├── entrypoint.rs      ← Program entry point
  │   ├── state/             ← Reserve and market state
  │   └── error.rs           ← Error codes
  ├── Cargo.toml             ← Rust dependencies
  └── tests/                 ← Test suite
```

### Key Instruction (Rust)
**File**: `solana-program-library/token-lending/program/src/instruction.rs:326`
```rust
FlashLoan {
    /// The amount that is to be borrowed - u64::MAX for up to 100% of available liquidity
    amount: u64,
}
```

### Your Bot's Code (TypeScript)
**File**: `src/core/flashloan.ts:28-92`
```typescript
async createFlashloanInstructions(
    amount: number,
    mint: PublicKey,
    instructions: TransactionInstruction[]
): Promise<TransactionInstruction[]> {
    // Builds instructions to call the Solend program
    const borrowData = Buffer.alloc(17);
    borrowData.writeUInt8(12, 0); // FlashLoan instruction discriminator
    borrowData.writeBigUInt64LE(BigInt(amount), 1);
    // ... builds transaction to call So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
}
```

---

## 🥭 **2. MANGO MARKETS PROGRAM**

### On-Chain Contract
- **Program ID**: `mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68`
- **Language**: Rust
- **Deployed**: Yes, on Solana mainnet
- **You control it**: NO

### Source Code Location (In Your Project)
```
📁 mango-v3/program/
  ├── src/
  │   ├── instruction.rs     ← All Mango instructions
  │   ├── processor.rs       ← Instruction processors
  │   └── state.rs           ← Account states
  └── Cargo.toml
```

### Your Bot's Code
**File**: `src/core/flashloan.ts:94-170`
```typescript
export class MangoFlashloanProvider implements FlashloanProvider {
  name = 'mango';
  programId = new PublicKey('mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68');
  // ... builds transactions to call Mango program
}
```

---

## 🪐 **3. JUPITER AGGREGATOR**

### On-Chain Contract
- **Program ID**: `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` (v6)
- **Language**: Rust
- **Deployed**: Yes, on Solana mainnet
- **You control it**: NO

### Your Bot's Code
**File**: `src/core/arbitrage.ts:114-146`
```typescript
private async getJupiterRoute(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number
): Promise<TradingRoute | null> {
    // Fetches quote from Jupiter API
    // Then would build swap instruction to call Jupiter program
}
```

---

## 🌊 **4. ORCA WHIRLPOOLS**

### On-Chain Contract
- **Program ID**: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`
- **Language**: Rust
- **Deployed**: Yes
- **You control it**: NO

### Source Code Location (In Your Project)
```
📁 whirlpools/programs/whirlpool/
  └── src/
      ├── instructions/   ← Swap instructions
      └── state/          ← Pool state
```

---

## ⚡ **5. RAYDIUM AMM**

### On-Chain Contract
- **Program ID**: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- **Language**: Rust
- **Deployed**: Yes
- **You control it**: NO

---

## 📊 **How It All Works Together**

### Transaction Flow:

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR BOT (TypeScript)                                      │
│  Location: src/core/flashloan.ts, src/core/arbitrage.ts    │
│                                                             │
│  1. Detects opportunity                                     │
│  2. Builds transaction instructions                         │
│  3. Signs with your wallet                                  │
│  4. Sends to Solana                                        │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Transaction
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  SOLANA BLOCKCHAIN                                          │
│                                                             │
│  Transaction contains calls to:                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 1. Solend Program (So1end...)                         │ │
│  │    - Borrow via flashloan                             │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │ 2. Jupiter Program (JUP6...)                          │ │
│  │    - Execute swap                                     │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │ 3. Solend Program (So1end...)                         │ │
│  │    - Repay flashloan + fee                            │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  If all succeed: You keep profit!                          │
│  If any fail: Transaction reverts (atomic)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 **Key Differences from Ethereum**

### Ethereum:
- You deploy your own contract
- Contract code lives on-chain
- Your contract calls other contracts

### Solana:
- You DON'T deploy contracts
- You call EXISTING programs
- Your bot builds transactions off-chain
- Transactions are sent to blockchain

---

## 📁 **Complete File Map**

### Actual Smart Contracts (Rust, On-Chain):
```
solana-program-library/
└── token-lending/program/src/         ← Solend Flashloan
    ├── instruction.rs                 ← Instruction definitions
    ├── processor.rs                   ← Flashloan logic
    └── state/                         ← Account structures

mango-v3/program/src/                  ← Mango Flashloan
    ├── instruction.rs
    └── processor.rs

whirlpools/programs/whirlpool/src/     ← Orca Pools
    └── instructions/swap.rs

# Jupiter and Raydium - not included in your repo
```

### Your Transaction Builders (TypeScript, Off-Chain):
```
src/
├── core/
│   ├── flashloan.ts        ← Builds Solend/Mango transactions
│   ├── arbitrage.ts        ← Builds Jupiter/Orca/Raydium transactions
│   └── connection.ts       ← Sends transactions to blockchain
├── strategies/
│   └── mev.ts              ← Orchestrates strategy
└── index.ts                ← Main bot loop
```

---

## 🎯 **What You Need to Know**

### You DON'T Need To:
- ❌ Deploy any smart contracts
- ❌ Write Rust code
- ❌ Compile programs
- ❌ Manage program upgrades

### You DO Need To:
- ✅ Build correct transaction instructions
- ✅ Derive correct account addresses (PDAs)
- ✅ Include all required accounts
- ✅ Sign transactions with your wallet
- ✅ Handle transaction failures

---

## 🔨 **Current Implementation Status**

### Complete ✅:
- Transaction signing and sending
- Basic instruction building
- Program ID configuration

### Incomplete ⚠️:
- Account derivation (PDAs)
- Complete account lists
- Proper instruction data encoding

This is what's blocking execution - need to complete the account derivation in `src/core/flashloan.ts`.

---

## 📚 **References**

- **Solend Docs**: https://docs.solend.fi/protocol/flash-loans
- **Solana Programs**: https://docs.solana.com/developing/on-chain-programs
- **Account Model**: https://solanacookbook.com/core-concepts/accounts.html
- **PDAs**: https://solanacookbook.com/core-concepts/pdas.html

---

**TL;DR**: The "smart contracts" are already deployed on Solana. Your bot's job is to build transactions that CALL these contracts. The transaction-building code is in `src/core/flashloan.ts` and `src/core/arbitrage.ts`.
