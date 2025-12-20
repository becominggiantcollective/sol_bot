# Sentiment Integration (Prototype)

This document describes the prototype integration of sentiment analysis into the sol_bot project.

Overview
- A lightweight FastAPI microservice (ml/sentiment_service) queries the Hugging Face Inference API for sentence sentiment.
- The Node side (src/ml/sentimentClient.ts) sends short messages to the service and receives -1..1 sentiment scores.
- `src/strategies/sniper.ts` uses the sentiment score as an additive boost or penalty when scoring new token sniping opportunities.

Run the prototype locally

1. Start the sentiment service

```bash
cd ml/sentiment_service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export HF_API_KEY=your_hf_api_key
uvicorn ml.sentiment_service.app:app --reload --port 8000
```

2. Start the bot/sniper (dev mode) with the env variable

```bash
export SENTIMENT_SERVICE_URL=http://127.0.0.1:8000
npm run sniper
```

Testing & Backtesting
- A new `runBacktestWithSentiment` function is available in `src/utils/backtester.ts` to simulate gating by sentiment scores.
- Add message collection and historical sentiment for proper evaluation and repeatable backtests.

Notes
- Prototype only: token-level aggregation is not implemented in the microservice — it accepts message batches and scores them.
- For production: add a message consumer, persistence, aggregation, and authentication for connectors (X/Twitter and Telegram).
