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
  DB_PATH: z.string().default('data/ingestion.sqlite'),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.format();
  throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted, null, 2)}`);
}

export const envVariables = parsedEnv.data;
