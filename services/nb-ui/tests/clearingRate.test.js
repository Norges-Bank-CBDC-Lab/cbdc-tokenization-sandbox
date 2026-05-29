import { describe, it, expect } from 'vitest';
import { marginalClearingBps } from '../src/pages/AuctionLifecyclePanel.jsx';

// The UI sends this value as `expectedClearingRate`; the backend recomputes
// the same uniform-price marginal and rejects on mismatch. These cases must
// stay in parity with nb-bond-api's computeUniformAllocation.
const bid = (rate, units, bidIndex) => ({ rate: String(rate), units: String(units), bidIndex });

describe('marginalClearingBps', () => {
  it('returns the highest selected rate when the selection fits within the offering (RATE)', () => {
    // Mirrors auction PO9384674360 minus the outlier: 7 bids, 1170 units total,
    // offering 2000 → all fill → marginal is the highest selected rate, 425.
    const picked = [
      bid(325, 100, 0),
      bid(125, 50, 1),
      bid(425, 200, 2),
      bid(275, 90, 3),
      bid(348, 30, 4),
      bid(425, 600, 6),
      bid(374, 100, 7),
    ];
    expect(marginalClearingBps(picked, 'RATE', 2000)).toBe(425);
  });

  it('returns the marginal (lower) rate when the selection over-fills the offering (RATE)', () => {
    // offering 200: sorted asc 125(50),275(90),325(100),425(600) → cum 50,140,200
    // exhausts at the 325 bid → marginal = 325, NOT max(selected)=425.
    const picked = [bid(325, 100, 0), bid(125, 50, 1), bid(275, 90, 3), bid(425, 600, 6)];
    expect(marginalClearingBps(picked, 'RATE', 200)).toBe(325);
  });

  it('fills highest-first for PRICE auctions', () => {
    // offering 5: desc 110(3),100(6),90(6) → fill 3 then 2 → marginal = 100.
    const picked = [bid(110, 3, 0), bid(100, 6, 1), bid(90, 6, 2)];
    expect(marginalClearingBps(picked, 'PRICE', 5)).toBe(100);
  });

  it('breaks ties on rate by larger units first', () => {
    // offering 3, two 100-rate bids (units 2 and 3): larger-units bid fills first,
    // fully covering the offering → marginal = 100.
    const picked = [bid(100, 2, 0), bid(100, 3, 1)];
    expect(marginalClearingBps(picked, 'RATE', 3)).toBe(100);
  });

  it('returns 0 for an empty selection', () => {
    expect(marginalClearingBps([], 'RATE', 2000)).toBe(0);
  });
});
