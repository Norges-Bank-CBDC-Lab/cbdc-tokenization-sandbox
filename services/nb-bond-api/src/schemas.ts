/**
 * OpenAPI v2 schemas for nb-bond-api.
 *
 * Single source of truth: every DTO and route is declared here.
 * `npm run regen:openapi` writes services/nb-bond-api/openapi.json from
 * this module. The runtime serves the same document at /v1/openapi.json
 * and /docs.
 *
 * Plan reference: docs/openapi-v2-plan.md.
 */
import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';

// #region Primitives ─────────────────────────────────────────────────

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .meta({
    id: 'Address',
    description: 'Ethereum address',
    examples: ['0x1234567890abcdef1234567890abcdef12345678'],
  });

const hexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/)
  .meta({
    id: 'HexString',
    description: 'Hex string',
    examples: ['0xabc123'],
  });

const bigIntStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'BigIntString',
    description: 'Decimal string representation of a uint256',
    examples: ['1000000000000000000'],
  });

const bpsSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'Bps',
    description: 'Basis points (1e4 precision). 425 = 4.25%, 9875 = 98.75%.',
    examples: ['425', '9875', '10123'],
  });

const isinSchema = z.string().min(1).meta({
  id: 'Isin',
  description: 'ISIN identifying a bond',
  examples: ['NO0012345678'],
});

const auctionIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .meta({
    id: 'AuctionId',
    description: 'Auction identifier (bytes32 hex)',
    examples: ['0x1234abcd'.padEnd(66, '0')],
  });

const md5Schema = z.string().meta({
  description:
    'MD5 of canonical (key-sorted) JSON of this DTO. Server-computed; clients compare as opaque strings for cache validation.',
  examples: ['9e107d9d372bb6826bd81d3542a419d6'],
});

const blockNumberSchema = z.number().int().nullable().meta({
  description: 'Block number, or null if not yet mined / unknown.',
});

const unixSecondsSchema = bigIntStringSchema.meta({
  description: 'Unix timestamp in seconds (decimal string).',
});

const unixMillisSchema = z.number().int().meta({
  description: 'Unix timestamp in milliseconds.',
});

// #endregion

// #region Enums ──────────────────────────────────────────────────────

const auctionTypeSchema = z.enum(['RATE', 'PRICE', 'BUYBACK']).meta({
  id: 'AuctionType',
  description: 'Auction pricing model',
});

const auctionStatusSchema = z
  .enum(['open', 'closed', 'finalised', 'rejected', 'cancelled'])
  .meta({
    id: 'AuctionStatus',
    description: 'Auction lifecycle status',
  });

const bondStatusSchema = z
  .enum(['minting', 'maturing', 'matured', 'redeemed', 'unknown'])
  .meta({
    id: 'BondStatus',
    description: 'Bond lifecycle status',
  });

export const bidStateSchema = z.enum(['sealed', 'unsealed']).meta({
  id: 'BidState',
  description: 'Bid disclosure state',
});

// #endregion

// #region Shared nested DTOs ─────────────────────────────────────────

const txRefSchema = z
  .object({
    hash: hexStringSchema,
    block: blockNumberSchema,
  })
  .meta({
    id: 'TxRef',
    description: 'Reference to an on-chain transaction',
  });

const allocationEntrySchema = z
  .object({
    bidder: addressSchema,
    units: bigIntStringSchema,
    rate: bpsSchema,
  })
  .meta({
    id: 'AllocationEntry',
    description: 'A single bidder share of a completed allocation',
  });

const allocationSchema = z
  .object({
    clearingRate: bpsSchema,
    totalAllocated: bigIntStringSchema,
    hash: hexStringSchema.meta({
      description: 'Hash committing to the allocation result; matches on-chain',
    }),
    auctionType: auctionTypeSchema,
    computedAt: unixMillisSchema,
    entries: z.array(allocationEntrySchema),
    md5: md5Schema,
  })
  .meta({
    id: 'Allocation',
    description: 'Computed allocation result for a closed auction',
  });

// #endregion

// #region Bid (discriminated union) ──────────────────────────────────

const sealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('sealed'),
    ciphertext: hexStringSchema,
    plaintextHash: hexStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'SealedBid',
    description: 'Bid in sealed (encrypted) state during an open auction',
  });

const unsealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('unsealed'),
    rate: bpsSchema,
    units: bigIntStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'UnsealedBid',
    description: 'Bid in unsealed (revealed) state after auction close',
  });

const bidSchema = z.discriminatedUnion('state', [sealedBidSchema, unsealedBidSchema]).meta({
  id: 'Bid',
  description: 'Bid; discriminated by `state` — sealed during open, unsealed after close',
});

// #endregion

// #region Auction ────────────────────────────────────────────────────

const auctionContractsSchema = z
  .object({
    auction: addressSchema,
    token: addressSchema,
  })
  .meta({
    id: 'AuctionContracts',
    description: 'On-chain contract addresses owning this auction',
  });

const auctionTxsSchema = z
  .object({
    create: txRefSchema,
    close: txRefSchema.nullable(),
    finalise: txRefSchema.nullable(),
    cancel: txRefSchema.nullable(),
  })
  .meta({
    id: 'AuctionTxs',
    description: 'Latest transaction per state-changing action on this auction',
  });

const auctionSchema = z
  .object({
    id: auctionIdSchema,
    isin: isinSchema,
    type: auctionTypeSchema,
    status: auctionStatusSchema,
    end: unixSecondsSchema.nullable().meta({
      description: 'Scheduled close timestamp',
    }),
    size: bigIntStringSchema.nullable().meta({
      description: 'Offering or buyback size in 1000-NOK units',
    }),
    maturityDuration: bigIntStringSchema.nullable().meta({
      description: 'Seconds from distribution until maturity (required for RATE auctions)',
    }),
    owner: addressSchema,
    sealingPubKey: hexStringSchema.meta({
      description: 'Public key used by bidders to encrypt sealed bids',
    }),
    contracts: auctionContractsSchema,
    bids: z.array(bidSchema),
    allocation: allocationSchema.nullable(),
    txs: auctionTxsSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'Auction',
    description: 'Auction resource with bids and allocation subtree',
  });

// #endregion

// #region Bond ───────────────────────────────────────────────────────

const bondContractsSchema = z
  .object({
    token: addressSchema.meta({ description: 'ERC20 bond token contract' }),
    auction: addressSchema.meta({ description: 'BondAuction contract' }),
    manager: addressSchema.meta({ description: 'BondManager contract' }),
  })
  .meta({
    id: 'BondContracts',
    description: 'On-chain contract addresses for this bond',
  });

const maturitySchema = z
  .object({
    duration: bigIntStringSchema.nullable().meta({
      description: 'Configured maturity duration in seconds',
    }),
    date: unixSecondsSchema.nullable().meta({
      description: 'Maturity date as unix timestamp',
    }),
    remaining: bigIntStringSchema.nullable().meta({
      description: 'Seconds until maturity; 0 once matured',
    }),
  })
  .meta({
    id: 'BondMaturity',
    description: 'Maturity configuration and remaining time',
  });

const couponPaymentsSchema = z
  .object({
    total: bigIntStringSchema.nullable(),
    made: bigIntStringSchema.nullable(),
    remaining: bigIntStringSchema.nullable(),
  })
  .meta({
    id: 'CouponPayments',
    description: 'Coupon payment progress',
  });

const couponSchema = z
  .object({
    duration: bigIntStringSchema.nullable().meta({
      description: 'Seconds between coupon payments',
    }),
    yieldBps: bpsSchema.nullable().meta({
      description: 'Annualised coupon yield in bps',
    }),
    payments: couponPaymentsSchema,
  })
  .meta({
    id: 'BondCoupon',
    description: 'Coupon configuration and payment progress',
  });

const holderBalanceSchema = z
  .object({
    holder: addressSchema,
    balance: bigIntStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'HolderBalance',
    description: 'A single bond holder and their balance',
  });

