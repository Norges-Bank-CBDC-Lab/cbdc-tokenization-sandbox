process.env.RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
process.env.GLOBAL_REGISTRY_ADDRESS =
  process.env.GLOBAL_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000001';
process.env.BOND_MANAGER_CONTRACT_NAME = process.env.BOND_MANAGER_CONTRACT_NAME ?? 'Bond Manager';
process.env.BOND_ADMIN_PK = process.env.BOND_ADMIN_PK ?? 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
