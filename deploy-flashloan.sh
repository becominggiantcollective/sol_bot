#!/bin/bash

# Flashloan Receiver Build & Deploy Script
# This script helps you build and deploy the flashloan receiver program

set -e  # Exit on error

echo "🚀 Flashloan Receiver Deployment Tool"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "flashloan-receiver/Cargo.toml" ]; then
    echo -e "${RED}❌ Error: Must run this script from the project root directory${NC}"
    echo "Please cd to sol_bot directory and run: ./scripts/deploy-flashloan.sh"
    exit 1
fi

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ Rust is not installed${NC}"
    echo "Install Rust with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI is not installed${NC}"
    echo "Install Solana CLI with: sh -c \"\$(curl -sSfL https://release.solana.com/v1.18.0/install)\""
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Ask which network to deploy to
echo "Select deployment target:"
echo "1) Devnet (recommended for testing)"
echo "2) Mainnet-Beta (requires ~2 SOL)"
read -p "Enter choice (1 or 2): " network_choice

case $network_choice in
    1)
        NETWORK="devnet"
        RPC_URL="https://api.devnet.solana.com"
        echo -e "${GREEN}📍 Deploying to DEVNET${NC}"
        ;;
    2)
        NETWORK="mainnet"
        RPC_URL="https://api.mainnet-beta.solana.com"
        echo -e "${YELLOW}⚠️  Deploying to MAINNET (will cost ~2 SOL)${NC}"
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo "Deployment cancelled"
            exit 0
        fi
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""

# Configure Solana CLI
echo "🔧 Configuring Solana CLI..."
solana config set --url $RPC_URL

# Check balance
BALANCE=$(solana balance | awk '{print $1}')
echo "💰 Current balance: $BALANCE SOL"

if [ "$NETWORK" == "mainnet" ]; then
    if (( $(echo "$BALANCE < 2" | bc -l) )); then
        echo -e "${RED}❌ Insufficient balance for mainnet deployment (need at least 2 SOL)${NC}"
        WALLET_ADDRESS=$(solana address)
        echo "Send SOL to: $WALLET_ADDRESS"
        exit 1
    fi
else
    # Request airdrop for devnet if needed
    if (( $(echo "$BALANCE < 1" | bc -l) )); then
        echo "🪂 Requesting devnet airdrop..."
        solana airdrop 2 || echo "Airdrop may have failed, continuing anyway..."
    fi
fi

echo ""

# Build the program
echo "🔨 Building flashloan receiver program..."
cd flashloan-receiver

# Install build tools if needed
if ! command -v cargo-build-sbf &> /dev/null; then
    echo "Installing Solana build tools..."
    cargo install --git https://github.com/solana-labs/solana cargo-build-sbf
fi

# Clean and build
cargo clean
cargo build-sbf

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build successful${NC}"
cd ..

echo ""

# Deploy the program
echo "🚀 Deploying program to $NETWORK..."
DEPLOY_OUTPUT=$(solana program deploy flashloan-receiver/target/deploy/flashloan_receiver.so 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

# Extract program ID from output
PROGRAM_ID=$(echo "$DEPLOY_OUTPUT" | grep -oP 'Program Id: \K\w+')

if [ -z "$PROGRAM_ID" ]; then
    echo -e "${RED}❌ Could not extract program ID${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Deployment successful!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Program ID: $PROGRAM_ID"
echo "Network: $NETWORK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Save program ID to file
echo "$PROGRAM_ID" > flashloan-receiver/program-id-$NETWORK.txt
echo "💾 Program ID saved to: flashloan-receiver/program-id-$NETWORK.txt"
echo ""

# Provide next steps
echo "📋 Next Steps:"
echo "1. Update your .env file with:"
echo "   FLASHLOAN_RECEIVER_PROGRAM_ID=$PROGRAM_ID"
echo ""
echo "2. Update src/core/flashloan.ts with the program ID"
echo ""
echo "3. Test the bot:"
if [ "$NETWORK" == "devnet" ]; then
    echo "   SOLANA_RPC_URL=https://api.devnet.solana.com npm run dev"
else
    echo "   npm run dev"
fi
echo ""

# Verify deployment
echo "🔍 Verifying deployment..."
solana program show $PROGRAM_ID

echo ""
echo -e "${GREEN}🎉 All done!${NC}"
