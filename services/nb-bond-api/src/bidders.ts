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
 * MUST match `deriveFixturePrivateKey` in the fixture script. Each
 * fixture role's key can be overridden by an env var of the same name
 * (PK_NORDEA / PK_DNB / PK_ALICE_TBD, validated in env-vars.ts) for
 * environments whose fixture contracts were deployed with externally
 * held keys; an already-seeded row that still holds the derived key is
 * migrated to the override at boot (see
 * `reconcileFixtureBidderOverrides`).
 *
 * Sandbox-only: private keys are stored in plaintext. Never deploy
 * this configuration against real funds.
 */
import { createHash } from 'node:crypto';
import * as secp256k1 from '@noble/secp256k1';
import { computeAddress, getAddress } from 'ethers';

import { envVariables } from './env-vars';
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

/** Env-supplied key overrides per fixture role (validated in env-vars.ts). */
const FIXTURE_KEY_OVERRIDES: Readonly<Record<string, string | undefined>> = {
  PK_NORDEA: envVariables.PK_NORDEA,
  PK_DNB: envVariables.PK_DNB,
  PK_ALICE_TBD: envVariables.PK_ALICE_TBD,
};

for (const [role, value] of Object.entries(FIXTURE_KEY_OVERRIDES)) {
  if (value) {
    logger.info(`${role} is set — the env-supplied key overrides the derived fixture key`);
  }
}

/** The env override for a fixture role, or undefined when the role derives. */
export function fixtureRoleKeyOverride(role: string): string | undefined {
  return FIXTURE_KEY_OVERRIDES[role];
}

/**
 * Signing key for a fixture role: the env override when set (for
 * environments whose fixture contracts were deployed with externally held
 * keys), else the local-fixture derivation that matches the local deploy.
 */
export function fixtureRoleKey(role: string): string {
  return FIXTURE_KEY_OVERRIDES[role] ?? deriveFixturePrivateKey(role);
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
    const privateKey = fixtureRoleKey(entry.role);
    const row = buildRow({ name: entry.name, privateKey, createdAt: now });
    insertBidderRow(db, row);
  }
  logger.info(
    `seeded ${FIXTURE_ROSTER.length} fixture bidders: ${FIXTURE_ROSTER.map((b) => b.name).join(', ')}`,
  );
  return { seeded: true, count: FIXTURE_ROSTER.length };
}

/**
 * Migrate already-seeded fixture bidders to their env key overrides.
 * Seeding is only-if-empty, so a database seeded before an override was
 * set (or before overrides existed) would otherwise keep the derived key
 * forever. Only rows still holding the exact derived fixture key are
 * touched — a bidder the operator deleted stays deleted, and any other
 * key is treated as operator-managed and left alone. Migration replaces
 * the row (the address IS the key), so bids already recorded against the
 * old address keep referring to it; sealed bids encrypted to the old
 * public key can no longer be unsealed by this roster entry. Idempotent;
 * safe to call at every boot after `seedFixtureBiddersIfEmpty`.
 */
export function reconcileFixtureBidderOverrides(db: IngestionDatabase): { migrated: number } {
  let migrated = 0;
  for (const entry of FIXTURE_ROSTER) {
    const override = fixtureRoleKeyOverride(entry.role);
    if (!override) continue;
    const row = getBidderRowByName(db, entry.name);
    if (!row || row.private_key !== deriveFixturePrivateKey(entry.role)) continue;
    const replacement = buildRow({
      name: entry.name,
      privateKey: override,
      createdAt: row.created_at,
    });
    if (replacement.address === row.address) continue;
    const occupant = getBidderRowByAddress(db, replacement.address);
    if (occupant) {
      logger.warn(
        `${entry.role} override not applied to bidder "${entry.name}": ` +
          `address ${replacement.address} already belongs to bidder "${occupant.name}"`,
      );
      continue;
    }
    deleteBidderRow(db, row.address);
    insertBidderRow(db, replacement);
    migrated += 1;
    logger.info(
      `migrated fixture bidder "${entry.name}" to the ${entry.role} override ` +
        `(${row.address} → ${replacement.address})`,
    );
  }
  return { migrated };
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
