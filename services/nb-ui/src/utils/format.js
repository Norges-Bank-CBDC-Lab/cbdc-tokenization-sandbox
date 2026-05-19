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

export const Fmt = {
  shortHex,
  bpsToPct,
  formatUnits,
  formatNok,
  formatUnixDate,
  formatRelative,
  durationToYears,
};
