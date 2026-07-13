const mockState = {
  auctionCount: 0n,
  auctionStatus: 0n,
  auctionMetadata: { isin: 'NO0000000001', end: 50n },
  activePartition: false,
  activePartitionError: null as Error | null,
  composedBond: { isin: 'NO0000000001' } as unknown,
  composedAuction: { id: '0x01', isin: 'NO0000000001', status: 'closed' } as unknown,
};

const mockDeployBondStatic = jest.fn();
const mockDeployBond = jest.fn();
const mockCloseAuction = jest.fn();

const mockBondAuction = {
  interface: {},
  isinToAuctionCount: jest.fn(async () => mockState.auctionCount),
  getAuction: jest.fn(async () => mockState.auctionMetadata),
  getAuctionStatus: jest.fn(async () => mockState.auctionStatus),
};

const mockBondManager = {
  interface: {},
  deployBondWithAuction: Object.assign(mockDeployBond, { staticCall: mockDeployBondStatic }),
  deployAuctionForBond: Object.assign(jest.fn(), { staticCall: jest.fn() }),
  closeAuction: mockCloseAuction,
  cancelAuction: jest.fn(),
};

jest.mock('../src/chain', () => ({
  decodeCustomError: () => null,
  getBondAuction: async () => mockBondAuction,
  getBondManager: async () => mockBondManager,
  getBondToken: async () => ({
    activePartitions: async () => {
      if (mockState.activePartitionError) throw mockState.activePartitionError;
      return mockState.activePartition;
    },
  }),
  sendWithManagedNonce: async (send: (nonce: number) => Promise<unknown>) => {
    await send(7);
    return { tx: { hash: '0xtx' }, receipt: { blockNumber: 12 } };
  },
}));

jest.mock('../src/compose', () => ({
  composeBond: async () => mockState.composedBond,
  composeAuction: async () => mockState.composedAuction,
}));

jest.mock('../src/operations', () => ({
  withOperationRecording: async (_options: unknown, operation: () => Promise<unknown>) =>
    operation(),
}));

import { createAuctionService } from '../src/features/auctions/service';
import type { IngestionDatabase } from '../src/ingestion-db';

const db = {} as IngestionDatabase;

beforeEach(() => {
  mockState.auctionCount = 0n;
  mockState.auctionStatus = 0n;
  mockState.auctionMetadata = { isin: 'NO0000000001', end: 50n };
  mockState.activePartition = false;
  mockState.activePartitionError = null;
  mockState.composedBond = { isin: 'NO0000000001' };
  mockState.composedAuction = { id: '0x01', isin: 'NO0000000001', status: 'closed' };
});

describe('auction service', () => {
  it('owns create orchestration and waits for the mined block projection', async () => {
    const awaitProjection = jest.fn(async () => undefined);
    const service = createAuctionService({
      historyDb: db,
      operationsDb: db,
      sealingPublicKey: 'seal-key',
      nowSeconds: () => 100n,
      awaitProjection,
    });

    await expect(
      service.create('NO0000000001', {
        type: 'RATE',
        end: '200',
        size: '1000',
        maturityDuration: '31536000',
      }),
    ).resolves.toEqual({ isin: 'NO0000000001' });

    expect(mockDeployBondStatic).toHaveBeenCalledWith(
      'NO0000000001',
      200n,
      'seal-key',
      1000n,
      31536000n,
    );
    expect(mockDeployBond).toHaveBeenCalledWith(
      'NO0000000001',
      200n,
      'seal-key',
      1000n,
      31536000n,
      { nonce: 7 },
    );
    expect(awaitProjection).toHaveBeenCalledWith(12);
  });

  it('fails closed when the required bond-staging read is unavailable', async () => {
    mockState.activePartitionError = new Error('rpc secret detail');
    const service = createAuctionService({
      historyDb: db,
      operationsDb: db,
      sealingPublicKey: 'seal-key',
      nowSeconds: () => 100n,
    });

    await expect(
      service.create('NO0000000001', {
        type: 'RATE',
        end: '200',
        size: '1000',
        maturityDuration: '31536000',
      }),
    ).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      resource: 'bond staging state NO0000000001',
    });
    expect(mockDeployBond).not.toHaveBeenCalled();
  });

  it('owns close orchestration and returns the refreshed projection', async () => {
    const awaitProjection = jest.fn(async () => undefined);
    const service = createAuctionService({
      historyDb: db,
      operationsDb: db,
      sealingPublicKey: 'seal-key',
      nowSeconds: () => 100n,
      awaitProjection,
    });

    await expect(service.close('0x01')).resolves.toEqual(mockState.composedAuction);
    expect(mockCloseAuction).toHaveBeenCalledWith('NO0000000001', { nonce: 7 });
    expect(awaitProjection).toHaveBeenCalledWith(12);
  });
});