const bondSchema = z
  .object({
    isin: isinSchema,
    status: bondStatusSchema,
    totalSupply: bigIntStringSchema.nullable(),
    contracts: bondContractsSchema,
    maturity: maturitySchema.nullable(),
    coupon: couponSchema.nullable(),
    holders: z.array(holderBalanceSchema),
    auctions: z.array(auctionSchema),
    md5: md5Schema,
  })
  .meta({
    id: 'Bond',
    description:
      'Bond resource. Carries the full subtree of auctions, bids, allocations, and holders. ' +
      'A single GET /v1/bonds populates the entire UI cache.',
  });

// #endregion

// #region History ────────────────────────────────────────────────────

const historyEventSchema = z
  .object({
    isin: isinSchema,
    auctionId: auctionIdSchema.nullable().meta({
      description: 'Set for auction-scoped events; null for bond-level events',
    }),
    type: z.string().meta({
      description: 'Event name as emitted by the contracts (e.g. "BidSubmitted", "CouponPaid")',
    }),
    block: z.number().int(),
    txHash: hexStringSchema,
    payload: z.unknown().meta({
      description: 'Event-specific opaque payload; clients treat as untyped JSON',
    }),
  })
  .meta({
    id: 'HistoryEvent',
    description: 'Auction or bond event observed on-chain',
  });

// #endregion

// #region Health ─────────────────────────────────────────────────────

const healthContractsSchema = z
  .object({
    bondManager: addressSchema,
    bondAuction: addressSchema,
    bondToken: addressSchema,
  })
  .meta({
    id: 'HealthContracts',
    description: 'Contract addresses the service is bound to',
  });

const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    contracts: healthContractsSchema,
    sealingPubKey: hexStringSchema,
  })
  .meta({
    id: 'Health',
    description: 'Service health and binding information',
  });

// #endregion

// #region ProblemDetails (RFC 7807) ──────────────────────────────────

const problemFieldErrorSchema = z
  .object({
    field: z.string(),
    message: z.string(),
  })
  .meta({
    id: 'ProblemFieldError',
    description: 'Per-field validation error',
  });

const problemDetailsSchema = z
  .object({
    type: z
      .string()
      .meta({ description: 'URI reference categorising the error', examples: ['about:blank'] }),
    title: z.string().meta({ description: 'Short, human-readable summary' }),
    status: z.number().int().meta({ description: 'HTTP status code' }),
    detail: z.string().nullable().meta({ description: 'Human-readable explanation' }),
    instance: z.string().nullable().meta({ description: 'Path that produced the error' }),
    errors: z.array(problemFieldErrorSchema).nullable().meta({
      description: 'Populated for 400 validation failures; null otherwise',
    }),
  })
  .meta({
    id: 'ProblemDetails',
    description: 'RFC 7807 error body. Returned for every 4xx/5xx response.',
  });

// #endregion

// #region Request bodies ─────────────────────────────────────────────

const createAuctionBodySchema = z
  .object({
    type: auctionTypeSchema,
    end: unixSecondsSchema.meta({ description: 'Auction close timestamp (unix seconds)' }),
    size: bigIntStringSchema.meta({
      description: 'Offering or buyback size in 1000-NOK units',
    }),
    maturityDuration: bigIntStringSchema.nullable().meta({
      description: 'Seconds from distribution to maturity (required for RATE auctions)',
    }),
  })
  .meta({
    id: 'CreateAuctionBody',
    description: 'Request body for creating an auction under a bond',
  });

const closeAuctionBodySchema = z
  .object({
    status: z.literal('closed').meta({
      description: 'Target status. Only "closed" is accepted today; enum extensible later.',
    }),
  })
  .meta({
    id: 'CloseAuctionBody',
    description: 'PATCH body for the close transition',
  });

const finaliseBodySchema = z
  .object({
    allocationHash: hexStringSchema,
    approve: z.boolean().meta({
      description: 'true → finalised; false → rejected (allocation discarded)',
    }),
  })
  .meta({
    id: 'FinaliseBody',
    description: 'PUT body for approving or rejecting a computed allocation',
  });

const holdersBodySchema = z
  .object({
    holders: z.array(addressSchema).nullable().meta({
      description: 'Optional subset of holders to pay/redeem. null = all holders.',
    }),
  })
  .meta({
    id: 'HoldersBody',
    description: 'Body for coupon-payment and redemption operations',
  });

// #endregion

// #region Path / query parameters ────────────────────────────────────

