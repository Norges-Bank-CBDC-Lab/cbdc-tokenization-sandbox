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
  DB_PATH: z.string().default('data/ingestion.sqlite'),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  // Fallback gas limit for closeAuction. The local Besu mints blocks only on
  // transactions, so its clock lags wall-clock and ethers' eth_estimateGas can
  // simulate the close against a stale block and false-revert with InBidPhase.
  // When that happens after the wall-clock precheck has passed, the close is
  // retried with this explicit limit to skip estimation. Override if the
  // contract's gas profile changes (e.g. after a Besu/EVM upgrade).
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

export const envVariables = parsedEnv.data;
