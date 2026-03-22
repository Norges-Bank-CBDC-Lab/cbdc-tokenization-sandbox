import { createDocument } from 'zod-openapi';
import { z } from 'zod';

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .meta({
    description: 'Ethereum address',
    examples: ['0x1234567890abcdef1234567890abcdef12345678'],
    id: 'Address',
  });

const hexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/)
  .meta({
    description: 'Hex string',
    examples: ['0xabc123'],
    id: 'HexString',
  });

const auctionIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .meta({
    description: 'Auction identifier (bytes32 hex)',
    examples: ['0x1234abcd'.padEnd(66, '0')],
    id: 'AuctionId',
  });

const bigIntStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    description: 'Decimal string representation of a uint256',
    examples: ['1000000000000000000'],
    id: 'BigIntString',
  });

const bpsStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    description: 'Percentage in bps (1e4 precision, e.g., 425 = 4.25%, 9875 = 98.75%)',
    examples: ['425', '9875', '10123'],
    id: 'BpsString',
  });

const isinSchema = z
  .string()
  .min(1)
  .meta({
    description: 'ISIN for the bond auction',
    examples: ['NO0012345678'],
    id: 'Isin',
  });

const auctionTypeSchema = z
  .enum(['RATE', 'PRICE', 'BUYBACK'])
  .meta({ description: 'Auction type', examples: ['RATE', 'PRICE', 'BUYBACK'], id: 'AuctionType' });

const auctionStatusSchema = z.enum(['open', 'closed', 'finalised', 'rejected', 'cancelled']).meta({
  description: 'Auction lifecycle status',
  examples: ['open', 'closed', 'finalised'],
  id: 'AuctionStatus',
});

const addressArraySchema = z
  .array(addressSchema)
  .nonempty()
  .refine((arr) => new Set(arr.map((a) => a.toLowerCase())).size === arr.length, {
    message: 'holders must be unique',
  });

const sealedBidSchema = z
  .object({
    bidder: addressSchema,
    ciphertext: hexStringSchema,
    plaintextHash: hexStringSchema,
  })
  .meta({ description: 'Sealed bid', id: 'SealedBid' });

const unsealedBidSchema = z
  .object({
    bidder: addressSchema,
    rate: bpsStringSchema,
    units: bigIntStringSchema,
  })
  .meta({ description: 'Unsealed bid', id: 'UnsealedBid' });

const allocationSchema = z
  .object({
    bidder: addressSchema,
    units: bigIntStringSchema,
    rate: bpsStringSchema,
    auctionType: auctionTypeSchema.optional(),
  })
  .meta({ description: 'Allocation entry', id: 'Allocation' });

export const bidPlaintextSchema = z
  .object({
    isin: z.string(),
    bidder: addressSchema,
    nonce: z.string(),
    rate: bpsStringSchema,
    units: bigIntStringSchema,
    salt: z.string(),
    bidderNonce: bigIntStringSchema,
    bidderSig: hexStringSchema,
  })
  .meta({ description: 'Bid plaintext payload', id: 'BidPlaintext' });

const allocationResultSchema = z
  .object({
    clearingRate: bpsStringSchema,
    totalAllocated: bigIntStringSchema,
    allocationHash: hexStringSchema,
    auctionType: auctionTypeSchema,
    computedAt: z.number().meta({ description: 'Milliseconds since epoch' }),
    allocations: z.array(allocationSchema),
  })
  .meta({ description: 'Computed allocation result', id: 'AllocationResult' });

export const createAuctionRequestSchema = z
  .object({
    type: auctionTypeSchema,
    end: z.union([z.number().int().positive(), bigIntStringSchema]).meta({
      description: 'Auction end timestamp (unix seconds)',
    }),
    size: z.union([z.number().int().positive(), bigIntStringSchema]).meta({
      description: 'Offering or buyback size in whole 1,000 NOK units',
    }),
    maturityDuration: z.union([z.number().int().positive(), bigIntStringSchema]).optional().meta({
      description: 'Seconds from distribution until maturity (required for RATE)',
    }),
  })
  .meta({ description: 'Create auction request', id: 'CreateAuctionRequest' });

export const payCouponRequestSchema = z
  .object({
    holders: addressArraySchema.optional(),
  })
  .meta({ description: 'Pay coupon request', id: 'PayCouponRequest' });

export const redeemRequestSchema = z
  .object({
    holders: addressArraySchema.optional(),
  })
  .meta({ description: 'Redeem request', id: 'RedeemRequest' });

