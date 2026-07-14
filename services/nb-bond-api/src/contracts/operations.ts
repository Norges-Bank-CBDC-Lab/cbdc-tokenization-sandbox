import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { hexStringSchema } from './common';
import { errorRefs, successJson } from '../openapi/shared-responses';

export const operationTypeSchema = z
  .enum([
    'BOND_CREATE',
    'BOND_DISABLE',
    'AUCTION_CREATE',
    'AUCTION_CLOSE',
    'AUCTION_CANCEL',
    'AUCTION_FINALISE',
    'COUPON_PAYMENT',
    'REDEMPTION',
    'BID_SUBMISSION',
    'WNOK_MINT',
    'WNOK_BURN',
    'WNOK_TRANSFER',
    'WNOK_ALLOWLIST_ADD',
    'WNOK_ALLOWLIST_REMOVE',
    'BANK_CREATE',
    'TBD_MINT',
    'TBD_BURN',
    'TBD_TRANSFER',
    'TBD_ALLOWLIST_ADD',
    'TBD_ALLOWLIST_REMOVE',
  ])
  .meta({
    id: 'OperationType',
    description: 'Operator-initiated on-chain operation recorded in the audit trail',
  });

export const operationStatusSchema = z.enum(['SUCCEEDED', 'REVERTED', 'FAILED', 'PARTIAL']).meta({
  id: 'OperationStatus',
  description:
    'Attempt outcome. REVERTED carries the decoded on-chain reason; FAILED is a transport ' +
    'or validation failure; PARTIAL is reserved for future per-leg settlement outcomes.',
});

export const operationAttemptSchema = z
  .object({
    id: z.number().int().meta({ description: 'Monotonic attempt id (higher = newer)' }),
    opType: operationTypeSchema,
    target: z.string().meta({
      description:
        'Primary resource the operation acted on: ISIN, auction id, address, or bank name',
    }),
    status: operationStatusSchema,
    txHash: hexStringSchema.nullable().meta({
      description:
        'Transaction hash when one was broadcast; null when gas estimation rejected the send ' +
        'before broadcast or the operation spans multiple transactions',
    }),
    error: z.string().nullable().meta({
      description: 'Decoded revert reason or failure message; null on success',
    }),
    detail: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: 'Small operation-specific payload (amounts as strings, counts)' }),
    createdAt: z
      .number()
      .int()
      .meta({ description: 'Attempt timestamp (unix seconds, server clock)' }),
  })
  .meta({
    id: 'OperationAttempt',
    description:
      'One operator-initiated on-chain operation attempt from the persistent audit trail. ' +
      'Failed attempts mostly never reach the chain (rejected at gas estimation), so this ' +
      'trail is their only durable record.',
  });

export const operationPaths: ZodOpenApiPathsObject = {
  '/v1/operations': {
    get: {
      tags: ['system'],
      operationId: 'listOperations',
      summary: 'List operator operation attempts (audit trail), newest first',
      parameters: [
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        },
      ],
      responses: {
        200: successJson('Operation attempts, newest first', z.array(operationAttemptSchema)),
        ...errorRefs.read,
      },
    },
  },
};
