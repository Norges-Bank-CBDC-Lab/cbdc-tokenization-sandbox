import { z } from 'zod';

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .meta({
    id: 'Address',
    description: 'Ethereum address',
    examples: ['0x1234567890abcdef1234567890abcdef12345678'],
  });

export const hexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/)
  .meta({
    id: 'HexString',
    description: 'Hex string',
    examples: ['0xabc123'],
  });

export const bigIntStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'BigIntString',
    description: 'Decimal string representation of a uint256',
    examples: ['1000000000000000000'],
  });

export const bpsSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'Bps',
    description: 'Basis points (1e4 precision). 425 = 4.25%, 9875 = 98.75%.',
    examples: ['425', '9875', '10123'],
  });

export const isinSchema = z
  .string()
  .min(1)
  .meta({
    id: 'Isin',
    description: 'ISIN identifying a bond',
    examples: ['NO0012345678'],
  });

export const auctionIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .meta({
    id: 'AuctionId',
    description: 'Auction identifier (bytes32 hex)',
    examples: ['0x1234abcd'.padEnd(66, '0')],
  });

export const md5Schema = z.string().meta({
  description:
    'MD5 of canonical (key-sorted) JSON of this DTO. Server-computed; clients compare as opaque strings for cache validation.',
  examples: ['9e107d9d372bb6826bd81d3542a419d6'],
});

export const blockNumberSchema = z.number().int().nullable().meta({
  description: 'Block number, or null if not yet mined / unknown.',
});

export const unixSecondsSchema = bigIntStringSchema.meta({
  description: 'Unix timestamp in seconds (decimal string).',
});

export const unixMillisSchema = z.number().int().meta({
  description: 'Unix timestamp in milliseconds.',
});