export const createAuctionResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    type: auctionTypeSchema,
    status: auctionStatusSchema,
    end: bigIntStringSchema,
    size: bigIntStringSchema,
    maturityDuration: bigIntStringSchema.nullable(),
    auctionPubKey: hexStringSchema,
    bondAuction: addressSchema,
    bondToken: addressSchema,
    txHash: hexStringSchema,
    blockNumber: z.number().nullable(),
  })
  .meta({ description: 'Create auction response', id: 'CreateAuctionResponse' });

const auctionSummarySchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    type: auctionTypeSchema.optional(),
    status: auctionStatusSchema.optional(),
    end: bigIntStringSchema.nullable(),
    size: bigIntStringSchema.nullable(),
    allocationHash: hexStringSchema.nullable(),
    finalised: z.boolean().optional(),
    rejected: z.boolean().optional(),
    cancelled: z.boolean().optional(),
  })
  .meta({ description: 'Auction summary', id: 'AuctionSummary' });

const auctionMetadataSchema = z
  .object({
    owner: addressSchema,
    end: bigIntStringSchema.nullable(),
    auctionPubKey: hexStringSchema,
    bond: addressSchema,
    offering: bigIntStringSchema.nullable(),
    auctionType: auctionTypeSchema,
  })
  .meta({ description: 'On-chain auction metadata', id: 'AuctionMetadata' });

const auctionCachedSchema = z
  .object({
    sealedCount: z.number(),
    unsealedCount: z.number(),
    allocationHash: hexStringSchema.nullable(),
    finalised: z.boolean(),
    rejected: z.boolean(),
    cancelled: z.boolean().optional(),
    auctionType: auctionTypeSchema.optional(),
  })
  .meta({ description: 'Cached auction info', id: 'AuctionCached' });

const onChainAllocationSchema = z
  .object({
    isin: isinSchema,
    bidder: addressSchema,
    units: bigIntStringSchema.nullable(),
    rate: bpsStringSchema.nullable(),
    auctionType: auctionTypeSchema.optional(),
  })
  .meta({ description: 'On-chain allocation tuple', id: 'OnChainAllocation' });

export const listAuctionsResponseSchema = z
  .object({
    auctions: z.array(auctionSummarySchema),
  })
  .meta({ description: 'List auctions for an ISIN', id: 'ListAuctionsResponse' });

export const auctionStatusResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    status: auctionStatusSchema,
    metadata: auctionMetadataSchema,
    cached: auctionCachedSchema.nullable(),
    allocations: z.array(onChainAllocationSchema),
  })
  .meta({ description: 'Auction status response', id: 'AuctionStatusResponse' });

export const closeResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    status: auctionStatusSchema,
    txHash: hexStringSchema,
    blockNumber: z.number().nullable(),
    bidCount: z.number(),
    bids: z.array(unsealedBidSchema),
    allocation: allocationResultSchema,
    auctionType: auctionTypeSchema,
  })
  .meta({ description: 'Close auction response', id: 'CloseResponse' });

export const bidsResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    state: z.enum(['sealed', 'unsealed']),
    bidCount: z.number(),
    bids: z.array(z.union([unsealedBidSchema, sealedBidSchema])),
    allocation: allocationResultSchema.nullable(),
    auctionType: auctionTypeSchema,
  })
  .meta({ description: 'Bids response', id: 'BidsResponse' });

export const allocationsResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    allocation: allocationResultSchema,
    status: auctionStatusSchema,
    auctionType: auctionTypeSchema,
    finalised: z.boolean(),
    rejected: z.boolean(),
    cancelled: z.boolean().optional(),
  })
  .meta({ description: 'Allocation result response', id: 'AllocationsResponse' });

export const finaliseRequestSchema = z
  .object({
    allocationHash: hexStringSchema,
    approve: z.boolean(),
  })
  .meta({ description: 'Approve or reject allocation', id: 'FinaliseRequest' });

export const finaliseResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    status: z.enum(['finalised', 'rejected']),
    allocationHash: hexStringSchema.optional(),
    txHash: hexStringSchema.optional(),
    blockNumber: z.number().nullable().optional(),
    allocation: allocationResultSchema.optional(),
  })
  .meta({ description: 'Finalise auction response', id: 'FinaliseResponse' });

export const cancelResponseSchema = z
  .object({
    auctionId: auctionIdSchema,
    isin: isinSchema,
    status: auctionStatusSchema,
    txHash: hexStringSchema,
    blockNumber: z.number().nullable(),
  })
  .meta({ description: 'Cancel auction response', id: 'CancelResponse' });

export const payCouponResponseSchema = z
  .object({
    isin: isinSchema,
    txHash: hexStringSchema,
    blockNumber: z.number().nullable(),
    status: z.literal('submitted'),
    holderCount: z.number(),
  })
  .meta({ description: 'Pay coupon response', id: 'PayCouponResponse' });

