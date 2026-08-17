/**
 * Banking (TBD) module tests.
 *
 * Like the Central Bank module, banking-tbd is a thin chain wrapper, so the
 * tests cover the surface that's likely to drift: the configured bank roster
 * (names, fixture roles, registry names) and the malformed-address guard.
 * Round-trip reads against a real chain are covered by the live curl
 * verification, not here — jest boots the module against a no-op provider.
 */
import { TBD_BANKS, composeBankInfo, getTbdToken } from '../src/banking-tbd';
import { deriveBidderAddress, deriveFixturePrivateKey } from '../src/bidders';

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

describe('configured bank key overrides', () => {
  // Any well-formed secp256k1 key that is NOT a fixture derivation.
  const OVERRIDE = `0x${'11'.repeat(32)}`;
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  // Fresh module instance so banking-tbd (and env-vars) re-read process.env.
  const loadModule = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/banking-tbd') as typeof import('../src/banking-tbd');

  it('uses the env override for the matching role and only that role', () => {
    process.env.PK_NORDEA = OVERRIDE;
    jest.resetModules();
    const { configuredBankSigningKey } = loadModule();

    expect(configuredBankSigningKey('PK_NORDEA')).toBe(OVERRIDE);
    expect(configuredBankSigningKey('PK_DNB')).toBe(deriveFixturePrivateKey('PK_DNB'));
  });

  it('derives the fixture key when no override is set', () => {
    delete process.env.PK_NORDEA;
    delete process.env.PK_DNB;
    jest.resetModules();
    const { configuredBankSigningKey } = loadModule();

    expect(configuredBankSigningKey('PK_NORDEA')).toBe(deriveFixturePrivateKey('PK_NORDEA'));
    expect(configuredBankSigningKey('PK_DNB')).toBe(deriveFixturePrivateKey('PK_DNB'));
  });

  it('accepts an un-prefixed override and normalizes it to 0x-lowercase', () => {
    process.env.PK_NORDEA = OVERRIDE.slice(2).toUpperCase();
    jest.resetModules();
    const { configuredBankSigningKey } = loadModule();

    expect(configuredBankSigningKey('PK_NORDEA')).toBe(OVERRIDE);
  });

  it('stays honest about chain truth when the override does not match', () => {
    process.env.PK_NORDEA = OVERRIDE;
    jest.resetModules();
    const mod = loadModule();
    const key = mod.configuredBankSigningKey('PK_NORDEA');

    // The chain's bank is the fixture-deployed address, not the override's.
    const onChain = deriveBidderAddress(deriveFixturePrivateKey('PK_NORDEA'));
    const mismatch = mod.composeBankInfo('Nordea Bank', key, onChain);
    expect(mismatch.address).toBe(onChain);
    expect(mismatch.actAsAvailable).toBe(false);

    // The chain's bank IS the override's address — act-as becomes available.
    const match = mod.composeBankInfo('Nordea Bank', key, deriveBidderAddress(key));
    expect(match.actAsAvailable).toBe(true);
  });
});

describe('composeBankInfo', () => {
  // The bank listing must publish chain truth: the address the TBD contract
  // records, with the roster key reduced to an act-as capability flag. This
  // pins the environment-mismatch scenario that broke the deployed Banking
  // page: a chain whose TBDs were NOT deployed with this API's keys.
  const nordeaKey = deriveFixturePrivateKey('PK_NORDEA');
  const nordeaAddress = deriveBidderAddress(nordeaKey);

  it('reports actAsAvailable=true when the roster key IS the on-chain bank', () => {
    const info = composeBankInfo('Nordea Bank', nordeaKey, nordeaAddress);
    expect(info).toEqual({ name: 'Nordea Bank', address: nordeaAddress, actAsAvailable: true });
    expect(info).not.toHaveProperty('privateKey');
  });

  it('publishes the on-chain address, not the derived one, when they differ', () => {
    // A different environment's bank address — the contract's answer wins.
    const onChain = deriveBidderAddress(deriveFixturePrivateKey('PK_DNB'));
    const info = composeBankInfo('Nordea Bank', nordeaKey, onChain);
    expect(info.address).toBe(onChain);
    expect(info.address).not.toBe(nordeaAddress);
    expect(info.actAsAvailable).toBe(false);
  });

  it('compares addresses case-insensitively and returns checksummed output', () => {
    const info = composeBankInfo('Nordea Bank', nordeaKey, nordeaAddress.toLowerCase());
    expect(info.address).toBe(nordeaAddress); // checksummed
    expect(info.actAsAvailable).toBe(true);
  });
});
