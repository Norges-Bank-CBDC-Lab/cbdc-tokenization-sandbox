export function parseBigInt(value: unknown, field: string): bigint {
  try {
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (typeof normalized === 'bigint') {
      return normalized;
    }
    if (typeof normalized === 'number') {
      return BigInt(normalized);
    }
    if (typeof normalized === 'string') {
      return BigInt(normalized);
    }
    if (normalized && typeof normalized === 'object' && 'toString' in normalized) {
      return BigInt(String((normalized as { toString: () => string }).toString()));
    }
    throw new Error('invalid bigint');
  } catch {
    throw new Error(`${field} must be numeric`);
  }
}

export function parsePositiveBigInt(value: unknown, field: string): bigint {
  const asBigInt = parseBigInt(value, field);
  if (asBigInt <= 0n) {
    throw new Error(`${field} must be positive`);
  }
  return asBigInt;
}
