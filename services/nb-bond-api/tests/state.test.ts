import {
  getAuctionById,
  getAuctionsByIsin,
  listAuctions,
  resetAuction,
  upsertAuction,
} from '../src/state';

afterEach(() => {
  for (const auction of listAuctions()) {
    resetAuction(auction.auctionId);
  }
});

describe('state cache', () => {
  it('indexes auctions by ISIN', () => {
    upsertAuction('auction-1', { isin: 'NO0000000000', status: 'open' });
    upsertAuction('auction-2', { isin: 'NO0000000000', status: 'closed' });

    const auctions = getAuctionsByIsin('NO0000000000')
      .map((a) => a.auctionId)
      .sort();

    expect(auctions).toEqual(['auction-1', 'auction-2']);
  });

  it('removes auctions from the index on reset', () => {
    upsertAuction('auction-3', { isin: 'NO0000000000', status: 'open' });

    resetAuction('auction-3');

    expect(getAuctionById('auction-3')).toBeUndefined();
    expect(getAuctionsByIsin('NO0000000000')).toHaveLength(0);
  });
});
