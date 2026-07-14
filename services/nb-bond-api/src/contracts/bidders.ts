import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { sealedBidSchema } from './auctions';
import {
  addressSchema,
  auctionIdSchema,
  bigIntStringSchema,
  bpsSchema,
  hexStringSchema,
  md5Schema,
  unixMillisSchema,
} from './common';
import { errorRefs, noContent204, successJson } from '../openapi/shared-responses';

export const bidderSchema = z
  .object({
    address: addressSchema,
    name: z.string().meta({ description: 'Human-readable bidder label, unique per sandbox' }),
    publicKey: hexStringSchema.meta({
      description: 'Compressed secp256k1 public key (33-byte hex)',
    }),
    privateKey: hexStringSchema.meta({
      description:
        'Private key, hex (0x + 64 chars). Returned in plaintext because this surface is sandbox-only.',
    }),
    ethBalance: bigIntStringSchema.meta({ description: 'Current ETH balance in wei' }),
    wnokBalance: bigIntStringSchema.meta({
      description: 'Current WNOK balance in 1-NOK units. "0" until WNOK is reachable.',
    }),
    createdAt: unixMillisSchema.meta({ description: 'Creation timestamp (unix milliseconds)' }),
    md5: md5Schema,
  })
  .meta({
    id: 'Bidder',
    description:
      'Sandbox bidder roster entry. The same private key signs transactions, ' +
      'signs EIP-712 bid intents, and acts as the bidder pubkey for the dual-wrap encryption.',
  });

export const createBidderBodySchema = z
  .object({
    name: z.string().min(1).max(64).meta({ description: 'Human-readable bidder label' }),
    privateKey: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional()
      .meta({
        description: 'Optional import of an existing 32-byte hex key. Generated if omitted.',
      }),
  })
  .meta({
    id: 'CreateBidderBody',
    description: 'Request body for creating a bidder',
  });

export const submitBidBodySchema = z
  .object({
    auctionId: auctionIdSchema,
    units: bigIntStringSchema.meta({
      description: 'Bid size in 1000-NOK units',
    }),
    rate: bpsSchema.meta({
      description:
        'Bid rate (bps). Interpretation depends on auction type — yield for RATE, price-per-100 for PRICE/BUYBACK.',
    }),
  })
  .meta({
    id: 'SubmitBidBody',
    description:
      'Request body for impersonated bid submission. The server builds the plaintext, signs the ' +
      'EIP-712 BidIntent with the stored bidder key, dual-wraps with the auctioneer sealing key, ' +
      'and calls BondAuction.submitBid from the bidder’s wallet.',
  });

export const bidderAddressParamSchema = z
  .object({ address: addressSchema })
  .meta({ id: 'BidderAddressParam', description: 'Bidder address path parameter' });

const bidderAddressPathParam = {
  in: 'path' as const,
  name: 'address',
  required: true,
  schema: { $ref: '#/components/schemas/Address' },
};

export const bidderPaths: ZodOpenApiPathsObject = {
  '/v1/bidders': {
    get: {
      tags: ['bidders'],
      operationId: 'listBidders',
      summary: 'List the sandbox bidder roster',
      responses: {
        200: successJson('All bidders in the roster', z.array(bidderSchema)),
        ...errorRefs.read,
      },
    },
    post: {
      tags: ['bidders'],
      operationId: 'createBidder',
      summary: 'Create a bidder (generates a fresh keypair when privateKey is omitted)',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createBidderBodySchema } },
      },
      responses: {
        200: successJson('Newly created bidder', bidderSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bidders/{address}': {
    delete: {
      tags: ['bidders'],
      operationId: 'deleteBidder',
      summary:
        'Delete a bidder. Hard-blocked while the bidder has unrevealed bids on an open auction.',
      parameters: [bidderAddressPathParam],
      responses: {
        204: noContent204,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bidders/{address}/bids': {
    post: {
      tags: ['bidders'],
      operationId: 'submitBidderBid',
      summary: 'Submit a sealed bid on behalf of a roster bidder',
      parameters: [bidderAddressPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: submitBidBodySchema } },
      },
      responses: {
        200: successJson('Sealed bid as accepted on-chain', sealedBidSchema),
        ...errorRefs.mutate,
      },
    },
  },
};

export type Bidder = z.infer<typeof bidderSchema>;
export type CreateBidderBody = z.infer<typeof createBidderBodySchema>;
export type SubmitBidBody = z.infer<typeof submitBidBodySchema>;
