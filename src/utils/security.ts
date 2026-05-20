const MULTI_SPACE = /\s+/g;
const SAFE_IDENTIFIER = /[^A-Za-z0-9._:-]/g;

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?instructions?/i,
  /override\s+(system|developer)\s+(prompt|instructions?)/i,
  /you\s+are\s+now\s+(in\s+)?developer\s+mode/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /jailbreak/i,
  /tool\s*:?[\s-]*(call|use)/i,
];

export class SlidingWindowRateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  tryConsume(nowMs = Date.now()): boolean {
    if (this.maxRequests <= 0 || this.windowMs <= 0) return false;
    while (this.hits.length > 0 && nowMs - this.hits[0] > this.windowMs) {
      this.hits.shift();
    }
    if (this.hits.length >= this.maxRequests) return false;
    this.hits.push(nowMs);
    return true;
  }
}

export function sanitizeTextInput(input: string, maxLength: number): string {
  const noControls = Array.from(String(input ?? ''))
    .map(ch => {
      const code = ch.charCodeAt(0);
      return (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f
        ? ' '
        : ch;
    })
    .join('');

  const trimmed = noControls.replace(MULTI_SPACE, ' ').trim();

  if (maxLength <= 0) return '';
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function sanitizeIdentifier(input: string, maxLength = 64): string {
  return sanitizeTextInput(input, maxLength).replace(SAFE_IDENTIFIER, '');
}

export function containsPromptInjection(text: string): boolean {
  const normalized = sanitizeTextInput(text, 2000);
  return PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(normalized));
}
