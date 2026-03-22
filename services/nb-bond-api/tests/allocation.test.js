"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const allocation_1 = require("../src/allocation");
const types_1 = require("../src/types");
const makeBid = (bidder, rate, units) => ({
    bidder,
    ciphertext: '0x',
    plaintextHash: '0x',
    plaintext: {
        isin: 'NO0000000000',
        bidder,
        nonce: '1',
        rate,
        units,
        salt: 'salt',
        bidderNonce: '1',
        bidderSig: '0x01',
    },
    ciphertextHash: '0x',
    bidIndex: 0,
    usedWrap: 'auctioneer',
});
describe('computeUniformAllocation', () => {
    it('allocates highest price bids first and applies uniform clearing rate', () => {
        const bids = [
            makeBid('0x0000000000000000000000000000000000000001', '110', '3'),
            makeBid('0x0000000000000000000000000000000000000002', '100', '6'),
            makeBid('0x0000000000000000000000000000000000000003', '90', '6'),
        ];
        const result = (0, allocation_1.computeUniformAllocation)('NO0000000000', types_1.AuctionType.PRICE, bids, 10n);
        expect(result.clearingRate).toBe(90n);
        expect(result.totalAllocated).toBe(10n);
        expect(result.allocations.map((a) => a.rate)).toEqual([90n, 90n, 90n]);
        expect(result.allocations.map((a) => a.units)).toEqual([3n, 6n, 1n]);
    });
    it('breaks ties by units for rate auctions', () => {
        const bids = [
            makeBid('0x0000000000000000000000000000000000000011', '100', '2'),
            makeBid('0x0000000000000000000000000000000000000012', '100', '3'),
        ];
        const result = (0, allocation_1.computeUniformAllocation)('NO0000000000', types_1.AuctionType.RATE, bids, 3n);
        expect(result.totalAllocated).toBe(3n);
        expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000012');
        expect(result.allocations[0].units).toBe(3n);
    });
    it('breaks ties by units for price auctions', () => {
        const bids = [
            makeBid('0x0000000000000000000000000000000000000013', '100', '2'),
            makeBid('0x0000000000000000000000000000000000000014', '100', '5'),
        ];
        const result = (0, allocation_1.computeUniformAllocation)('NO0000000000', types_1.AuctionType.PRICE, bids, 5n);
        expect(result.totalAllocated).toBe(5n);
        expect(result.allocations).toHaveLength(1);
        expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000014');
        expect(result.allocations[0].units).toBe(5n);
    });
    it('rejects BUYBACK auction type', () => {
        expect(() => (0, allocation_1.computeUniformAllocation)('NO0000000000', types_1.AuctionType.BUYBACK, [], 1n)).toThrow('use computeBuybackAllocation for BUYBACK auctions');
    });
    it('rejects non-positive offering', () => {
        expect(() => (0, allocation_1.computeUniformAllocation)('NO0000000000', types_1.AuctionType.PRICE, [], 0n)).toThrow('offering must be positive');
    });
});
describe('computeBuybackAllocation', () => {
    it('allocates lowest price bids first', () => {
        const bids = [
            makeBid('0x0000000000000000000000000000000000000021', '95', '2'),
            makeBid('0x0000000000000000000000000000000000000022', '100', '3'),
            makeBid('0x0000000000000000000000000000000000000023', '90', '4'),
        ];
        const result = (0, allocation_1.computeBuybackAllocation)('NO0000000000', bids, 5n);
        expect(result.clearingRate).toBe(90n);
        expect(result.totalAllocated).toBe(5n);
        expect(result.allocations.map((a) => a.units)).toEqual([4n, 1n]);
    });
    it('breaks ties by units for buyback auctions', () => {
        const bids = [
            makeBid('0x0000000000000000000000000000000000000024', '90', '2'),
            makeBid('0x0000000000000000000000000000000000000025', '90', '4'),
        ];
        const result = (0, allocation_1.computeBuybackAllocation)('NO0000000000', bids, 4n);
        expect(result.totalAllocated).toBe(4n);
        expect(result.allocations).toHaveLength(1);
        expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000025');
        expect(result.allocations[0].units).toBe(4n);
    });
    it('rejects non-positive buyback size', () => {
        expect(() => (0, allocation_1.computeBuybackAllocation)('NO0000000000', [], 0n)).toThrow('buyback size must be positive');
    });
});
//# sourceMappingURL=allocation.test.js.map