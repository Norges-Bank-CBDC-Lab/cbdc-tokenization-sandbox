import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { errorRefs, mutationAcceptedJson, successJson } from '../openapi/shared-responses';

import {
  addressSchema,
  auctionIdSchema,
  bigIntStringSchema,
  blockNumberSchema,
  bpsSchema,
  hexStringSchema,
  isinSchema,
  md5Schema,
  unixMillisSchema,
  unixSecondsSchema,
} from './common';

export const auctionTypeSchema = z.enum(['RATE', 'PRICE', 'BUYBACK']).meta({
  id: 'AuctionType',
  description: 'Auction pricing model',
});

export const auctionStatusSchema = z.enum(['open', 'closed', 'finalised', 'cancelled']).meta({
  id: 'AuctionStatus',
  description: 'Auction lifecycle status',
});

export const bidStateSchema = z.enum(['sealed', 'unsealed']).meta({
  id: 'BidState',
  description: 'Bid disclosure state',
});

export const txRefSchema = z
  .object({ hash: hexStringSchema, block: blockNumberSchema })
  .meta({ id: 'TxRef', description: 'Reference to an on-chain transaction' });

export const allocationEntrySchema = z
  .object({ bidder: addressSchema, units: bigIntStringSchema, rate: bpsSchema })
  .meta({ id: 'AllocationEntry', description: 'A single bidder share of a completed allocation' });

export const allocationSchema = z
  .object({
    clearingRate: bpsSchema,
    totalAllocated: bigIntStringSchema,
    hash: hexStringSchema.meta({
      description:
        'Off-chain commitment to the computed allocation (clearing rate + each bidder share); ' +
        'recomputed server-side and confirmed by the operator at finalisation.',
    }),
    auctionType: auctionTypeSchema,
    computedAt: unixMillisSchema,
    entries: z.array(allocationEntrySchema),
    md5: md5Schema,
  })
  .meta({ id: 'Allocation', description: 'Computed allocation result for a closed auction' });

export const bidIndexSchema = z
  .number()
  .int()
  .nonnegative()
  .meta({
    id: 'BidIndex',
    description:
      'On-chain sealed-bid array index identifying this bid within its auction. Stable for the ' +
      'life of the auction; used by the operator UI to address winners at finalisation.',
  });

export const sealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('sealed'),
    bidIndex: bidIndexSchema,
    ciphertext: hexStringSchema,
    plaintextHash: hexStringSchema,
    md5: md5Schema,
  })
  .meta({ id: 'SealedBid', description: 'Encrypted bid visible before auction close' });

export const unsealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('unsealed'),
    bidIndex: bidIndexSchema,
    rate: bpsSchema,
    units: bigIntStringSchema,
    md5: md5Schema,
  })
  .meta({ id: 'UnsealedBid', description: 'Decrypted bid visible after auction close' });

export const bidSchema = z
  .discriminatedUnion('state', [sealedBidSchema, unsealedBidSchema])
  .meta({ id: 'Bid', description: 'Bid in its sealed or unsealed disclosure state' });

export const auctionSchema = z
  .object({
    id: auctionIdSchema,
    isin: isinSchema,
    type: auctionTypeSchema,
    status: auctionStatusSchema,
    end: unixSecondsSchema.nullable(),
    size: bigIntStringSchema.nullable(),
    maturityDuration: bigIntStringSchema.nullable(),
    owner: addressSchema,
    sealingPubKey: hexStringSchema,
    contracts: z
      .object({ auction: addressSchema, token: addressSchema })
      .meta({ id: 'AuctionContracts', description: 'Contracts involved in this auction' }),
    bids: z.array(bidSchema),
    allocation: allocationSchema.nullable(),
    txs: z
      .object({
        create: txRefSchema,
        close: txRefSchema.nullable(),
        finalise: txRefSchema.nullable(),
        cancel: txRefSchema.nullable(),
      })
      .meta({ id: 'AuctionTxs', description: 'Lifecycle transaction references' }),
    md5: md5Schema,
  })
  .meta({
    id: 'Auction',
    description:
      'Auction subtree. Bid shape is discriminated by state; allocation is null until close.',
  });

