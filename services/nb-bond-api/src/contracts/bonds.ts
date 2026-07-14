import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { auctionSchema, createAuctionBodySchema } from './auctions';
import { errorRefs, mutationAcceptedJson, successJson } from '../openapi/shared-responses';
import {
  addressSchema,
  auctionIdSchema,
  bigIntStringSchema,
  bpsSchema,
  hexStringSchema,
  isinSchema,
  md5Schema,
  unixSecondsSchema,
} from './common';

export const bondStatusSchema = z
  .enum(['staged', 'auctioning', 'outstanding', 'matured', 'redeemed'])
  .meta({ id: 'BondStatus', description: 'Bond lifecycle status' });

export const holderBalanceSchema = z
  .object({ holder: addressSchema, balance: bigIntStringSchema, md5: md5Schema })
  .meta({ id: 'HolderBalance', description: 'A single bond holder and their balance' });

const maturitySchema = z
  .object({
    duration: bigIntStringSchema.nullable(),
    durationYears: bigIntStringSchema.nullable(),
    date: unixSecondsSchema.nullable(),
    remaining: bigIntStringSchema.nullable(),
    remainingYears: bigIntStringSchema.nullable(),
  })
  .meta({ id: 'BondMaturity', description: 'Maturity schedule at the projection checkpoint' });

const couponPaymentsSchema = z
  .object({
    total: bigIntStringSchema.nullable(),
    made: bigIntStringSchema.nullable(),
    remaining: bigIntStringSchema.nullable(),
  })
  .meta({ id: 'CouponPayments', description: 'Coupon payment progress' });

const couponSchema = z
  .object({
    duration: bigIntStringSchema.nullable(),
    durationYears: bigIntStringSchema.nullable(),
    rateBps: bpsSchema.nullable(),
    lastPaymentAt: unixSecondsSchema.nullable().meta({
      description:
        'Timestamp of the most recent coupon baseline. The projection initialises this to the ' +
        'finalise/issuance timestamp, so until the first payout it is the issuance date.',
    }),
    nextPaymentDue: unixSecondsSchema.nullable(),
    payable: z.boolean().meta({
      description:
        'True when the projection checkpoint timestamp has reached the next payment and payments remain.',
    }),
    payments: couponPaymentsSchema,
  })
  .meta({ id: 'BondCoupon', description: 'Coupon configuration and payment progress' });

export const bondSchema = z
  .object({
    isin: isinSchema,
    status: bondStatusSchema,
    disabled: z.boolean(),
    totalSupply: bigIntStringSchema.nullable(),
    contracts: z
      .object({ token: addressSchema, auction: addressSchema, manager: addressSchema })
      .meta({ id: 'BondContracts', description: 'Contracts involved in this bond' }),
    maturity: maturitySchema.nullable(),
    coupon: couponSchema.nullable(),
    holders: z.array(holderBalanceSchema),
    auctions: z.array(auctionSchema),
    md5: md5Schema,
  })
  .meta({
    id: 'Bond',
    description:
      'Bond resource carrying the full subtree of auctions, bids, allocations, and holders.',
  });

export const historyEventSchema = z
  .object({
    isin: isinSchema,
    auctionId: auctionIdSchema.nullable(),
    type: z.string(),
    block: z.number().int(),
    txHash: hexStringSchema,
    payload: z.unknown(),
  })
  .meta({ id: 'HistoryEvent', description: 'Immutable projected bond or auction event' });

export const createBondBodySchema = z
  .object({
    isin: isinSchema,
    maturityDuration: bigIntStringSchema.meta({
      description:
        'Maturity in DURATION_SCALAR units. The contract multiplies by DURATION_SCALAR; do not pre-convert.',
    }),
  })
  .meta({ id: 'CreateBondRequest', description: 'Request body for POST /v1/bonds' });

export const holdersBodySchema = z
  .object({ holders: z.array(addressSchema).nullable() })
  .meta({ id: 'HoldersBody', description: 'Body for coupon-payment and redemption operations' });

export const isinParamSchema = z
  .object({ isin: isinSchema })
  .meta({ id: 'IsinParam', description: 'ISIN path parameter' });

export const historyQuerySchema = z
  .object({
    before: z.coerce.number().int().nonnegative().nullable(),
    limit: z.coerce.number().int().positive().max(500).nullable(),
  })
  .meta({ id: 'HistoryQuery' });

