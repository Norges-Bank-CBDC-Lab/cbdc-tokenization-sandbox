/**
 * useRoute — minimal hash-based router.
 *
 *   #/bonds                          -> { name: "bonds" }
 *   #/bonds/NO0012345678             -> { name: "bond", isin: "NO0012345678" }
 *   #/auctions                       -> { name: "auctions" }
 *   #/auctions/0xabc...              -> { name: "auction", auctionId: "0xabc..." }
 *   #/bidders                        -> { name: "bidders" }
 *   #/central-bank                   -> { name: "central-bank" }
 *   #/coupon-payout                  -> { name: "coupon-payout" }
 *   #/stocks                         -> { name: "stocks" }
 *   #/tbd                            -> { name: "tbd" }
 */
import { useState, useEffect, useCallback } from 'react';

export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === '') return { name: 'bonds' };
  const [section, ...rest] = parts;
  if (section === 'bonds') {
    if (rest.length === 0) return { name: 'bonds' };
    return { name: 'bond', isin: decodeURIComponent(rest[0]) };
  }
  if (section === 'auctions') {
    if (rest.length === 0) return { name: 'auctions' };
    return { name: 'auction', auctionId: decodeURIComponent(rest[0]) };
  }
  if (section === 'bidders') {
    return { name: 'bidders' };
  }
  if (section === 'central-bank') {
    return { name: 'central-bank' };
  }
  if (section === 'coupon-payout') {
    return { name: 'coupon-payout' };
  }
  if (section === 'stocks') {
    return { name: 'stocks' };
  }
  if (section === 'tbd') {
    return { name: 'tbd' };
  }
  if (section === 'registry') {
    return { name: 'registry' };
  }
  return { name: 'bonds' };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path) => {
    window.location.hash = path.startsWith('#') ? path : '#' + path;
  }, []);

  return { route, navigate };
}
