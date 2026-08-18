import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  EXPRESS_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  RPC_URL: z.string().min(1, 'RPC_URL is required'),
  GLOBAL_REGISTRY_ADDRESS: z.string().min(1, 'GLOBAL_REGISTRY_ADDRESS is required'),
  BOND_MANAGER_CONTRACT_NAME: z.string().min(1).default('Bond Manager'),
  BOND_ADMIN_PK: z.string().min(1, 'BOND_ADMIN_PK is required'),
  AUCTION_OWNER_SEAL_PK: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  // Central Bank private key — must hold MINTER/BURNER/ALLOWLIST_ADMIN roles on WNOK.
  // Sandbox-only: maps to the `PK_NORGES_BANK` fixture via the local sandbox
  // helm values. When unset, the Central Bank endpoints respond 503.
  CENTRAL_BANK_PK: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  // Registry name for the WNOK contract. Matches WNOK_CONTRACT_NAME in
  // contracts/.env. Default matches the local sandbox deploy.
  WNOK_CONTRACT_NAME: z.string().min(1).default('Wholesale NOK'),
  // Registry names for the per-bank TBD (tokenized bank deposit) contracts.
  // Match TBD_*_CONTRACT_NAME in contracts/.env; defaults match the local deploy.
  TBD_NORDEA_CONTRACT_NAME: z.string().min(1).default('TBD Nordea'),
  TBD_DNB_CONTRACT_NAME: z.string().min(1).default('TBD DNB'),
  // Registry name for the DvP contract (every TBD constructor takes its
  // address). Matches DVP_CONTRACT_NAME in contracts/.env.
  DVP_CONTRACT_NAME: z.string().min(1).default('Delivery vs Payment'),
  // Optional signing-key overrides for the fixture roles: the two
  // configured roster banks (TBD_BANKS in banking-tbd.ts) and the seeded
  // bidder roster (FIXTURE_ROSTER in bidders.ts). Names match
  // contracts/.env. When unset — the local-sandbox default — each key is
  // derived with the local-fixture scheme in bidders.ts. Set these in an
  // environment whose fixture contracts were deployed with externally held
  // keys. Malformed values fail startup (validated below); a well-formed
  // key that does not match the chain just leaves that bank read-only
  // (actAsAvailable=false).
  PK_NORDEA: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  PK_DNB: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  PK_ALICE_TBD: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  DB_PATH: z.string().default('data/ingestion.sqlite'),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  NB_BOND_API_SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15000),
  // Defensive fallback gas limit for closeAuction. If the RPC head is briefly
  // behind wall-clock, ethers' eth_estimateGas can simulate the close against
  // an older timestamp and false-revert with InBidPhase. After the wall-clock
  // precheck passes, the API may retry with this explicit limit. QBFT empty
  // blocks make that unlikely, but retaining the fallback is harmless during
  // the migration. Override if the contract's gas profile changes.
  NB_BOND_API_CLOSE_GAS_LIMIT: z.coerce.number().int().positive().default(3_000_000),
  // Comma-separated list of origins the CORS middleware accepts.
  // Default targets the local sandbox frontend at http://web.cbdc-sandbox.local.
  // Override (e.g. with multiple origins) for any non-local deployment.
  CORS_ALLOWED_ORIGINS: z.string().default('http://web.cbdc-sandbox.local'),

  // Auth mode. `none` (sandbox default) accepts and ignores the
  // Authorization header. `entra` validates the bearer token as a JWT
  // issued by Microsoft Entra ID. ArgoCD must keep this in sync with
  // the nb-ui AUTH_MODE — mismatches fail fast at startup, not silently.
  NB_BOND_API_AUTH_MODE: z.enum(['none', 'entra']).default('none'),
  NB_BOND_API_AUTH_ENTRA_TENANT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  NB_BOND_API_AUTH_ENTRA_AUDIENCE: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  // Comma-separated Entra App Role values granting operator (Central Bank)
  // access. Required when NB_BOND_API_AUTH_MODE=entra — without it the
  // /v1/central-bank/* endpoints would be unreachable. Must match the nb-ui
  // AUTH_OPERATOR_ROLES values and the App Role values defined in Entra.
  NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES: z.string().default(''),
  // Comma-separated Entra App Role values granting baseline access without
  // Central Bank (e.g. Sandbox.Tester). Optional; operators are always
  // recognised. In entra mode a token carrying none of the operator or
  // tester roles is rejected with 403.
  NB_BOND_API_AUTH_ENTRA_TESTER_ROLES: z.string().default(''),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.format();
  throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted, null, 2)}`);
}

// Fail fast when entra is requested without the required config.
if (parsedEnv.data.NB_BOND_API_AUTH_MODE === 'entra') {
  const missing: string[] = [];
  if (!parsedEnv.data.NB_BOND_API_AUTH_ENTRA_TENANT_ID) {
    missing.push('NB_BOND_API_AUTH_ENTRA_TENANT_ID');
  }
  if (!parsedEnv.data.NB_BOND_API_AUTH_ENTRA_AUDIENCE) {
    missing.push('NB_BOND_API_AUTH_ENTRA_AUDIENCE');
  }
  // Operator roles must be present, else /v1/central-bank/* is unreachable.
  const operatorRoleCount = parsedEnv.data.NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES.split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0).length;
  if (operatorRoleCount === 0) {
    missing.push('NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES');
  }
  if (missing.length) {
    throw new Error(
      `NB_BOND_API_AUTH_MODE=entra requires: ${missing.join(', ')}. ` +
        'Mode and config must be kept in sync by ArgoCD.',
    );
  }
}

// secp256k1 group order — a valid private-key scalar is in [1, order-1].
// Same constant as bidders.ts; not imported because env-vars must stay a
// leaf module (everything else imports it).
const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

// Fail fast on a malformed fixture-role key override: a typo should stop
// startup with the env var named, not surface later as an opaque signing
// failure. Valid values are normalized to 0x-prefixed lowercase.
for (const name of ['PK_NORDEA', 'PK_DNB', 'PK_ALICE_TBD'] as const) {
  const value = parsedEnv.data[name];
  if (value === undefined) continue;
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be a 32-byte hex private key (64 hex chars, 0x prefix optional)`);
  }
  const scalar = BigInt(`0x${hex}`);
  if (scalar === 0n || scalar >= SECP256K1_ORDER) {
    throw new Error(`${name} is not a valid secp256k1 private key (scalar out of range)`);
  }
  parsedEnv.data[name] = `0x${hex.toLowerCase()}`;
}

export const envVariables = parsedEnv.data;
