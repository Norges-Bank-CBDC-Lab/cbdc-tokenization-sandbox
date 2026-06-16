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
