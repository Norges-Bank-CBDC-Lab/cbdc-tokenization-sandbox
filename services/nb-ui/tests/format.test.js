import { describe, it, expect } from 'vitest';
import { Fmt } from '../src/utils/format.js';

describe('format helpers', () => {
  it('renders bps as a percentage with 2 decimals', () => {
    expect(Fmt.bpsToPct('425')).toBe('4.25%');
    expect(Fmt.bpsToPct('10000')).toBe('100.00%');
    expect(Fmt.bpsToPct(null)).toBe('—');
  });

  it('shortens long hex addresses with an ellipsis', () => {
    expect(Fmt.shortHex('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x123456…5678');
    expect(Fmt.shortHex(null)).toBe('—');
    expect(Fmt.shortHex('0x123')).toBe('0x123');
  });

  it('formats unit counts with thousands separators', () => {
    expect(Fmt.formatUnits('1500000')).toBe('1,500,000');
    expect(Fmt.formatUnits('')).toBe('—');
  });

  it('formats NOK values with units / scale', () => {
    expect(Fmt.formatNok('1000')).toBe('1.00 M NOK');
    expect(Fmt.formatNok('1000000')).toBe('1.00 B NOK');
  });
});
