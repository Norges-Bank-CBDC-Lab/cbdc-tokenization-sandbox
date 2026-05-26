/**
 * format — pure rendering helpers.
 *
 * The API speaks in BigInt strings, bps, unix seconds, and hex addresses.
 * These helpers turn them into UI-ready text. Keep them dumb and pure.
 */

export function shortHex(hex, head = 6, tail = 4) {
  if (!hex) return '—';
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;
}

export function bpsToPct(bps) {
  if (bps == null || bps === '') return '—';
  const n = Number(bps);
  if (!isFinite(n)) return String(bps);
  return (n / 100).toFixed(2) + '%';
}

export function formatUnits(units) {
  if (units == null || units === '') return '—';
  const n = Number(units);
  if (!isFinite(n)) return String(units);
  return n.toLocaleString('en-US');
}

export function formatNok(units) {
  if (units == null) return '—';
  const n = Number(units) * 1000;
  if (!isFinite(n)) return String(units);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B NOK';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M NOK';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' K NOK';
  return n.toLocaleString('en-US') + ' NOK';
}

export function formatUnixDate(secs) {
  if (secs == null || secs === '') return '—';
  const ms = Number(secs) * 1000;
  if (!isFinite(ms)) return String(secs);
  const d = new Date(ms);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(secs) {
  if (secs == null || secs === '') return '—';
  const target = Number(secs) * 1000;
  const diff = target - Date.now();
  const abs = Math.abs(diff);
  const day = 86400000;
  const hr = 3600000;
  const min = 60000;
  let val, unit;
  if (abs >= day) {
    val = Math.round(abs / day);
    unit = 'day';
  } else if (abs >= hr) {
    val = Math.round(abs / hr);
    unit = 'hour';
  } else {
    val = Math.round(abs / min);
    unit = 'min';
  }
  const plural = val === 1 ? '' : 's';
  return diff > 0 ? `in ${val} ${unit}${plural}` : `${val} ${unit}${plural} ago`;
}

export function durationToYears(seconds) {
  if (seconds == null || seconds === '') return '—';
  const n = Number(seconds);
  if (!isFinite(n)) return String(seconds);
  const years = n / (365 * 86400);
  if (years >= 1) return years.toFixed(1) + ' yr';
  const months = n / (30 * 86400);
  return months.toFixed(0) + ' mo';
}

/**
 * Format a chain-relative duration expressed in DURATION_SCALAR units.
 * The API serves these alongside the raw-seconds fields (e.g.
 * `maturity.durationYears`) precisely so the UI doesn't have to know
 * the chain's seconds-per-year. On a real chain 1 unit = 1 calendar
 * year; on the sandbox 1 unit = DURATION_SCALAR seconds (60 today).
 * Display them as plain "N yr".
 */
export function formatYears(units) {
  if (units == null || units === '') return '—';
  const n = Number(units);
  if (!isFinite(n)) return String(units);
  if (n === 0) return '< 1 yr';
  if (Number.isInteger(n)) return `${n} yr`;
  return `${n.toFixed(1)} yr`;
}

// Bid `rate` is a 1e4-scaled integer whose meaning depends on auction
// type: bps yield for RATE, price-per-100 nominal for PRICE/BUYBACK.
// Render the numeric value with the right unit suffix for each.
export function formatBidRate(rate, auctionType) {
  if (rate == null || rate === '') return '—';
  const n = Number(rate);
  if (!isFinite(n)) return String(rate);
  if (auctionType === 'RATE') return (n / 100).toFixed(2) + '%';
  return (n / 100).toFixed(2);
}

export function rateColumnLabel(auctionType) {
  if (auctionType === 'PRICE') return 'Price';
  if (auctionType === 'BUYBACK') return 'Repurchase price';
  return 'Yield';
}

export function bestRateLabel(auctionType) {
  if (auctionType === 'PRICE') return 'Best (highest) price';
  if (auctionType === 'BUYBACK') return 'Best (lowest) repurchase price';
  return 'Best (lowest) yield';
}

export function clearingLabel(auctionType) {
  if (auctionType === 'PRICE') return 'Clearing price';
  if (auctionType === 'BUYBACK') return 'Clearing repurchase price';
  return 'Clearing yield';
}

export const Fmt = {
  shortHex,
  bpsToPct,
  formatUnits,
  formatNok,
  formatUnixDate,
  formatRelative,
  durationToYears,
  formatYears,
  formatBidRate,
  rateColumnLabel,
  bestRateLabel,
  clearingLabel,
};
