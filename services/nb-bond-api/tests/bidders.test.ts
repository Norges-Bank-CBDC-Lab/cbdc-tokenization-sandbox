import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  BidderConflictError,
  BidderValidationError,
  FIXTURE_ROSTER,
  createBidder,
  deleteBidder,
  deriveBidderAddress,
  deriveFixturePrivateKey,
  derivePublicKey,
  generateBidderPrivateKey,
  getBidderByAddress,
  getBidderByName,
  listBidders,
  seedFixtureBiddersIfEmpty,
} from '../src/bidders';
import { type IngestionDatabase, openDatabase } from '../src/ingestion-db';

type ClosableIngestionDatabase = IngestionDatabase & { close: () => void };

describe('bidders', () => {
  let tmpDir: string;
  let db: ClosableIngestionDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-bidders-'));
    db = openDatabase({
      dbPath: path.join(tmpDir, 'ingestion.sqlite'),
    }) as ClosableIngestionDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('fixture derivation', () => {
    it('matches the addresses produced by scripts/generate-local-sandbox-fixtures.mjs', () => {
      // These are the deterministic outputs of `deriveFixturePrivateKey(role)`
      // followed by `cast wallet address`. They are committed here so a future
      // edit to the derivation algorithm breaks loudly instead of drifting
      // away from what the rest of the sandbox expects.
      const expected: Record<string, string> = {
        PK_NORDEA: '0xb18C3D01CfAE68D8014458248b6AFccCBbc2331f',
        PK_DNB: '0x8C7A8BE572bAddE00c3D3BdaF5bf11625738bb0D',
        PK_ALICE_TBD: '0x4774bE7da827F41FB97a5CACE0AB1D4eb43cb1C2',
      };
      for (const [role, address] of Object.entries(expected)) {
        const pk = deriveFixturePrivateKey(role);
        expect(deriveBidderAddress(pk)).toBe(address);
      }
    });

    it('produces a 33-byte compressed pubkey for the fixture roles', () => {
      for (const entry of FIXTURE_ROSTER) {
        const pub = derivePublicKey(deriveFixturePrivateKey(entry.role));
        // 0x + 33 bytes = 0x + 66 hex chars
        expect(pub).toMatch(/^0x[a-f0-9]{66}$/);
        const prefix = pub.slice(2, 4);
        expect(['02', '03']).toContain(prefix);
      }
    });
  });

  describe('seed', () => {
    it('inserts the fixture roster on an empty DB', () => {
      const result = seedFixtureBiddersIfEmpty(db);
      expect(result).toEqual({ seeded: true, count: FIXTURE_ROSTER.length });

      const rows = listBidders(db);
      expect(rows.map((r) => r.name).sort()).toEqual(['Alice.tbd', 'DNB', 'Nordea']);
    });

    it('is idempotent — re-seeding a populated DB is a no-op', () => {
      seedFixtureBiddersIfEmpty(db);
      const result = seedFixtureBiddersIfEmpty(db);
      expect(result).toEqual({ seeded: false, count: FIXTURE_ROSTER.length });
      expect(listBidders(db)).toHaveLength(FIXTURE_ROSTER.length);
    });
  });

  describe('createBidder', () => {
    it('generates a fresh keypair when privateKey is absent', () => {
      const before = listBidders(db);
      const bidder = createBidder(db, { name: 'TestGen' });
      expect(bidder.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(bidder.privateKey).toMatch(/^0x[a-f0-9]{64}$/);
      expect(bidder.publicKey).toMatch(/^0x[a-f0-9]{66}$/);
      expect(listBidders(db)).toHaveLength(before.length + 1);
    });

    it('imports an existing private key and derives the right address', () => {
      const pk = generateBidderPrivateKey();
      const expectedAddress = deriveBidderAddress(pk);
      const bidder = createBidder(db, { name: 'TestImport', privateKey: pk });
      expect(bidder.address).toBe(expectedAddress);
      expect(bidder.privateKey).toBe(pk.toLowerCase());
    });

    it('rejects a duplicate name with BidderConflictError', () => {
      createBidder(db, { name: 'Dup' });
      expect(() => createBidder(db, { name: 'Dup' })).toThrow(BidderConflictError);
    });

    it('rejects an empty name with BidderValidationError', () => {
      expect(() => createBidder(db, { name: '   ' })).toThrow(BidderValidationError);
    });

    it('rejects a malformed private key with BidderValidationError', () => {
      expect(() => createBidder(db, { name: 'BadPk', privateKey: '0x1234' })).toThrow(
        BidderValidationError,
      );
    });
  });

  describe('deleteBidder', () => {
    it('removes a bidder and returns true', () => {
      const bidder = createBidder(db, { name: 'ToDelete' });
      expect(deleteBidder(db, bidder.address)).toBe(true);
      expect(getBidderByAddress(db, bidder.address)).toBeNull();
    });

    it('returns false when no bidder exists at the address', () => {
      expect(deleteBidder(db, '0x0000000000000000000000000000000000000001')).toBe(false);
    });

    it('matches addresses case-insensitively', () => {
      const bidder = createBidder(db, { name: 'CaseTest' });
      expect(deleteBidder(db, bidder.address.toLowerCase())).toBe(true);
    });
  });

  describe('lookups', () => {
    it('findByName and findByAddress are consistent', () => {
      const bidder = createBidder(db, { name: 'Lookup' });
      expect(getBidderByName(db, 'Lookup')?.address).toBe(bidder.address);
      expect(getBidderByAddress(db, bidder.address)?.name).toBe('Lookup');
    });
  });
});
