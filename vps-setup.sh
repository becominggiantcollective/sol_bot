#!/bin/bash
# VPS Setup Script for Sol Sniper Bot

set -e

echo "🚀 Setting up Sol Sniper Bot on VPS..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed"
fi

echo ""
echo "🔧 Setting up environment..."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "⚠️  IMPORTANT: Edit .env and add your WALLET_PRIVATE_KEY"
    echo "   Run: nano .env"
else
    echo "✅ .env file exists"
fi

# Create necessary directories
mkdir -p logs data

echo ""
echo "🏗️  Building Docker images..."
docker-compose build

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Edit .env with your wallet key: nano .env"
echo "   2. Start the bot: docker-compose up -d"
echo "   3. View logs: docker-compose logs -f sniper-bot"
echo "   4. Stop the bot: docker-compose down"
echo ""
echo "🔍 Useful commands:"
echo "   Status: docker-compose ps"
echo "   Logs: docker-compose logs -f"
echo "   Restart: docker-compose restart"
echo "   Update: git pull && docker-compose up -d --build"
echo ""
