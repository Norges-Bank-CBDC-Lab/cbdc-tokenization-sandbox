import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  cancelAuctionBid,
  replaceAuctionAllocations,
  setAuctionStatus,
  upsertAuctionBid,
  upsertAuctionEvent,
  upsertAuctionMetadata,
} from '../src/ingestion';
import {
  type IngestionDatabase,
  getAuctionAllocations,
  getAuctionBids,
  getAuctionRowById,
  openDatabase,
} from '../src/ingestion-db';

type ClosableDatabase = IngestionDatabase & { close: () => void };

describe('auction projection persistence', () => {
  let tmpDir: string;
  let db: ClosableDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-auction-projection-'));
    db = openDatabase({ dbPath: path.join(tmpDir, 'ingestion.sqlite') }) as ClosableDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('combines manager-owned bond facts with BondAuction metadata', () => {
    upsertAuctionEvent(db, {
      auctionId: '0xauction',
      isin: 'NO0000000001',
      type: 'RATE',
      block: 10,
      logIndex: 1,
      txHash: '0xmanager',
      payload: {},
      bond: '0x' + 'b'.repeat(40),
    });
    upsertAuctionMetadata(db, {
      auctionId: '0xauction',
      isin: 'NO0000000001',
      owner: '0x' + 'a'.repeat(40),
      end: 1_234n,
      offering: 1_000n,
      auctionPubKey: '0x1234',
      auctionType: 'RATE',
      block: 10,
      txHash: '0xauction-created',
    });

    expect(getAuctionRowById(db, '0xauction')).toMatchObject({
      bond: '0x' + 'b'.repeat(40),
      owner: '0x' + 'a'.repeat(40),
      end: '1234',
      offering: '1000',
      auction_pub_key: '0x1234',
      status: 'open',
    });
  });

  it('projects bid submission and cancellation idempotently', () => {
    const bid = {
      auctionId: '0xauction',
      bidIndex: 0,
      bidder: '0x' + 'c'.repeat(40),
      ciphertext: '0xdeadbeef',
      plaintextHash: '0x' + 'd'.repeat(64),
      block: 20,
      logIndex: 2,
    };
    upsertAuctionBid(db, bid);
    upsertAuctionBid(db, bid);
    cancelAuctionBid(db, bid.auctionId, bid.bidder, bid.plaintextHash);

    expect(getAuctionBids(db, bid.auctionId)).toEqual([
      expect.objectContaining({
        bid_index: 0,
        bidder: bid.bidder,
        ciphertext: bid.ciphertext,
        plaintext_hash: bid.plaintextHash,
        cancelled: 1,
      }),
    ]);
  });

  it('replaces final allocations reproducibly and records finalisation time', () => {
    upsertAuctionEvent(db, {
      auctionId: '0xauction',
      isin: 'NO0000000001',
      type: 'RATE',
      block: 10,
      logIndex: 1,
      txHash: '0xmanager',
      payload: {},
    });
    const allocations = [
      { bidder: '0x' + 'e'.repeat(40), units: 600n, rate: 425n, auctionType: 'RATE' },
      { bidder: '0x' + 'f'.repeat(40), units: 400n, rate: 425n, auctionType: 'RATE' },
    ];
    replaceAuctionAllocations(db, '0xauction', 30, allocations);
    replaceAuctionAllocations(db, '0xauction', 30, allocations);
    setAuctionStatus(db, '0xauction', 'finalised', 1_500_000);

    expect(getAuctionAllocations(db, '0xauction')).toHaveLength(2);
    expect(getAuctionAllocations(db, '0xauction')[1]).toMatchObject({
      position: 1,
      units: '400',
      rate: '425',
      source_block: 30,
    });
    expect(getAuctionRowById(db, '0xauction')).toMatchObject({
      status: 'finalised',
      finalised_at: 1_500_000,
    });
  });
});