export type Bond = z.infer<typeof bondSchema>;
export type BondStatus = z.infer<typeof bondStatusSchema>;
export type HolderBalance = z.infer<typeof holderBalanceSchema>;
export type HistoryEvent = z.infer<typeof historyEventSchema>;
export type CreateBondBody = z.infer<typeof createBondBodySchema>;
export type HoldersBody = z.infer<typeof holdersBodySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

const isinPathParam = {
  in: 'path' as const,
  name: 'isin',
  required: true,
  schema: { $ref: '#/components/schemas/Isin' },
};

const testModeQueryParam = {
  in: 'query' as const,
  name: 'testMode',
  required: false,
  schema: { type: 'boolean' as const, default: false },
  description:
    'Sandbox-only umbrella "test mode" flag. The operator UI flips this from the top bar; ArgoCD- ' +
    'managed deployments should ignore it. Today `testMode=true` enables: ' +
    '(a) unsealing of bids on auctions still in the BIDDING phase on bond / auction GETs; ' +
    '(b) skipping the API-side end-time pre-check on PATCH /v1/auctions/{id} (close) so the ' +
    'operator can attempt close before the bidding window expires — the on-chain contract still ' +
    'enforces `block.timestamp > metadata.end` and reverts with `InBidPhase()` if the window is ' +
    'open. Future test affordances will plumb through this same flag.',
};

const includeDisabledQueryParam = {
  in: 'query' as const,
  name: 'includeDisabled',
  required: false,
  schema: { type: 'boolean' as const, default: false },
  description:
    'When true, include soft-deleted bonds in the response. Disabled bonds are hidden by ' +
    'default to keep the operator working list focused. See DELETE /v1/bonds/{isin}.',
};

export const bondPaths: ZodOpenApiPathsObject = {
  '/v1/bonds': {
    get: {
      tags: ['bonds'],
      operationId: 'listBonds',
      summary: 'List all bonds with full subtree (auctions, bids, allocations, holders)',
      parameters: [testModeQueryParam, includeDisabledQueryParam],
      responses: {
        200: successJson(
          'All bonds. Primary cache-priming call for the UI.',
          z.array(bondSchema),
          true,
        ),
        ...errorRefs.read,
      },
    },
    post: {
      tags: ['bonds'],
      operationId: 'createBond',
      summary:
        'Create a bond partition without scheduling an auction. The first auction is scheduled ' +
        'separately via POST /v1/bonds/{isin}/auctions.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createBondBodySchema } },
      },
      responses: {
        201: successJson('Newly created bond with no auctions yet', bondSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}': {
    get: {
      tags: ['bonds'],
      operationId: 'getBond',
      summary: 'Get a single bond with full subtree',
      parameters: [isinPathParam, testModeQueryParam],
      responses: {
        200: successJson('Bond resource', bondSchema, true),
        ...errorRefs.read,
      },
    },
    delete: {
      tags: ['bonds'],
      operationId: 'disableBond',
      summary:
        'Soft-delete a bond. Requires no minted supply, no in-flight auction, and no FINALISED ' +
        'auction in history. Idempotent — returns 204 even if the bond is already disabled.',
      parameters: [isinPathParam],
      responses: {
        204: { description: 'Bond disabled (or was already disabled)' },
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/coupon-payments': {
    post: {
      tags: ['bonds'],
      operationId: 'payCoupon',
      summary:
        'Pay coupon to bond holders. Operator-only — the cash leg is paid from the government ' +
        'reserve (entra mode requires an operator App Role; 403 otherwise).',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: holdersBodySchema } },
      },
      responses: {
        200: successJson('Updated bond after submitting the coupon-payment tx', bondSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/redemptions': {
    post: {
      tags: ['bonds'],
      operationId: 'redeem',
      summary: 'Redeem bond tokens for holders',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: holdersBodySchema } },
      },
      responses: {
        200: successJson('Updated bond after submitting the redemption tx', bondSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/history': {
    get: {
      tags: ['bonds'],
      operationId: 'listBondHistory',
      summary: 'Paginated event history for a bond and its auctions',
      parameters: [
        isinPathParam,
        {
          in: 'query',
          name: 'before',
          required: false,
          schema: { type: 'integer', minimum: 0 },
          description: 'Return events with block < this value',
        },
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        },
      ],
      responses: {
        200: successJson('Event history', z.array(historyEventSchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/bonds/{isin}/auctions': {
    post: {
      tags: ['auctions'],
      operationId: 'createAuction',
      summary: 'Create an auction under a bond. Response is the updated parent Bond.',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createAuctionBodySchema } },
      },
      responses: {
        200: successJson('Updated bond with the new auction appended', bondSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
};
