# Sentiment Service (Hugging Face prototype)

This is a small prototype sentiment microservice for the sol_bot project.
It uses the Hugging Face Inference API to score short messages and returns a simple -1..1 score.

Endpoints
- POST /analyze/messages — accepts { messages: [{text}] } and returns scores for each message
- GET /score/token — placeholder (not implemented in prototype)

Config
- HF_API_KEY — (optional) Hugging Face API token for the inference API
- HF_API_URL — (optional) model endpoint (defaults to cardiffnlp/twitter-roberta-base-sentiment)

Run locally (dev)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export HF_API_KEY=your_hf_api_key_here
uvicorn ml.sentiment_service.app:app --reload --port 8000
```

Notes
- This prototype does not persist messages. For production, add a datastore and aggregation logic per token.
