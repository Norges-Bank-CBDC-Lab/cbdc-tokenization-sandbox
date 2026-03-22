"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_1 = require("../src/state");
afterEach(() => {
    for (const auction of (0, state_1.listAuctions)()) {
        (0, state_1.resetAuction)(auction.auctionId);
    }
});
describe('state cache', () => {
    it('indexes auctions by ISIN', () => {
        (0, state_1.upsertAuction)('auction-1', { isin: 'NO0000000000', status: 'open' });
        (0, state_1.upsertAuction)('auction-2', { isin: 'NO0000000000', status: 'closed' });
        const auctions = (0, state_1.getAuctionsByIsin)('NO0000000000')
            .map((a) => a.auctionId)
            .sort();
        expect(auctions).toEqual(['auction-1', 'auction-2']);
    });
    it('removes auctions from the index on reset', () => {
        (0, state_1.upsertAuction)('auction-3', { isin: 'NO0000000000', status: 'open' });
        (0, state_1.resetAuction)('auction-3');
        expect((0, state_1.getAuctionById)('auction-3')).toBeUndefined();
        expect((0, state_1.getAuctionsByIsin)('NO0000000000')).toHaveLength(0);
    });
});
//# sourceMappingURL=state.test.js.map