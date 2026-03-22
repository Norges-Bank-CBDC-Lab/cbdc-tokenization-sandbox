export function statusToString(status: number): string {
  switch (status) {
    case 0:
      return 'NONE';
    case 1:
      return 'BIDDING';
    case 2:
      return 'CLOSED';
    case 3:
      return 'FINALISED';
    case 4:
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

export function auctionTypeToString(auctionType: number): string {
  switch (auctionType) {
    case 0:
      return 'RATE';
    case 1:
      return 'PRICE';
    case 2:
      return 'BUYBACK';
    default:
      return 'UNKNOWN';
  }
}

export function toPlainObject(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => toPlainObject(v));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = toPlainObject(v);
    }
    return out;
  }
  return value;
}
