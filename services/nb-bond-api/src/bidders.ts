/**
 * Bidders — sandbox-only impersonable bidder roster.
 *
 * Stored in the system-of-record `bidders` table (see ingestion-db.ts).
 * Each bidder is identified by their secp256k1 keypair: the same
 * private key signs the tx, signs the EIP-712 bid intent, and acts as
 * the bidder pubkey for the dual-wrap encryption (encryption.ts).
 *
 * On first boot the table is seeded with three deterministically-
 * derived fixtures (Nordea, DNB, Alice.tbd) so addresses align with
 * `scripts/generate-local-sandbox-fixtures.mjs` output without
 * requiring a file mount into the container. The derivation algorithm
 * MUST match `deriveFixturePrivateKey` in the fixture script.
 *
 * Sandbox-only: private keys are stored in plaintext. Never deploy
 * this configuration against real funds.
 */
import { createHash } from 'node:crypto';
import * as secp256k1 from '@noble/secp256k1';
import { computeAddress, getAddress } from 'ethers';

import {
  type BidderRow,
  type IngestionDatabase,
  countBidderRows,
  deleteBidderRow,
  getBidderRowByAddress,
  getBidderRowByName,
  insertBidderRow,
  listBidderRows,
} from './ingestion-db';
import { logger } from './logger';

const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);
const FIXTURE_PREFIX = 'cbdc-tokenization-sandbox/local-fixture/';

/**
 * Roster seeded on first boot. The `role` is the same string used by
 * `scripts/generate-local-sandbox-fixtures.mjs` (`transactionRoles[i][1]`),
 * so the derived address matches what the rest of the sandbox expects.
 */
export const FIXTURE_ROSTER: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Nordea', role: 'PK_NORDEA' },
  { name: 'DNB', role: 'PK_DNB' },
  { name: 'Alice.tbd', role: 'PK_ALICE_TBD' },
];

export interface BidderRecord {
  address: string;
  name: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
}

export interface CreateBidderInput {
  name: string;
  privateKey?: string;
}

export class BidderConflictError extends Error {
  constructor(
    message: string,
    public readonly field: 'name' | 'address',
  ) {
    super(message);
    this.name = 'BidderConflictError';
  }
}

export class BidderValidationError extends Error {
  constructor(
    message: string,
    public readonly field: 'name' | 'privateKey',
  ) {
    super(message);
    this.name = 'BidderValidationError';
  }
}

export function deriveFixturePrivateKey(role: string): string {
  const hashHex = createHash('sha256').update(`${FIXTURE_PREFIX}${role}`).digest('hex');
  const value = (BigInt(`0x${hashHex}`) % (SECP256K1_ORDER - 1n)) + 1n;
  return `0x${value.toString(16).padStart(64, '0')}`;
}

export function derivePublicKey(privateKeyHex: string): string {
  const priv = normalizePrivateKey(privateKeyHex);
  const pub = secp256k1.getPublicKey(priv, true);
  return `0x${Buffer.from(pub).toString('hex')}`;
}

export function deriveBidderAddress(privateKeyHex: string): string {
  const priv = normalizePrivateKey(privateKeyHex);
  // `computeAddress` accepts a compressed or uncompressed pubkey hex;
  // we hand it the uncompressed form so it derives a checksummed address.
  const uncompressed = secp256k1.getPublicKey(priv, false);
  return computeAddress(`0x${Buffer.from(uncompressed).toString('hex')}`);
}

export function generateBidderPrivateKey(): string {
  return `0x${Buffer.from(secp256k1.utils.randomSecretKey()).toString('hex')}`;
}

function normalizePrivateKey(value: string): Buffer {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new BidderValidationError(
      'private key must be 32-byte hex (0x-prefixed, 64 hex chars)',
      'privateKey',
    );
  }
  return Buffer.from(hex, 'hex');
}

function rowToRecord(row: BidderRow): BidderRecord {
  return {
    address: row.address,
    name: row.name,
    publicKey: row.public_key,
    privateKey: row.private_key,
    createdAt: row.created_at,
  };
}

function buildRow(input: { name: string; privateKey: string; createdAt: number }): BidderRow {
  const address = deriveBidderAddress(input.privateKey);
  const publicKey = derivePublicKey(input.privateKey);
  return {
    address,
    name: input.name,
    public_key: publicKey,
    private_key: input.privateKey.startsWith('0x')
      ? input.privateKey.toLowerCase()
      : `0x${input.privateKey.toLowerCase()}`,
    created_at: input.createdAt,
  };
}

/**
 * Seed the fixture roster if the table is empty. Idempotent: a second
 * call after seeding is a no-op. Safe to call at boot from a write
 * handle.
 */
export function seedFixtureBiddersIfEmpty(db: IngestionDatabase): {
  seeded: boolean;
  count: number;
} {
  const existing = countBidderRows(db);
  if (existing > 0) {
    return { seeded: false, count: existing };
  }

  const now = Date.now();
  for (const entry of FIXTURE_ROSTER) {
    const privateKey = deriveFixturePrivateKey(entry.role);
    const row = buildRow({ name: entry.name, privateKey, createdAt: now });
    insertBidderRow(db, row);
  }
  logger.info(
    `seeded ${FIXTURE_ROSTER.length} fixture bidders: ${FIXTURE_ROSTER.map((b) => b.name).join(', ')}`,
  );
  return { seeded: true, count: FIXTURE_ROSTER.length };
}

export function listBidders(db: IngestionDatabase): BidderRecord[] {
  return listBidderRows(db).map(rowToRecord);
}

export function getBidderByAddress(db: IngestionDatabase, address: string): BidderRecord | null {
  const row = getBidderRowByAddress(db, address);
  return row ? rowToRecord(row) : null;
}

export function getBidderByName(db: IngestionDatabase, name: string): BidderRecord | null {
  const row = getBidderRowByName(db, name);
  return row ? rowToRecord(row) : null;
}

/**
 * Create a new bidder. When `privateKey` is omitted a fresh secp256k1
 * keypair is generated. Throws `BidderValidationError` on bad input
 * and `BidderConflictError` when name or address already exists.
 */
export function createBidder(db: IngestionDatabase, input: CreateBidderInput): BidderRecord {
  const name = input.name?.trim();
  if (!name) {
    throw new BidderValidationError('name is required', 'name');
  }
  if (name.length > 64) {
    throw new BidderValidationError('name must be at most 64 characters', 'name');
  }

  const privateKey = input.privateKey ?? generateBidderPrivateKey();
  normalizePrivateKey(privateKey); // throws BidderValidationError on bad shape

  const row = buildRow({ name, privateKey, createdAt: Date.now() });

  if (getBidderRowByName(db, name)) {
    throw new BidderConflictError(`bidder name "${name}" already exists`, 'name');
  }
  // Re-fetch via checksum address to avoid duplicate inserts on case-mismatched input.
  if (getBidderRowByAddress(db, row.address)) {
    throw new BidderConflictError(`bidder address ${row.address} already exists`, 'address');
  }

  insertBidderRow(db, row);
  return rowToRecord(row);
}

/**
 * Delete a bidder by address. Returns true if a row was removed,
 * false if no bidder existed at that address. Address is checksum-
 * normalized before lookup so 0x000…aBc and 0x000…abc match.
 */
export function deleteBidder(db: IngestionDatabase, address: string): boolean {
  let canonical: string;
  try {
    canonical = getAddress(address);
  } catch {
    throw new BidderValidationError('address must be a valid EVM address', 'name');
  }
  const removed = deleteBidderRow(db, canonical);
  return removed > 0;
}
