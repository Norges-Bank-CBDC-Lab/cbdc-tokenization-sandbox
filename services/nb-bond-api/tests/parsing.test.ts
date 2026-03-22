import { parseBigInt, parsePositiveBigInt } from '../src/parsing';

describe('parseBigInt', () => {
  it('parses numeric strings with whitespace', () => {
    expect(parseBigInt(' 42 ', 'value')).toBe(42n);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseBigInt('not-a-number', 'amount')).toThrow('amount must be numeric');
  });
});

describe('parsePositiveBigInt', () => {
  it('rejects zero values', () => {
    expect(() => parsePositiveBigInt('0', 'size')).toThrow('size must be positive');
  });

  it('rejects negative values', () => {
    expect(() => parsePositiveBigInt('-1', 'size')).toThrow('size must be positive');
  });
});
