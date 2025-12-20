from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import os
import logging
import time
from datetime import datetime
from transformers import pipeline
import torch


# Ensure log directory exists before handlers are created
os.makedirs('logs', exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/sentiment_service.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("sentiment_service")


# Performance metrics
request_count = 0
error_count = 0
total_processing_time = 0.0


# Model configuration - use local transformers instead of API
MODEL_NAME = os.environ.get('SENTIMENT_MODEL', 'cardiffnlp/twitter-roberta-base-sentiment-latest')
USE_GPU = torch.cuda.is_available()

app = FastAPI(title="Sentiment Service (Local Transformers)")


# Log startup
logger.info("Sentiment Service starting")
logger.info("Model: %s", MODEL_NAME)
logger.info("GPU available: %s", USE_GPU)
logger.info("Loading model... (this may take a moment)")

# Load the sentiment pipeline at startup (runs locally, no API calls)
try:
    sentiment_pipeline = pipeline(
        "sentiment-analysis",
        model=MODEL_NAME,
        device=0 if USE_GPU else -1,  # Use GPU if available
        truncation=True,
        max_length=512
    )
    logger.info("Model loaded successfully!")
except Exception as e:
    logger.error("Failed to load model: %s", str(e))
    sentiment_pipeline = None


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log incoming requests and response times"""
    start_time = time.time()
    logger.info("IN %s %s - Client: %s", request.method, request.url.path, request.client.host)

    response = await call_next(request)

    process_time = time.time() - start_time
    logger.info("OUT %s %s - Status: %s - Time: %.3fs", request.method, request.url.path, response.status_code, process_time)
    return response


class Message(BaseModel):
    id: Optional[str] = None
    source: Optional[str] = None
    text: str
    timestamp: Optional[int] = None
    tokenCandidates: Optional[List[str]] = []


class AnalyzeRequest(BaseModel):
    messages: List[Message]


def local_predict(text: str) -> Dict[str, Any]:
    """Run sentiment analysis locally using transformers"""
    if sentiment_pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        # Get prediction from local model
        result = sentiment_pipeline(text)
        duration = time.time() - start_time
        
        logger.info("Local inference success time=%.3fs text_len=%d", duration, len(text))
        return result
        
    except Exception as exc:
        duration = time.time() - start_time
        logger.error("Local inference error after %.3fs: %s", duration, str(exc))
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(exc)}")


def to_score(result: Any) -> float:
    """Convert local model output to normalized score [-1, 1]"""
    # Local transformers returns: [{'label': 'positive', 'score': 0.95}]
    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        label = item.get('label', '').lower()
        confidence = item.get('score', 0)
        
        # Map labels to scores
        # The twitter-roberta model uses: negative, neutral, positive
        if 'positive' in label:
            score = confidence
        elif 'negative' in label:
            score = -confidence
        else:  # neutral
            score = 0.0
        
        logger.debug("Sentiment: label=%s confidence=%.3f score=%.3f", label, confidence, score)
        return score

    logger.warning("Unexpected model output format: %s", type(result))
    return 0.0


@app.post('/analyze/messages')
def analyze_messages(req: AnalyzeRequest):
    """Analyze sentiment of multiple messages with monitoring"""
    global request_count, error_count, total_processing_time

    start_time = time.time()
    request_count += 1
    logger.info("Analyzing %d messages", len(req.messages))

    results = []
    success_count = 0
    fail_count = 0

    for idx, msg in enumerate(req.messages):
        try:
            logger.debug("Processing message %d/%d id=%s source=%s", idx + 1, len(req.messages), msg.id, msg.source)
            out = local_predict(msg.text)
            score = to_score(out)

            results.append({
                'id': msg.id,
                'source': msg.source,
                'text': msg.text,
                'score': score,
                'tokenCandidates': msg.tokenCandidates
            })

            success_count += 1
            logger.debug("Message %s scored %.3f", msg.id, score)

        except HTTPException as exc:
            error_count += 1
            fail_count += 1
            logger.error("HTTP error on message %s: %s", msg.id, exc.detail)
            raise exc

        except Exception as exc:
            error_count += 1
            fail_count += 1
            logger.error("Error on message %s: %s", msg.id, str(exc))
            results.append({'id': msg.id, 'error': str(exc)})

    processing_time = time.time() - start_time
    total_processing_time += processing_time

    logger.info(
        "Batch complete - success=%d failed=%d time=%.3fs",
        success_count,
        fail_count,
        processing_time
    )
    avg_time = total_processing_time / request_count if request_count > 0 else 0
    logger.info(
        "Stats - total_requests=%d errors=%d avg_time=%.3fs",
        request_count,
        error_count,
        avg_time
    )

    return {
        'results': results,
        'stats': {
            'total': len(req.messages),
            'success': success_count,
            'failed': fail_count,
            'processing_time_seconds': round(processing_time, 3)
        }
    }


@app.get('/score/token')
def get_token_score(token: str, window_seconds: int = 300):
    """Token-level scoring placeholder"""
    logger.warning("/score/token called for %s (not implemented)", token)
    raise HTTPException(
        status_code=501,
        detail='Token-level aggregation not implemented in prototype. Use /analyze/messages to send messages and compute aggregated stats externally.'
    )


@app.get('/health')
def health_check():
    """Health check endpoint with service stats"""
    model_status = "loaded" if sentiment_pipeline is not None else "failed"
    
    uptime_info = {
        'status': 'healthy' if sentiment_pipeline else 'degraded',
        'service': 'Sentiment Analysis (Local Transformers)',
        'model': MODEL_NAME,
        'model_status': model_status,
        'gpu_enabled': USE_GPU,
        'timestamp': datetime.utcnow().isoformat(),
        'stats': {
            'total_requests': request_count,
            'total_errors': error_count,
            'avg_processing_time_seconds': round(total_processing_time / request_count, 3) if request_count > 0 else 0,
            'error_rate_percent': round((error_count / request_count * 100), 2) if request_count > 0 else 0
        }
    }

    logger.debug("Health check stats: %s", uptime_info['stats'])
    return uptime_info


@app.get('/metrics')
def get_metrics():
    """Prometheus-style metrics endpoint"""
    return {
        'sentiment_requests_total': request_count,
        'sentiment_errors_total': error_count,
        'sentiment_processing_seconds_total': round(total_processing_time, 3),
        'sentiment_processing_seconds_avg': round(total_processing_time / request_count, 3) if request_count > 0 else 0
    }
