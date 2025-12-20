#!/bin/bash
# Start sniper bot with auto-restart on crash

BOT_SCRIPT="sniper-birdeye.mjs"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/bot-$(date +%Y%m%d).log"

# Create logs directory
mkdir -p "$LOG_DIR"

# Function to run bot
run_bot() {
    echo "[$(date)] Starting bot..." | tee -a "$LOG_FILE"
    node "$BOT_SCRIPT" 2>&1 | tee -a "$LOG_FILE"
    EXIT_CODE=$?
    echo "[$(date)] Bot exited with code $EXIT_CODE" | tee -a "$LOG_FILE"
    
    if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date)] Bot crashed! Restarting in 5 seconds..." | tee -a "$LOG_FILE"
        sleep 5
    else
        echo "[$(date)] Bot stopped normally." | tee -a "$LOG_FILE"
        exit 0
    fi
}

# Run bot in loop (auto-restart on crash)
while true; do
    run_bot
done
