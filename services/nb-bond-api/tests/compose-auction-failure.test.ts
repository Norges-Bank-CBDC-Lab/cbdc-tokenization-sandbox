const chainState = {
  mode: 'missing' as 'missing' | 'failed' | 'available',
  projectionRowExists: false,
  getAuctionContractCalls: 0,
  getAuctionStatusCalls: 0,
  getBondManagerCalls: 0,
};

jest.mock('../src/chain', () => ({
  getBondAuction: async () => {
    chainState.getAuctionContractCalls++;
    if (chainState.mode === 'failed') throw new Error('private RPC detail');
    return {
      getAuction: async () =>
        chainState.mode === 'available'
          ? {
              isin: 'NO0000000001',
              owner: '0x' + '1'.repeat(40),
              offering: 100n,
              auctionType: 1n,
              auctionPubKey: 'public-key',
              bond: '0x' + '2'.repeat(40),
            }
          : { isin: '' },
      getAuctionStatus: async () => {
        chainState.getAuctionStatusCalls++;
        return 1n;
      },
      getAllocations: async () => [],
    };
  },
  getBondAuctionAddress: async () => '0x' + 'a'.repeat(40),
  getBondManager: async () => {
    chainState.getBondManagerCalls++;
    return {
      BOND_TOKEN: async () => '0x' + 'b'.repeat(40),
      getSealedBids: async () => [],
      target: '0x' + 'c'.repeat(40),
    };
  },
  getBondToken: async () => ({}),
  getDurationScalar: async () => 60n,
  getLatestBlockTimestamp: async () => 1000n,
}));

jest.mock('../src/ingestion-db', () => ({
  getAuctionEventsByIsin: () => [],
  getAuctionEventsById: () => [],
  getAuctionRowById: () => (chainState.projectionRowExists ? { auction_id: '0x01' } : null),
  getBalancesByIsin: () => [],
  getBondEventsByIsin: () => [],
  isBondDisabled: () => false,
  listAllAuctions: () => (chainState.projectionRowExists ? [{ auction_id: '0x01' }] : []),
  listAllBonds: () => [],
  listAuctionRowsByIsin: () => [],
}));

import { composeAllAuctions, composeAuction, createComposeReadContext } from '../src/compose';
import type { IngestionDatabase } from '../src/ingestion-db';

const db = {} as IngestionDatabase;

beforeEach(() => {
  chainState.mode = 'missing';
  chainState.projectionRowExists = false;
  chainState.getAuctionContractCalls = 0;
  chainState.getAuctionStatusCalls = 0;
  chainState.getBondManagerCalls = 0;
});

describe('auction required-read semantics', () => {
  it('returns null for an identifier missing from both chain and projection', async () => {
    await expect(composeAuction(db, '0x01')).resolves.toBeNull();
  });

  it('does not silently omit a projected auction missing required chain metadata', async () => {
    chainState.projectionRowExists = true;
    await expect(composeAllAuctions(db)).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      resource: 'auction 0x01',
    });
  });

  it('surfaces chain transport failures instead of treating them as not found', async () => {
    chainState.mode = 'failed';
    await expect(composeAuction(db, '0x01')).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      resource: 'auction 0x01',
    });
  });

  it('uses projected lifecycle status and reuses request-scoped contract handles', async () => {
    chainState.mode = 'available';
    chainState.projectionRowExists = true;
    const readContext = createComposeReadContext();

    const [first, second] = await Promise.all([
      composeAuction(db, '0x01', { readContext }),
      composeAuction(db, '0x02', { readContext }),
    ]);

    expect(first?.status).toBe('open');
    expect(second?.status).toBe('open');
    expect(chainState.getAuctionStatusCalls).toBe(0);
    expect(chainState.getAuctionContractCalls).toBe(1);
    expect(chainState.getBondManagerCalls).toBe(1);
  });
});
