import { z } from 'zod';

import { addressSchema, bigIntStringSchema, bpsSchema, hexStringSchema } from './common';

/** Auctioneer-internal decrypted payload; never exposed by the HTTP API. */
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
