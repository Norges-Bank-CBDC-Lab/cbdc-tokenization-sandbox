/**
 * Central Bank module tests.
 *
 * The CB module is intentionally a thin contract wrapper, so the tests
 * concentrate on the surface that's likely to drift: gating on missing
 * config, WNOK resolution failure, and address normalisation.
 *
 * Round-trip mint/burn/transfer/allowlist against a real chain is
 * covered by the live curl verification in Phase 1d, not here — jest
 * boots the module against a no-op provider.
 */

describe('central-bank gating', () => {
  const originalKey = process.env.CENTRAL_BANK_PK;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CENTRAL_BANK_PK;
    } else {
      process.env.CENTRAL_BANK_PK = originalKey;
    }
    jest.resetModules();
  });

  it('reports unavailable when CENTRAL_BANK_PK is unset', async () => {
    delete process.env.CENTRAL_BANK_PK;
    jest.resetModules();
    const { isCentralBankReady } = await import('../src/central-bank');
    expect(await isCentralBankReady()).toBe(false);
  });

  it('throws CentralBankNotConfiguredError on writes when key is missing', async () => {
    delete process.env.CENTRAL_BANK_PK;
    jest.resetModules();
    const { CentralBankNotConfiguredError, mintWnok } = await import('../src/central-bank');
    await expect(mintWnok('0x' + '11'.repeat(20), 1n)).rejects.toBeInstanceOf(
      CentralBankNotConfiguredError,
    );
  });

  it('derives a real CB address when the key is a valid 32-byte hex', async () => {
    process.env.CENTRAL_BANK_PK = '0x' + '1'.repeat(63) + '2'; // 64 hex chars
    jest.resetModules();
    const { getCbAddress } = await import('../src/central-bank');
    const address = getCbAddress();
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
