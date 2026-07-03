/**
 * Banking (TBD) module tests.
 *
 * Like the Central Bank module, banking-tbd is a thin chain wrapper, so the
 * tests cover the surface that's likely to drift: the configured bank roster
 * (names, fixture roles, registry names) and the malformed-address guard.
 * Round-trip reads against a real chain are covered by the live curl
 * verification, not here — jest boots the module against a no-op provider.
 */
import { TBD_BANKS, getTbdToken, listBanks } from '../src/banking-tbd';

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

describe('listBanks', () => {
  it('lists the configured banks with derived addresses and no key material', () => {
    // No created-banks DB injected in this suite → configured roster only.
    const banks = listBanks();
    expect(banks.map((b) => b.name)).toEqual(['Nordea Bank', 'DNB Bank']);
    for (const bank of banks) {
      expect(bank.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(bank).not.toHaveProperty('role');
      expect(bank).not.toHaveProperty('privateKey');
    }
  });
});
