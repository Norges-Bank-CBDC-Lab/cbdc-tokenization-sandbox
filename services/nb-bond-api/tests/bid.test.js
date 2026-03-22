"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const encryption_1 = require("../src/encryption");
const keys_1 = require("../src/keys");
const bid_1 = require("../src/bid");
const basePlaintext = () => ({
    isin: 'NO0000000000',
    bidder: '0x00000000000000000000000000000000000000ab',
    nonce: '1',
    rate: '100',
    units: '5',
    salt: 'salt',
    bidderNonce: '42',
    bidderSig: '0x01',
});
const auctioneer = (0, encryption_1.generateKeypair)();
const bidderKeypair = (0, encryption_1.generateKeypair)();
beforeAll(() => {
    (0, keys_1.initSealingKeypair)(auctioneer.privateKey);
});
describe('normalizeSealedBid', () => {
    it('drops extraneous properties', () => {
        const normalized = (0, bid_1.normalizeSealedBid)({
            bidder: '0x00000000000000000000000000000000000000ab',
            ciphertext: '0x1234',
            plaintextHash: '0x5678',
            extra: 'ignore',
        });
        expect(normalized).toEqual({
            bidder: '0x00000000000000000000000000000000000000ab',
            ciphertext: '0x1234',
            plaintextHash: '0x5678',
        });
    });
});
describe('unsealBid', () => {
    it('unseals and validates a bid', () => {
        const plaintext = basePlaintext();
        const { ciphertextHex, plaintextHash } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidderKeypair.publicKey,
        });
        const sealed = {
            bidder: plaintext.bidder,
            ciphertext: ciphertextHex,
            plaintextHash,
        };
        const unsealed = (0, bid_1.unsealBid)(plaintext.isin, sealed, 7);
        expect(unsealed.plaintext).toEqual(plaintext);
        expect(unsealed.usedWrap).toBe('auctioneer');
        expect(unsealed.bidIndex).toBe(7);
    });
    it('rejects plaintextHash mismatch', () => {
        const plaintext = basePlaintext();
        const { ciphertextHex } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidderKeypair.publicKey,
        });
        expect(() => (0, bid_1.unsealBid)(plaintext.isin, {
            bidder: plaintext.bidder,
            ciphertext: ciphertextHex,
            plaintextHash: '0xdeadbeef',
        })).toThrow(/plaintextHash mismatch/);
    });
    it('rejects bidder mismatch', () => {
        const plaintext = basePlaintext();
        const { ciphertextHex, plaintextHash } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidderKeypair.publicKey,
        });
        expect(() => (0, bid_1.unsealBid)(plaintext.isin, {
            bidder: '0x0000000000000000000000000000000000000001',
            ciphertext: ciphertextHex,
            plaintextHash,
        })).toThrow(/bidder mismatch/);
    });
    it('rejects ISIN mismatch', () => {
        const plaintext = basePlaintext();
        const { ciphertextHex, plaintextHash } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidderKeypair.publicKey,
        });
        expect(() => (0, bid_1.unsealBid)('NO0000000001', {
            bidder: plaintext.bidder,
            ciphertext: ciphertextHex,
            plaintextHash,
        })).toThrow(/bid ISIN mismatch/);
    });
    it('rejects invalid plaintext schema', () => {
        const plaintext = { ...basePlaintext(), bidderSig: 'bad' };
        const { ciphertextHex, plaintextHash } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidderKeypair.publicKey,
        });
        expect(() => (0, bid_1.unsealBid)(plaintext.isin, {
            bidder: plaintext.bidder,
            ciphertext: ciphertextHex,
            plaintextHash,
        })).toThrow(/invalid bid plaintext/);
    });
});
//# sourceMappingURL=bid.test.js.map