import { decryptBid } from './encryption';
import { getSealingKeypair } from './keys';
import { SealedBid, UnsealedBid } from './types';
import { bidPlaintextSchema } from './schemas';

export function normalizeSealedBid(
  bid: Pick<SealedBid, 'bidder' | 'ciphertext' | 'plaintextHash'>,
): SealedBid {
  return {
    bidder: bid.bidder,
    ciphertext: bid.ciphertext,
    plaintextHash: bid.plaintextHash,
  };
}

export function unsealBid(isin: string, bid: SealedBid, index?: number): UnsealedBid {
  const { plaintext, plaintextHash, ciphertextHash, usedWrap } = decryptBid(
    bid.ciphertext,
    getSealingKeypair().privateKey,
    'auctioneer',
  );
  const parsedPlaintext = bidPlaintextSchema.safeParse(plaintext);
  if (!parsedPlaintext.success) {
    throw new Error(`invalid bid plaintext for ${bid.bidder}: ${parsedPlaintext.error.message}`);
  }

  const validatedPlaintext = parsedPlaintext.data;
  if (plaintextHash.toLowerCase() !== bid.plaintextHash.toLowerCase()) {
    throw new Error(`plaintextHash mismatch for bid ${bid.bidder}`);
  }
  if (validatedPlaintext.isin !== isin) {
    throw new Error(`bid ISIN mismatch. expected ${isin}, got ${validatedPlaintext.isin}`);
  }
  if (validatedPlaintext.bidder.toLowerCase() !== bid.bidder.toLowerCase()) {
    throw new Error(`bidder mismatch for bid ${bid.bidder}`);
  }
  if (!validatedPlaintext.bidderSig) {
    throw new Error(`missing bidderSig for bid ${bid.bidder}`);
  }
  return {
    bidder: bid.bidder,
    ciphertext: bid.ciphertext,
    plaintextHash: plaintextHash,
    plaintext: validatedPlaintext,
    ciphertextHash,
    bidIndex: index ?? 0,
    usedWrap,
  };
}

export function formatUnsealedBid(bid: UnsealedBid) {
  return {
    bidder: bid.bidder,
    rate: bid.plaintext.rate,
    units: bid.plaintext.units,
  };
}
