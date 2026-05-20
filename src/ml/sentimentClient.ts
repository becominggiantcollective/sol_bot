import axios from 'axios';
import { config } from '../config/index.js';
import {
  SlidingWindowRateLimiter,
  containsPromptInjection,
  sanitizeIdentifier,
  sanitizeTextInput,
} from '../utils/security.js';

const SENTIMENT_URL = process.env.SENTIMENT_SERVICE_URL || 'http://127.0.0.1:8000';
const sentimentRateLimiter = new SlidingWindowRateLimiter(
  config.security?.sentimentRateLimitPerMinute ?? 60,
  config.security?.sentimentRateLimitWindowMs ?? 60_000
);

export interface MessagePayload {
  id?: string;
  source?: string;
  text: string;
  timestamp?: number;
  tokenCandidates?: string[];
}

export interface MessageResult {
  id?: string;
  source?: string;
  text: string;
  score?: number;
  error?: string;
}

export async function analyzeMessages(messages: MessagePayload[]): Promise<MessageResult[]> {
  if (!sentimentRateLimiter.tryConsume()) {
    return messages.map(m => ({
      id: m.id,
      source: m.source,
      text: m.text,
      error: 'Sentiment service rate limit exceeded',
    }));
  }

  const blocked: MessageResult[] = [];
  const safeMessages: MessagePayload[] = [];
  const maxMessageLength = config.security?.maxSentimentMessageLength ?? 500;
  const promptDefenseEnabled = config.security?.promptInjectionDefenseEnabled !== false;

  for (const message of messages) {
    if (typeof message.text !== 'string') {
      blocked.push({
        id: message.id,
        source: message.source,
        text: '',
        error: 'Missing message text',
      });
      continue;
    }

    const sanitizedText = sanitizeTextInput(message.text, maxMessageLength);
    const sanitizedSource = message.source
      ? sanitizeIdentifier(message.source, 40)
      : undefined;
    const sanitizedTokenCandidates = message.tokenCandidates
      ?.map(token => sanitizeIdentifier(token, 64))
      .filter(Boolean);

    if (!sanitizedText) {
      blocked.push({
        id: message.id,
        source: sanitizedSource,
        text: '',
        error: 'Empty message after sanitization',
      });
      continue;
    }

    if (promptDefenseEnabled && containsPromptInjection(sanitizedText)) {
      blocked.push({
        id: message.id,
        source: sanitizedSource,
        text: sanitizedText,
        error: 'Blocked by prompt-injection defense',
      });
      continue;
    }

    safeMessages.push({
      id: message.id,
      source: sanitizedSource,
      text: sanitizedText,
      timestamp: message.timestamp,
      tokenCandidates: sanitizedTokenCandidates,
    });
  }

  if (safeMessages.length === 0) {
    return blocked;
  }

  try {
    const res = await axios.post(
      `${SENTIMENT_URL}/analyze/messages`,
      { messages: safeMessages },
      { timeout: 10000 }
    );
    const results = (res.data?.results || []) as MessageResult[];
    return [...results, ...blocked];
  } catch (e: any) {
    // On error return errors per message
    return [
      ...safeMessages.map(m => ({
        id: m.id,
        source: m.source,
        text: m.text,
        error: e.message,
      })),
      ...blocked,
    ];
  }
}

export async function scoreTokenFromMessages(token: string, texts: string[]): Promise<{ token: string; score: number; count: number; } | null> {
  if (!texts || texts.length === 0) return null;
  const messages = texts.map((t, i) => ({ id: String(i), text: t, tokenCandidates: [token] }));
  const results = await analyzeMessages(messages);
  const valid = results.filter(r => typeof r.score === 'number').map(r => r.score || 0);
  if (valid.length === 0) return null;
  const avg = valid.reduce((a,b)=>a+b,0) / valid.length;
  return { token, score: avg, count: valid.length };
}

export default { analyzeMessages, scoreTokenFromMessages };
