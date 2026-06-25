/**
 * GlobalRegistry inventory tests.
 *
 * Like banking-tbd, registry is a thin chain wrapper — live resolution is
 * covered by the curl verification, not jest (which boots against a no-op
 * provider). Here we pin the drift-prone surface: the canonical name set. If
 * the deploy renames or drops a registered contract, this list must move with
 * it. The four env-backed names resolve to their defaults under test.
 */
import { REGISTRY_CONTRACT_NAMES } from '../src/registry';

describe('registry canonical names', () => {
  it('pins the contracts the local deploy registers', () => {
    expect([...REGISTRY_CONTRACT_NAMES]).toEqual([
      'Wholesale NOK',
      'Bond Manager',
      'Bond Auction',
      'Bond Token',
      'Bond Delivery vs Payment',
      'TBD Nordea',
      'TBD DNB',
      'Delivery vs Payment',
      'Order Book',
      'StockToken Factory',
      'Pareto Broker',
      'DNB Markets Broker',
    ]);
  });

  it('has no duplicate names', () => {
    expect(new Set(REGISTRY_CONTRACT_NAMES).size).toBe(REGISTRY_CONTRACT_NAMES.length);
  });
});
