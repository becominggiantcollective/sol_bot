import { COMMON_TOKENS, formatNumber, formatPercent, isValidPublicKey } from '../utils/index.js';

describe('Utils', () => {
  it('should have common tokens defined', () => {
    expect(COMMON_TOKENS.SOL).toBeDefined();
    expect(COMMON_TOKENS.USDC).toBeDefined();
    expect(COMMON_TOKENS.USDT).toBeDefined();
  });

  it('should format numbers correctly', () => {
    expect(formatNumber(1.123456789)).toBe('1.123457');
    expect(formatNumber(1.123456789, 2)).toBe('1.12');
  });

  it('should format percentages correctly', () => {
    expect(formatPercent(0.123)).toBe('12.30%');
    expect(formatPercent(0.05)).toBe('5.00%');
  });

  it('should validate public keys', () => {
    expect(isValidPublicKey('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isValidPublicKey('invalid-key')).toBe(false);
    expect(isValidPublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
  });
});