const isinParamSchema = z
  .object({ isin: isinSchema })
  .meta({ id: 'IsinParam', description: 'ISIN path parameter' });

const auctionIdParamSchema = z
  .object({ auctionId: auctionIdSchema })
  .meta({ id: 'AuctionIdParam', description: 'Auction id path parameter' });

const historyQuerySchema = z
  .object({
    before: z.coerce.number().int().nonnegative().nullable().meta({
      description: 'Return events with block < this value; null/unset = latest',
    }),
    limit: z.coerce.number().int().positive().max(500).nullable().meta({
      description: 'Maximum events to return; default 100, max 500',
    }),
  })
  .meta({ id: 'HistoryQuery' });

// #endregion

// #region OpenAPI document ───────────────────────────────────────────

const etagHeader = {
  ETag: {
    description: 'MD5 of the response body. Reuse via If-None-Match for cache revalidation.',
    schema: { type: 'string' as const },
  },
};

const successJson = (description: string, schema: z.ZodTypeAny) => ({
  description,
  headers: etagHeader,
  content: { 'application/json': { schema } },
});

const notModified = {
  description: 'Not Modified — If-None-Match matched current ETag; cached body still valid.',
};

const errorRefs = {
  read: {
    304: notModified,
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    404: { $ref: '#/components/responses/NotFound' },
    500: { $ref: '#/components/responses/InternalError' },
  },
  mutate: {
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    404: { $ref: '#/components/responses/NotFound' },
    409: { $ref: '#/components/responses/Conflict' },
    500: { $ref: '#/components/responses/InternalError' },
  },
};

const isinPathParam = {
  in: 'path' as const,
  name: 'isin',
  required: true,
  schema: { $ref: '#/components/schemas/Isin' },
};

const auctionIdPathParam = {
  in: 'path' as const,
  name: 'auctionId',
  required: true,
  schema: { $ref: '#/components/schemas/AuctionId' },
};