export const createAuctionBodySchema = z
  .object({
    type: auctionTypeSchema,
    end: unixSecondsSchema.meta({ description: 'Auction close timestamp (unix seconds)' }),
    size: bigIntStringSchema.meta({ description: 'Offering or buyback size in 1000-NOK units' }),
    maturityDuration: bigIntStringSchema.nullable().meta({
      description:
        'Maturity in DURATION_SCALAR units (years on a real chain; sandbox treats each unit ' +
        'as 60 seconds for fast testing). The contract multiplies by DURATION_SCALAR to derive ' +
        'seconds — do not pre-convert. Required for RATE auctions; null otherwise.',
    }),
  })
  .meta({
    id: 'CreateAuctionBody',
    description: 'Request body for creating an auction under a bond',
  });

export const closeAuctionBodySchema = z
  .object({
    status: z.literal('closed').meta({
      description: 'Target status. Only "closed" is accepted today; enum extensible later.',
    }),
  })
  .meta({ id: 'CloseAuctionBody', description: 'PATCH body for the close transition' });

export const finaliseBodySchema = z
  .object({
    approve: z
      .literal(true)
      .meta({ description: 'Approve and submit the selected allocation on-chain.' }),
    winningBidIndexes: z
      .array(bidIndexSchema)
      .min(1)
      .meta({
        description:
          'Sealed-bid indexes (each Bid.bidIndex) selected as winners. The server recomputes the ' +
          'allocation over exactly these bids and ignores all unselected bids.',
      }),
    expectedClearingRate: bpsSchema,
  })
  .meta({
    id: 'FinaliseBody',
    description:
      'Approve-only finalisation request. The server recomputes the clearing rate over the ' +
      'selected bids and rejects on mismatch, so issuance cannot silently diverge from what the ' +
      'operator reviewed. Use the durable cancel transition instead of a local-only rejection.',
  });

export const auctionIdParamSchema = z
  .object({ auctionId: auctionIdSchema })
  .meta({ id: 'AuctionIdParam', description: 'Auction id path parameter' });

export type Auction = z.infer<typeof auctionSchema>;
export type AuctionType = z.infer<typeof auctionTypeSchema>;
export type AuctionStatus = z.infer<typeof auctionStatusSchema>;
export type BidState = z.infer<typeof bidStateSchema>;
export type Bid = z.infer<typeof bidSchema>;
export type SealedBid = z.infer<typeof sealedBidSchema>;
export type UnsealedBid = z.infer<typeof unsealedBidSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AllocationEntry = z.infer<typeof allocationEntrySchema>;
export type TxRef = z.infer<typeof txRefSchema>;
export type CreateAuctionBody = z.infer<typeof createAuctionBodySchema>;
export type CloseAuctionBody = z.infer<typeof closeAuctionBodySchema>;
export type FinaliseBody = z.infer<typeof finaliseBodySchema>;

const auctionIdPathParam = {
  in: 'path' as const,
  name: 'auctionId',
  required: true,
  schema: { $ref: '#/components/schemas/AuctionId' },
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

export const auctionPaths: ZodOpenApiPathsObject = {
  '/v1/auctions': {
    get: {
      tags: ['auctions'],
      operationId: 'listAuctions',
      summary: 'List all auctions across bonds (flat view of the full tree)',
      parameters: [testModeQueryParam],
      responses: {
        200: successJson('All auctions with bids and allocations', z.array(auctionSchema), true),
        ...errorRefs.read,
      },
    },
  },
  '/v1/auctions/{auctionId}': {
    get: {
      tags: ['auctions'],
      operationId: 'getAuction',
      summary: 'Get a single auction subtree',
      parameters: [auctionIdPathParam, testModeQueryParam],
      responses: {
        200: successJson('Auction resource', auctionSchema, true),
        ...errorRefs.read,
      },
    },
    patch: {
      tags: ['auctions'],
      operationId: 'closeAuction',
      summary: 'Transition auction to a new status. Only "closed" accepted today.',
      parameters: [auctionIdPathParam, testModeQueryParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: closeAuctionBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after the state transition', auctionSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
    delete: {
      tags: ['auctions'],
      operationId: 'cancelAuction',
      summary: 'Cancel auction (soft-delete; stays on-chain with status="cancelled")',
      parameters: [auctionIdPathParam],
      responses: {
        200: successJson('Cancelled auction (status="cancelled")', auctionSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/auctions/{auctionId}/finalisation': {
    put: {
      tags: ['auctions'],
      operationId: 'finaliseAuction',
      summary: 'Approve and submit the selected allocation',
      parameters: [auctionIdPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: finaliseBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after finalisation', auctionSchema, true),
        202: mutationAcceptedJson,
        ...errorRefs.mutate,
      },
    },
  },
};
