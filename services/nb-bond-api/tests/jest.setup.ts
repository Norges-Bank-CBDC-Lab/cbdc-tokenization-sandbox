process.env.RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
process.env.GLOBAL_REGISTRY_ADDRESS =
  process.env.GLOBAL_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000001';
process.env.BOND_MANAGER_CONTRACT_NAME = process.env.BOND_MANAGER_CONTRACT_NAME ?? 'Bond Manager';
// Valid-shape secp256k1 private key (not a real key — used only for tests
// that transitively import src/chain.ts which instantiates a Wallet at
// module load).
process.env.BOND_ADMIN_PK =
  process.env.BOND_ADMIN_PK ??
  '0x0000000000000000000000000000000000000000000000000000000000000001';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