const paths: ZodOpenApiPathsObject = {
  // system ─────────────────────────────────────────
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

  // bonds ──────────────────────────────────────────
  '/v1/bonds': {
    get: {
      tags: ['bonds'],
      operationId: 'listBonds',
      summary: 'List all bonds with full subtree (auctions, bids, allocations, holders)',
      responses: {
        200: successJson(
          'All bonds. Primary cache-priming call for the UI.',
          z.array(bondSchema),
        ),
        ...errorRefs.read,
      },
    },
  },
  '/v1/bonds/{isin}': {
    get: {
      tags: ['bonds'],
      operationId: 'getBond',
      summary: 'Get a single bond with full subtree',
      parameters: [isinPathParam],
      responses: {
        200: successJson('Bond resource', bondSchema),
        ...errorRefs.read,
      },
    },
  },
  '/v1/bonds/{isin}/coupon-payments': {
    post: {
      tags: ['bonds'],
      operationId: 'payCoupon',
      summary: 'Pay coupon to bond holders',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: holdersBodySchema } },
      },
      responses: {
        200: successJson('Updated bond after submitting the coupon-payment tx', bondSchema),
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
        200: successJson('Updated bond after submitting the redemption tx', bondSchema),
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
        200: successJson('Updated bond with the new auction appended', bondSchema),
        ...errorRefs.mutate,
      },
    },
  },

  // auctions ───────────────────────────────────────
  '/v1/auctions': {
    get: {
      tags: ['auctions'],
      operationId: 'listAuctions',
      summary: 'List all auctions across bonds (flat view of the full tree)',
      responses: {
        200: successJson('All auctions with bids and allocations', z.array(auctionSchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/auctions/{auctionId}': {
    get: {
      tags: ['auctions'],
      operationId: 'getAuction',
      summary: 'Get a single auction subtree',
      parameters: [auctionIdPathParam],
      responses: {
        200: successJson('Auction resource', auctionSchema),
        ...errorRefs.read,
      },
    },
    patch: {
      tags: ['auctions'],
      operationId: 'closeAuction',
      summary: 'Transition auction to a new status. Only "closed" accepted today.',
      parameters: [auctionIdPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: closeAuctionBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after the state transition', auctionSchema),
        ...errorRefs.mutate,
      },
    },
    delete: {
      tags: ['auctions'],
      operationId: 'cancelAuction',
      summary: 'Cancel auction (soft-delete; stays on-chain with status="cancelled")',
      parameters: [auctionIdPathParam],
      responses: {
        200: successJson('Cancelled auction (status="cancelled")', auctionSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/auctions/{auctionId}/finalisation': {
    put: {
      tags: ['auctions'],
      operationId: 'finaliseAuction',
      summary: 'Approve or reject the computed allocation',
      parameters: [auctionIdPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: finaliseBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after finalisation', auctionSchema),
        ...errorRefs.mutate,
      },
    },
  },
};

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'NB Bond Auction Service',
    version: '2.0.0',
    description:
      'Public API for the CBDC tokenization sandbox bond service. ' +
      'Sandbox-scale demo backing the nb-ui reference frontend. ' +
      'See docs/openapi-v2-plan.md for design notes.',
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  servers: [
    {
      url: 'http://bond-api.cbdc-sandbox.local',
      description: 'Local Kind sandbox',
    },
  ],
  tags: [
    { name: 'system', description: 'Service health' },
    { name: 'bonds', description: 'Bond resources (root of the resource tree)' },
    { name: 'auctions', description: 'Auction resources (bid/allocation subtree of a bond)' },
  ],
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Microsoft Entra ID access token. In deployments where NB_BOND_API_AUTH_MODE=none ' +
          '(local sandbox default), the header is accepted but not validated.',
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation failed; `errors[]` populated.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Unauthorized: {
        description: 'Authentication required or token invalid.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      NotFound: {
        description: 'Resource does not exist.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Conflict: {
        description: 'Operation conflicts with current resource state.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      InternalError: {
        description: 'Unexpected server error.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
    },
  },
});

// #endregion

// #region Internal-only schemas (not part of the OpenAPI surface) ────

// Decrypted bid plaintext; validated server-side after bid unsealing.
// Not exposed in any response — auctioneer-internal only.
export const bidPlaintextSchema = z.object({
  isin: z.string(),
  bidder: addressSchema,
  nonce: z.string(),
  rate: bpsSchema,
  units: bigIntStringSchema,
  salt: z.string(),
  bidderNonce: bigIntStringSchema,
  bidderSig: hexStringSchema,
});

// #endregion

// #region Re-exports (used by handlers & tests) ──────────────────────

export {
  closeAuctionBodySchema,
  createAuctionBodySchema,
  finaliseBodySchema,
  holdersBodySchema,
  isinParamSchema,
  auctionIdParamSchema,
  historyQuerySchema,
};

export type Address = z.infer<typeof addressSchema>;
export type HexString = z.infer<typeof hexStringSchema>;
export type BigIntString = z.infer<typeof bigIntStringSchema>;
export type Bps = z.infer<typeof bpsSchema>;
export type Isin = z.infer<typeof isinSchema>;
export type AuctionId = z.infer<typeof auctionIdSchema>;

export type AuctionType = z.infer<typeof auctionTypeSchema>;
export type AuctionStatus = z.infer<typeof auctionStatusSchema>;
export type BondStatus = z.infer<typeof bondStatusSchema>;
export type BidState = z.infer<typeof bidStateSchema>;

export type Bond = z.infer<typeof bondSchema>;
export type Auction = z.infer<typeof auctionSchema>;
export type Bid = z.infer<typeof bidSchema>;
export type SealedBid = z.infer<typeof sealedBidSchema>;
export type UnsealedBid = z.infer<typeof unsealedBidSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AllocationEntry = z.infer<typeof allocationEntrySchema>;
export type HolderBalance = z.infer<typeof holderBalanceSchema>;
export type HistoryEvent = z.infer<typeof historyEventSchema>;
export type Health = z.infer<typeof healthSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type TxRef = z.infer<typeof txRefSchema>;

export type CreateAuctionBody = z.infer<typeof createAuctionBodySchema>;
export type CloseAuctionBody = z.infer<typeof closeAuctionBodySchema>;
export type FinaliseBody = z.infer<typeof finaliseBodySchema>;
export type HoldersBody = z.infer<typeof holdersBodySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// #endregion
