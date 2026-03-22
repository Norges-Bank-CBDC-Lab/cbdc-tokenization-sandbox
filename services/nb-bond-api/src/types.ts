import type { Role } from './encryption';

export enum AuctionType {
  RATE = 0,
  PRICE = 1,
  BUYBACK = 2,
}

export interface SealedBid {
  bidder: string;
  ciphertext: string;
  plaintextHash: string;
}

export interface UnsealedBid {
  bidder: string;
  ciphertext: string;
  plaintextHash: string;
  plaintext: BidPlaintext;
  ciphertextHash: string;
  bidIndex: number;
  usedWrap: Role;
}

export interface BidPlaintext {
  isin: string;
  bidder: string;
  nonce: string;
  rate: string; // bps (1e4 precision), applies to RATE/PRICE/BUYBACK (price per 100 for PRICE/BUYBACK)
  units: string;
  salt: string;
  bidderNonce: string;
  bidderSig: string;
}

export interface Allocation {
  isin: string;
  bidder: string;
  units: bigint;
  rate: bigint;
  auctionType: AuctionType;
}

export interface AllocationResult {
  clearingRate: bigint;
  totalAllocated: bigint;
  auctionType: AuctionType;
  allocations: Allocation[];
  allocationHash: string;
  computedAt: number;
}

export type AuctionStatus = 'open' | 'closed' | 'finalised' | 'rejected' | 'cancelled';

export interface AuctionCache {
  auctionId: string;
  isin?: string;
  auctionType?: AuctionType;
  status?: AuctionStatus;
  sealedBids?: SealedBid[];
  unsealedBids?: UnsealedBid[];
  allocationResult?: AllocationResult;
  closedAt?: number;
  finalised?: boolean;
  rejected?: boolean;
  cancelled?: boolean;
  metadata?: {
    end?: bigint;
    offering?: bigint;
    auctionPubKey?: string;
    bond?: string;
  };
}
