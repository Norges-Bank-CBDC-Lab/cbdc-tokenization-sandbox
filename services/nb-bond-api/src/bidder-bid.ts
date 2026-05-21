/**
 * Impersonated bid submission.
 *
 * The API holds the bidder's private key (sandbox-only — see the
 * banner everywhere this module is used) and signs the EIP-712 bid
 * intent on their behalf, dual-wraps the plaintext, and submits the
 * sealed bid to BondAuction from a wallet bound to the bidder's
 * private key.
 *
 * The signing payload mirrors the off-chain reference flow in
 * `scripts/bid-encryption/`: the typed-data structure, domain, and
 * plaintext shape are kept exactly aligned so the contract's
 * `_verifyBidIntent` recovers the same bidder during finalisation.
 */
import { randomBytes } from 'node:crypto';
import {
  Contract,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  type Interface,
  type TypedDataDomain,
  Wallet,
  getAddress,
} from 'ethers';

import type { BidderRecord } from './bidders';
import { bondAuctionAbi } from './abi';
import { provider, getBondAuction, getBondAuctionAddress } from './chain';
import { type BidPlaintext, encryptBid, hashBidPlaintext } from './encryption';
import { getSealingKeypair } from './keys';

const BID_INTENT_TYPES = {
  BidIntent: [
    { name: 'bidder', type: 'address' },
    { name: 'auctionId', type: 'bytes32' },
    { name: 'plaintextHash', type: 'bytes32' },
    { name: 'bidderNonce', type: 'uint256' },
  ],
};

const BID_INTENT_DOMAIN_NAME = 'BondAuctionBid';
const BID_INTENT_DOMAIN_VERSION = '1';

// Monotonic counter blended into the bidderNonce so two bids submitted
// in the same millisecond can't collide. Process-local — fine for the
// sandbox where a single nb-bond-api pod owns every bidder.
let bidderNonceCounter = 0;
function nextBidderNonce(): bigint {
  bidderNonceCounter++;
  return BigInt(Date.now()) * 1000n + BigInt(bidderNonceCounter);
}

function randomHex(numBytes: number): string {
  return `0x${randomBytes(numBytes).toString('hex')}`;
}

export class BidderBidError extends Error {
  constructor(
    public readonly code:
      | 'AUCTION_NOT_FOUND'
      | 'AUCTION_NOT_BIDDING'
      | 'BIDDING_WINDOW_CLOSED'
      | 'TX_FAILED'
      | 'EVENT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'BidderBidError';
  }
}

export interface BuildSealedBidInput {
  bidder: { address: string; privateKey: string; publicKey: string };
  auctionId: string;
  isin: string;
  units: string;
  rate: string;
  auctioneerPubKey: string;
  chainId: number | bigint;
  verifyingContract: string;
}

export interface BuiltSealedBid {
  ciphertext: string;
  plaintextHash: string;
  ciphertextHash: string;
  bidderNonce: string;
  plaintext: BidPlaintext;
}

/**
 * Pure construction of a sealed bid: build the plaintext, sign the
 * EIP-712 BidIntent, dual-wrap encrypt. No chain I/O. Exposed for
 * unit tests so the signature round-trip can be verified without a
 * live RPC. The chain-aware variant below calls this after resolving
 * the auction metadata from the contract.
 */
export async function buildSealedBid(input: BuildSealedBidInput): Promise<BuiltSealedBid> {
  const bidderNonce = nextBidderNonce();
  const bidderAddress = getAddress(input.bidder.address);

  // Stage 1: assemble the plaintext with a placeholder signature so the
  // hash (which strips bidderSig) is stable across both hashing passes.
  const stagedPlaintext: BidPlaintext = {
    isin: input.isin,
    bidder: bidderAddress,
    nonce: randomHex(12),
    rate: input.rate,
    units: input.units,
    salt: randomHex(8),
    bidderNonce: bidderNonce.toString(),
    bidderSig: '0x',
  };

  const plaintextHash = hashBidPlaintext(stagedPlaintext);

  // Stage 2: sign the EIP-712 intent over the plaintextHash.
  const wallet = new Wallet(input.bidder.privateKey);
  const domain: TypedDataDomain = {
    name: BID_INTENT_DOMAIN_NAME,
    version: BID_INTENT_DOMAIN_VERSION,
    chainId: typeof input.chainId === 'bigint' ? input.chainId : BigInt(input.chainId),
    verifyingContract: getAddress(input.verifyingContract),
  };
  const bidderSig = await wallet.signTypedData(domain, BID_INTENT_TYPES, {
    bidder: bidderAddress,
    auctionId: input.auctionId,
    plaintextHash,
    bidderNonce,
  });

  // Stage 3: dual-wrap encrypt the plaintext (now with real signature)
  // so the auctioneer can recover the bidderSig at finalisation time.
  const finalPlaintext: BidPlaintext = { ...stagedPlaintext, bidderSig };
  const wrapped = encryptBid({
    plaintext: finalPlaintext,
    auctioneerPubKey: input.auctioneerPubKey,
    bidderPubKey: input.bidder.publicKey,
  });

  return {
    ciphertext: wrapped.ciphertextHex,
    plaintextHash: wrapped.plaintextHash,
    ciphertextHash: wrapped.ciphertextHash,
    bidderNonce: bidderNonce.toString(),
    plaintext: finalPlaintext,
  };
}