export const redeemResponseSchema = z
  .object({
    isin: isinSchema,
    txHash: hexStringSchema,
    blockNumber: z.number().nullable(),
    status: z.literal('submitted'),
    holderCount: z.number(),
  })
  .meta({ description: 'Redeem response', id: 'RedeemResponse' });

const auctionHistoryEventSchema = z
  .object({
    auctionId: auctionIdSchema.optional(),
    isin: isinSchema,
    type: z.string(),
    block: z.number(),
    txHash: hexStringSchema,
    payload: z.any(),
  })
  .meta({ description: 'Auction event history row', id: 'AuctionHistoryEvent' });

export const auctionHistoryResponseSchema = z
  .object({
    isin: isinSchema,
    events: z.array(auctionHistoryEventSchema),
    bondEvents: z
      .array(
        z.object({
          isin: isinSchema,
          type: z.string(),
          block: z.number(),
          txHash: hexStringSchema,
          payload: z.any(),
        }),
      )
      .optional(),
  })
  .meta({ description: 'Auction history response', id: 'AuctionHistoryResponse' });

const holderBalanceSchema = z
  .object({
    isin: isinSchema,
    holder: addressSchema,
    balance: bigIntStringSchema,
  })
  .meta({ description: 'Holder balance', id: 'HolderBalance' });

export const holdersResponseSchema = z
  .object({
    isin: isinSchema,
    holders: z.array(holderBalanceSchema),
  })
  .meta({ description: 'Holders response', id: 'HoldersResponse' });

export const bondSummaryResponseSchema = z
  .object({
    isin: isinSchema,
    maturityDuration: bigIntStringSchema.nullable(),
    maturityDate: bigIntStringSchema.nullable(),
    timeToMaturity: bigIntStringSchema.nullable(),
    couponDuration: bigIntStringSchema.nullable(),
    couponYield: bigIntStringSchema.nullable(),
    couponPaymentsTotal: bigIntStringSchema.nullable(),
    couponPaymentsMade: bigIntStringSchema.nullable(),
    couponPaymentsRemaining: bigIntStringSchema.nullable(),
    status: z.enum(['minting', 'maturing', 'matured', 'redeemed', 'unknown']),
    totalSupply: bigIntStringSchema.nullable(),
  })
  .meta({ description: 'Bond summary', id: 'BondSummaryResponse' });

export const healthResponseSchema = z
  .object({
    status: z.string(),
    bondManager: addressSchema,
    bondAuction: addressSchema,
    bondToken: addressSchema,
    sealingPublicKey: hexStringSchema,
  })
  .meta({ description: 'Health response', id: 'HealthResponse' });

export const isinParamSchema = z.object({ isin: isinSchema }).meta({ id: 'IsinParam' });
export const auctionIdParamSchema = z
  .object({ auctionId: auctionIdSchema })
  .meta({ id: 'AuctionIdParam' });

export const bidsQuerySchema = z
  .object({
    state: z.enum(['sealed', 'unsealed']).optional(),
  })
  .meta({ id: 'BidsQuery' });

