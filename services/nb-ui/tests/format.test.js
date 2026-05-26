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

  it('labels the bid-rate column per auction type', () => {
    expect(Fmt.rateColumnLabel('RATE')).toBe('Yield');
    expect(Fmt.rateColumnLabel('PRICE')).toBe('Price');
    expect(Fmt.rateColumnLabel('BUYBACK')).toBe('Repurchase price');
    expect(Fmt.rateColumnLabel(undefined)).toBe('Yield');
  });

  it('labels the totals-row "best" direction per auction type', () => {
    expect(Fmt.bestRateLabel('RATE')).toBe('Best (lowest) yield');
    expect(Fmt.bestRateLabel('PRICE')).toBe('Best (highest) price');
    expect(Fmt.bestRateLabel('BUYBACK')).toBe('Best (lowest) repurchase price');
    expect(Fmt.bestRateLabel(undefined)).toBe('Best (lowest) yield');
  });

  it('formats bid rate per auction type', () => {
    expect(Fmt.formatBidRate('425', 'RATE')).toBe('4.25%');
    expect(Fmt.formatBidRate('10123', 'PRICE')).toBe('101.23');
    expect(Fmt.formatBidRate('9980', 'BUYBACK')).toBe('99.80');
    expect(Fmt.formatBidRate(null, 'RATE')).toBe('—');
    expect(Fmt.formatBidRate('', 'PRICE')).toBe('—');
  });

  it('formats DURATION_SCALAR-unit year counts as plain N yr', () => {
    expect(Fmt.formatYears('4')).toBe('4 yr');
    expect(Fmt.formatYears('1')).toBe('1 yr');
    expect(Fmt.formatYears('0')).toBe('< 1 yr');
    expect(Fmt.formatYears(null)).toBe('—');
    expect(Fmt.formatYears('')).toBe('—');
  });

  it('labels the clearing-rate KPI per auction type', () => {
    expect(Fmt.clearingLabel('RATE')).toBe('Clearing yield');
    expect(Fmt.clearingLabel('PRICE')).toBe('Clearing price');
    expect(Fmt.clearingLabel('BUYBACK')).toBe('Clearing repurchase price');
    expect(Fmt.clearingLabel(undefined)).toBe('Clearing yield');
  });
});