export interface SubmitImpersonatedBidInput {
  bidder: BidderRecord;
  auctionId: string;
  units: string;
  rate: string;
}

export interface SubmitImpersonatedBidResult {
  bidder: string;
  ciphertext: string;
  plaintextHash: string;
  bidIndex: number;
  txHash: string;
  blockNumber: number | null;
}

const AUCTION_STATUS_BIDDING = 1;

export async function submitImpersonatedBid(
  input: SubmitImpersonatedBidInput,
): Promise<SubmitImpersonatedBidResult> {
  const bondAuctionAddress = await getBondAuctionAddress();
  const bondAuction = await getBondAuction();

  const [metadata, statusRaw] = await Promise.all([
    bondAuction.getAuction(input.auctionId),
    bondAuction.getAuctionStatus(input.auctionId),
  ]);

  const isin = metadata.isin as string;
  if (!isin) {
    throw new BidderBidError('AUCTION_NOT_FOUND', `auction ${input.auctionId} not found`);
  }

  const status = Number(statusRaw);
  if (status !== AUCTION_STATUS_BIDDING) {
    throw new BidderBidError(
      'AUCTION_NOT_BIDDING',
      `auction is not in BIDDING phase (status=${status})`,
    );
  }

  const endSeconds = BigInt(metadata.end?.toString?.() ?? '0');
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (endSeconds <= nowSeconds) {
    throw new BidderBidError('BIDDING_WINDOW_CLOSED', 'bidding window has closed');
  }

  const network = await provider.getNetwork();

  const sealingPubKey = (metadata.auctionPubKey as string) || getSealingKeypair().publicKey;

  const built = await buildSealedBid({
    bidder: {
      address: input.bidder.address,
      privateKey: input.bidder.privateKey,
      publicKey: input.bidder.publicKey,
    },
    auctionId: input.auctionId,
    isin,
    units: input.units,
    rate: input.rate,
    auctioneerPubKey: sealingPubKey,
    chainId: network.chainId,
    verifyingContract: bondAuctionAddress,
  });

  const bidderWallet = new Wallet(input.bidder.privateKey, provider);
  const auctionAsBidder = new Contract(bondAuctionAddress, bondAuctionAbi, bidderWallet);
  const submitFn = auctionAsBidder.submitBid as unknown as (
    auctionId: string,
    ciphertext: string,
    plaintextHash: string,
  ) => Promise<ContractTransactionResponse>;

  const tx = await submitFn(input.auctionId, built.ciphertext, built.plaintextHash);
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  if (!receipt) {
    throw new BidderBidError('TX_FAILED', 'submitBid transaction did not produce a receipt');
  }

  const bidIndex = parseBidIndexFromReceipt(receipt, auctionAsBidder.interface);
  if (bidIndex === null) {
    throw new BidderBidError('EVENT_NOT_FOUND', 'BidSubmitted event not present in receipt');
  }

  return {
    bidder: input.bidder.address,
    ciphertext: built.ciphertext,
    plaintextHash: built.plaintextHash,
    bidIndex,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber ?? null,
  };
}

function parseBidIndexFromReceipt(
  receipt: ContractTransactionReceipt,
  iface: Interface,
): number | null {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'BidSubmitted') {
        // Contract event:
        //   BidSubmitted(bytes32 id, address bidder, string isin, uint256 bidIndex, bytes32 plaintextHash, bytes ciphertext)
        const idx = parsed.args.bidIndex ?? parsed.args[3];
        if (idx === undefined) return null;
        return Number(idx);
      }
    } catch {
      continue;
    }
  }
  return null;
}
