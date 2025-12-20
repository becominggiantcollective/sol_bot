import axios from 'axios';

const SENTIMENT_URL = process.env.SENTIMENT_SERVICE_URL || 'http://127.0.0.1:8000';

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
  try {
    const res = await axios.post(`${SENTIMENT_URL}/analyze/messages`, { messages }, { timeout: 10000 });
    return res.data?.results || [];
  } catch (e: any) {
    // On error return errors per message
    return messages.map(m => ({ id: m.id, source: m.source, text: m.text, error: e.message }));
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
