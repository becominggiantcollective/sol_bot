# Use official Node.js LTS image
FROM node:20-alpine

# Install dependencies for native modules and health check
RUN apk add --no-cache python3 make g++ git procps

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data

# Set environment variables
ENV NODE_ENV=production

# Health check - verify node process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD pgrep -x node > /dev/null || exit 1

# Run the bot
CMD ["node", "sniper-birdeye.mjs"]