export const auctionsQuerySchema = z
  .object({
    status: auctionStatusSchema.optional(),
    type: auctionTypeSchema.optional(),
  })
  .meta({ id: 'AuctionsQuery' });

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'NB Bond Auction Service',
    version: '1.0.0',
  },
  paths: {
    '/v1/health': {
      get: {
        responses: {
          200: {
            description: 'Health information',
            content: {
              'application/json': {
                schema: healthResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/bonds/{isin}/auctions': {
      post: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: createAuctionRequestSchema,
            },
          },
        },
        responses: {
          200: {
            description: 'Auction created',
            content: {
              'application/json': {
                schema: createAuctionResponseSchema,
              },
            },
          },
          400: { description: 'Bad request' },
        },
      },
      get: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        responses: {
          200: {
            description: 'Auctions for ISIN',
            content: {
              'application/json': {
                schema: listAuctionsResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/auctions/{auctionId}': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        responses: {
          200: {
            description: 'Auction status',
            content: {
              'application/json': {
                schema: auctionStatusResponseSchema,
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },
    '/v1/auctions/{auctionId}/close': {
      post: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        responses: {
          200: {
            description: 'Close auction',
            content: {
              'application/json': {
                schema: closeResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/auctions/{auctionId}/bids': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        responses: {
          200: {
            description: 'Bids',
            content: {
              'application/json': {
                schema: bidsResponseSchema,
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },
    '/v1/auctions/{auctionId}/allocations': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        responses: {
          200: {
            description: 'Allocation result',
            content: {
              'application/json': {
                schema: allocationsResponseSchema,
              },
            },
          },
          404: { description: 'Not found' },
        },
      },
    },
    '/v1/auctions/{auctionId}/finalisation': {
      put: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: finaliseRequestSchema,
            },
          },
        },
        responses: {
          200: {
            description: 'Finalise auction',
            content: {
              'application/json': {
                schema: finaliseResponseSchema,
              },
            },
          },
          409: { description: 'Conflict' },
          400: { description: 'Bad request' },
        },
      },
    },
    '/v1/auctions/{auctionId}/cancel': {
      post: {
        parameters: [
          {
            in: 'path',
            name: 'auctionId',
            required: true,
            schema: { $ref: '#/components/schemas/AuctionId' },
          },
        ],
        responses: {
          200: {
            description: 'Cancel auction',
            content: {
              'application/json': {
                schema: cancelResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/bonds/{isin}/coupon-payments': {
      post: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: payCouponRequestSchema,
            },
          },
        },
        responses: {
          200: {
            description: 'Coupon payment submitted',
            content: {
              'application/json': {
                schema: payCouponResponseSchema,
              },
            },
          },
          400: { description: 'Bad request' },
        },
      },
    },
    '/v1/bonds/{isin}/redemptions': {
      post: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: redeemRequestSchema,
            },
          },
        },
        responses: {
          200: {
            description: 'Redemption submitted',
            content: {
              'application/json': {
                schema: redeemResponseSchema,
              },
            },
          },
          400: { description: 'Bad request' },
        },
      },
    },
    '/v1/bonds/{isin}/history': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        responses: {
          200: {
            description: 'Auction history',
            content: {
              'application/json': {
                schema: auctionHistoryResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/bonds/{isin}/holders': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        responses: {
          200: {
            description: 'Holders for ISIN',
            content: {
              'application/json': {
                schema: holdersResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/bonds/{isin}': {
      get: {
        parameters: [
          {
            in: 'path',
            name: 'isin',
            required: true,
            schema: { $ref: '#/components/schemas/Isin' },
          },
        ],
        responses: {
          200: {
            description: 'Bond summary',
            content: {
              'application/json': {
                schema: bondSummaryResponseSchema,
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Address: addressSchema,
      HexString: hexStringSchema,
      AuctionId: auctionIdSchema,
      BigIntString: bigIntStringSchema,
      BpsString: bpsStringSchema,
      Isin: isinSchema,
      AuctionStatus: auctionStatusSchema,
      SealedBid: sealedBidSchema,
      UnsealedBid: unsealedBidSchema,
      Allocation: allocationSchema,
      AllocationResult: allocationResultSchema,
      BidPlaintext: bidPlaintextSchema,
      CreateAuctionRequest: createAuctionRequestSchema,
      CreateAuctionResponse: createAuctionResponseSchema,
      ListAuctionsResponse: listAuctionsResponseSchema,
      CloseResponse: closeResponseSchema,
      BidsResponse: bidsResponseSchema,
      AllocationsResponse: allocationsResponseSchema,
      AuctionMetadata: auctionMetadataSchema,
      AuctionCached: auctionCachedSchema,
      OnChainAllocation: onChainAllocationSchema,
      AuctionStatusResponse: auctionStatusResponseSchema,
      FinaliseRequest: finaliseRequestSchema,
      FinaliseResponse: finaliseResponseSchema,
      CancelResponse: cancelResponseSchema,
      PayCouponRequest: payCouponRequestSchema,
      PayCouponResponse: payCouponResponseSchema,
      RedeemRequest: redeemRequestSchema,
      RedeemResponse: redeemResponseSchema,
      AuctionHistoryResponse: auctionHistoryResponseSchema,
      AuctionHistoryEvent: auctionHistoryEventSchema,
      HoldersResponse: holdersResponseSchema,
      HolderBalance: holderBalanceSchema,
      BondSummaryResponse: bondSummaryResponseSchema,
      HealthResponse: healthResponseSchema,
      IsinParam: isinParamSchema,
      AuctionIdParam: auctionIdParamSchema,
      AuctionType: auctionTypeSchema,
    },
  },
});

export type CreateAuctionRequest = z.infer<typeof createAuctionRequestSchema>;
export type FinaliseRequest = z.infer<typeof finaliseRequestSchema>;
export type BidsQuery = z.infer<typeof bidsQuerySchema>;
export type AuctionsQuery = z.infer<typeof auctionsQuerySchema>;
export type PayCouponRequest = z.infer<typeof payCouponRequestSchema>;
export type RedeemRequest = z.infer<typeof redeemRequestSchema>;
