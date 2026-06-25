/**
 * Banking (TBD) module tests.
 *
 * Like the Central Bank module, banking-tbd is a thin chain wrapper, so the
 * tests cover the surface that's likely to drift: the configured bank roster
 * (names, fixture roles, registry names) and the malformed-address guard.
 * Round-trip reads against a real chain are covered by the live curl
 * verification, not here — jest boots the module against a no-op provider.
 */
import { TBD_BANKS, getTbdToken } from '../src/banking-tbd';

describe('banking-tbd config', () => {
  it('configures the two local-sandbox banks with their fixture roles and registry names', () => {
    expect(TBD_BANKS).toHaveLength(2);
    expect(TBD_BANKS.map((b) => b.bankName)).toEqual(['Nordea Bank', 'DNB Bank']);
    expect(TBD_BANKS.map((b) => b.role)).toEqual(['PK_NORDEA', 'PK_DNB']);
    // Default registry names; overridable via TBD_*_CONTRACT_NAME env.
    expect(TBD_BANKS.map((b) => b.contractName)).toEqual(['TBD Nordea', 'TBD DNB']);
  });
});

describe('getTbdToken', () => {
  it('returns null for a malformed address without touching the chain', async () => {
    await expect(getTbdToken('not-an-address')).resolves.toBeNull();
  });
});
