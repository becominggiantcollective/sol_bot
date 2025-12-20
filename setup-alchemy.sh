#!/bin/bash
# Check Alchemy RPC Configuration

echo "🔧 Alchemy RPC Configuration Check"
echo "===================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    exit 1
fi

# Check current configuration
echo "📊 Current RPC Configuration:"
echo ""
grep "^ALCHEMY_RPC_URL" .env || echo "⚠️  ALCHEMY_RPC_URL not found in .env"
grep "^SOLANA_RPC_URL" .env | head -1 || echo "⚠️  SOLANA_RPC_URL not found in .env"
echo ""

# Check if Alchemy is already configured
if grep -q "YOUR_ALCHEMY_API_KEY_HERE" .env 2>/dev/null; then
    echo "⚠️  Alchemy API key placeholder detected"
    echo ""
    echo "📋 To configure your Alchemy API key:"
    echo "   1. Edit .env file"
    echo "   2. Replace YOUR_ALCHEMY_API_KEY_HERE with your actual API key"
    echo "   3. Make sure ALCHEMY_RPC_URL is already set (it should be!)"
    echo ""
    read -p "Do you want to enter your Alchemy API key now? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your Alchemy API key: " ALCHEMY_KEY
        if [ -z "$ALCHEMY_KEY" ]; then
            echo "❌ No API key provided. Exiting."
            exit 1
        fi
        sed -i "s|YOUR_ALCHEMY_API_KEY_HERE|$ALCHEMY_KEY|g" .env
        echo "✅ Updated .env with your Alchemy API key"
    fi
else
    echo "✅ Alchemy appears to be configured!"
    echo ""
    echo "🔍 Using ALCHEMY_RPC_URL from .env"
fi

echo ""
echo "🎯 Next Steps:"
echo "   1. Run real market backtest: npm run backtest:real"
echo "   2. Review PERFORMANCE_IMPROVEMENT_ANALYSIS.md"
echo "   3. Consider VPS deployment (see VPS_DEPLOYMENT.md)"
echo ""
echo "✅ Configuration check complete!"
