// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadEnvVars = () => require('../src/env-vars') as { envVariables: Record<string, unknown> };

describe('env-vars', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires RPC_URL', () => {
    process.env.RPC_URL = '';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';

    expect(() => loadEnvVars()).toThrow(/RPC_URL/);
  });

  it('treats a blank AUCTION_OWNER_SEAL_PK as undefined', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.AUCTION_OWNER_SEAL_PK = '  ';

    const { envVariables } = loadEnvVars();

    expect(envVariables.AUCTION_OWNER_SEAL_PK).toBeUndefined();
  });

  it('defaults the SSE heartbeat interval', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    delete process.env.NB_BOND_API_SSE_HEARTBEAT_MS;

    const { envVariables } = loadEnvVars();

    expect(envVariables.NB_BOND_API_SSE_HEARTBEAT_MS).toBe(15_000);
  });

  it('requires operator roles when AUTH_MODE=entra', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.NB_BOND_API_AUTH_MODE = 'entra';
    process.env.NB_BOND_API_AUTH_ENTRA_TENANT_ID = 'tenant';
    process.env.NB_BOND_API_AUTH_ENTRA_AUDIENCE = 'api://test';
    delete process.env.NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES;

    expect(() => loadEnvVars()).toThrow(/NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES/);
  });

  it('treats a blank configured-bank key override as undefined', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.PK_NORDEA = '  ';

    const { envVariables } = loadEnvVars();

    expect(envVariables.PK_NORDEA).toBeUndefined();
  });

  it('normalizes a valid configured-bank key override to 0x-lowercase', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    // 64 uppercase hex chars, no 0x prefix.
    process.env.PK_DNB = 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789';

    const { envVariables } = loadEnvVars();

    expect(envVariables.PK_DNB).toBe(`0x${(process.env.PK_DNB as string).toLowerCase()}`);
  });

  it('rejects a malformed configured-bank key override at startup', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.PK_NORDEA = 'not-a-key';

    expect(() => loadEnvVars()).toThrow(/PK_NORDEA/);
  });

  it('validates the bidder-role override PK_ALICE_TBD like the bank roles', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.PK_ALICE_TBD = 'not-a-key';

    expect(() => loadEnvVars()).toThrow(/PK_ALICE_TBD/);
  });

  it('rejects an out-of-range configured-bank key override at startup', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    // 64 valid hex chars, but ≥ the secp256k1 group order — not a usable key.
    process.env.PK_DNB = `0x${'f'.repeat(64)}`;

    expect(() => loadEnvVars()).toThrow(/PK_DNB/);
  });

  it('accepts entra mode when operator roles are set', () => {
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.BOND_ADMIN_PK = 'test';
    process.env.NB_BOND_API_AUTH_MODE = 'entra';
    process.env.NB_BOND_API_AUTH_ENTRA_TENANT_ID = 'tenant';
    process.env.NB_BOND_API_AUTH_ENTRA_AUDIENCE = 'api://test';
    process.env.NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES = 'Sandbox.Operator';

    const { envVariables } = loadEnvVars();

    expect(envVariables.NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES).toBe('Sandbox.Operator');
  });
});
