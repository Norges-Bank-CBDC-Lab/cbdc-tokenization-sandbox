const UNSIGNED_INTEGER = /^\d+$/;

/** Parse a chain/API integer without passing through JavaScript Number. */
export function parseUnsignedInteger(value, field = 'value') {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${field} must be a non-negative integer`);
    return value;
  }

  const text = String(value ?? '').trim();
  if (!UNSIGNED_INTEGER.test(text)) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return BigInt(text);
}

export function isPositiveInteger(value) {
  try {
    return parseUnsignedInteger(value) > 0n;
  } catch {
    return false;
  }
}

export function formatInteger(value) {
  try {
    const text = parseUnsignedInteger(value).toString();
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch {
    return String(value ?? '—');
  }
}

/** Format a non-negative integer ratio as a percentage with one decimal. */
export function formatPercentageRatio(numerator, denominator) {
  const top = parseUnsignedInteger(numerator, 'numerator');
  const bottom = parseUnsignedInteger(denominator, 'denominator');
  if (bottom === 0n) return '—';

  const tenths = (top * 1000n + bottom / 2n) / bottom;
  return `${tenths / 10n}.${tenths % 10n}%`;
}
