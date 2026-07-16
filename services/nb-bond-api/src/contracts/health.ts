import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { addressSchema, hexStringSchema } from './common';
import { errorRefs, successJson } from '../openapi/shared-responses';

export const healthContractsSchema = z
  .object({
    bondManager: addressSchema,
    bondAuction: addressSchema,
    bondToken: addressSchema,
    wnok: addressSchema.nullable().meta({
      description: 'WNOK contract address; null when WNOK is not registered in GlobalRegistry',
    }),
  })
  .meta({
    id: 'HealthContracts',
    description: 'Contract addresses the service is bound to',
  });

export const healthChainSchema = z
  .object({
    rpcUrl: z.string().meta({
      description: 'Sanitised RPC endpoint — protocol://host[:port] only, no credentials or path',
      examples: ['http://besu-archive.besu:8545'],
    }),
    chainId: z.number().nullable().meta({
      description: 'EVM chainId reported by the provider, or null when unreachable',
    }),
    head: z.number().nullable().meta({
      description: 'Chain head block number, or null when unreachable',
    }),
    headReachable: z.boolean().meta({
      description: 'True iff the backend could read the chain head at the time of this request',
    }),
  })
  .meta({
    id: 'HealthChain',
    description: 'On-chain reachability and head state',
  });

export const recentIngestionErrorSchema = z
  .object({
    ts: z.number().meta({ description: 'Unix-epoch ms when the error was observed' }),
    message: z.string().meta({ description: 'Error message from the failing tick' }),
    code: z
      .string()
      .nullable()
      .meta({ description: 'Error code (ethers `err.code`) or class name; null when neither set' }),
  })
  .meta({
    id: 'RecentIngestionError',
    description: 'Single entry in the ring buffer of recent ingestion errors',
  });

export const healthIngestionSchema = z
  .object({
    loopRunning: z.boolean().meta({
      description: 'True once startIngestionLoop() has wired its setInterval',
    }),
    lastBlockProcessed: z.number().nullable().meta({
      description: 'Last block the loop wrote to the projection, or null before the first tick',
    }),
    lag: z.number().nullable().meta({
      description: 'chain.head - ingestion.lastBlockProcessed; null when either side is unknown',
    }),
    pollIntervalMs: z.number().meta({
      description: 'Configured poll cadence for the ingestion loop',
    }),
    lastTickAt: z.number().nullable().meta({
      description: 'Unix-epoch ms of the last tick (success or failure), or null pre-first-tick',
    }),
    lastEventTxHash: z.string().nullable().meta({
      description:
        'Most recent tx hash whose log we ingested; null before any events have been seen this process',
    }),
    consecutiveFailures: z.number().meta({
      description: 'Count of tick failures since the last success; reset on each successful tick',
    }),
    recentErrors: z.array(recentIngestionErrorSchema).meta({
      description:
        'Ring buffer (newest first, max 10) of the most recent ingestion-loop errors. Cleared on a successful restart via /v1/admin/restart-ingestion.',
    }),
  })
  .meta({
    id: 'HealthIngestion',
    description: 'Runtime state of the in-process ingestion loop',
  });

export const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    contracts: healthContractsSchema,
    sealingPubKey: hexStringSchema,
    chain: healthChainSchema,
    ingestion: healthIngestionSchema,
  })
  .meta({
    id: 'Health',
    description: 'Service health and binding information',
  });

export const restartOutcomeSchema = z
  .object({
    restarted: z.boolean().meta({
      description:
        'True when the ingestion loop confirmed `loopRunning=true` within the 5s timeout. ' +
        'False means the loop is still coming up (e.g. chain unreachable); operator UI ' +
        'should poll /v1/health to track readiness.',
    }),
    status: healthIngestionSchema.meta({
      description: 'Post-restart snapshot of the ingestion-loop state',
    }),
  })
  .meta({
    id: 'RestartOutcome',
    description: 'Result of POST /v1/admin/restart-ingestion',
  });

export const healthPaths: ZodOpenApiPathsObject = {
  '/v1/health': {
    get: {
      tags: ['system'],
      operationId: 'getHealth',
      summary: 'Service health',
      security: [],
      responses: {
        200: successJson('Health and binding information', healthSchema),
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
  '/v1/admin/restart-ingestion': {
    post: {
      tags: ['admin'],
      operationId: 'restartIngestion',
      summary: 'Restart the in-process ingestion loop',
      description:
        'Tears down the running ingestion loop and starts a fresh one via the same ' +
        'retry-with-backoff helper used at boot. With `?fromBlock=0`, also drops every ' +
        'table in the central projection list so the rebuild starts from `START_BLOCK`. ' +
        'The bidders, banks, and operation-attempt audit tables are preserved systems of record. ' +
        'Returns once `loopRunning=true` or after a 5s timeout; the operator UI polls ' +
        '`/v1/health` to track the rest of the rebuild.',
      parameters: [
        {
          in: 'query' as const,
          name: 'fromBlock',
          required: false,
          description:
            'Set to `0` to drop the projection before restarting (destructive — operator UI ' +
            'gates with a type-to-confirm phrase). Any other value, or absent, performs a ' +
            'plain restart without touching the projection.',
          schema: { type: 'string' as const, enum: ['0'] },
        },
      ],
      responses: {
        200: successJson(
          'Restart completed within the timeout; payload reflects post-restart state.',
          restartOutcomeSchema,
        ),
        202: successJson(
          'Restart accepted; loop is still coming up after the 5s timeout (e.g. chain ' +
            'still unreachable). Poll /v1/health to observe readiness.',
          restartOutcomeSchema,
        ),
        ...errorRefs.mutate,
      },
    },
  },
};

export type Health = z.infer<typeof healthSchema>;
