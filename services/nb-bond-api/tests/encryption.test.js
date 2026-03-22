"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const encryption_1 = require("../src/encryption");
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
const makePlaintext = (overrides) => ({
    ...basePlaintext(),
    ...overrides,
});
describe('encryptBid/decryptBid', () => {
    it('round-trips with the auctioneer key', () => {
        const auctioneer = (0, encryption_1.generateKeypair)();
        const bidder = (0, encryption_1.generateKeypair)();
        const plaintext = makePlaintext();
        const { ciphertextHex, plaintextHash, ciphertextHash } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidder.publicKey,
        });
        const decrypted = (0, encryption_1.decryptBid)(ciphertextHex, auctioneer.privateKey, 'auctioneer');
        expect(decrypted.plaintext).toEqual(plaintext);
        expect(decrypted.usedWrap).toBe('auctioneer');
        expect(decrypted.plaintextHash).toBe(plaintextHash);
        expect(decrypted.ciphertextHash).toBe(ciphertextHash);
    });
    it('round-trips with the bidder key', () => {
        const auctioneer = (0, encryption_1.generateKeypair)();
        const bidder = (0, encryption_1.generateKeypair)();
        const plaintext = makePlaintext({ rate: '105' });
        const { ciphertextHex } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidder.publicKey,
        });
        const decrypted = (0, encryption_1.decryptBid)(ciphertextHex, bidder.privateKey, 'bidder');
        expect(decrypted.plaintext).toEqual(plaintext);
        expect(decrypted.usedWrap).toBe('bidder');
    });
    it('fails to decrypt with the wrong key', () => {
        const auctioneer = (0, encryption_1.generateKeypair)();
        const bidder = (0, encryption_1.generateKeypair)();
        const attacker = (0, encryption_1.generateKeypair)();
        const plaintext = makePlaintext();
        const { ciphertextHex } = (0, encryption_1.encryptBid)({
            plaintext,
            auctioneerPubKey: auctioneer.publicKey,
            bidderPubKey: bidder.publicKey,
        });
        expect(() => (0, encryption_1.decryptBid)(ciphertextHex, attacker.privateKey)).toThrow('private key could not decrypt any wrapped symmetric key');
    });
});
describe('hashBidPlaintext', () => {
    it('excludes bidderSig from the hash', () => {
        const base = makePlaintext();
        const withDifferentSig = makePlaintext({ bidderSig: '0x02' });
        expect((0, encryption_1.hashBidPlaintext)(base)).toBe((0, encryption_1.hashBidPlaintext)(withDifferentSig));
    });
});
describe('parseCiphertext', () => {
    it('rejects too-short ciphertext', () => {
        expect(() => (0, encryption_1.parseCiphertext)('0x12')).toThrow('ciphertext too short');
    });
});
//# sourceMappingURL=encryption.test.js.map