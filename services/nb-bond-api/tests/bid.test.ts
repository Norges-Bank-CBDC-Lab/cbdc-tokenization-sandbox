import { encryptBid, generateKeypair } from '../src/encryption';
import { initSealingKeypair } from '../src/keys';
import { normalizeSealedBid, unsealBid } from '../src/bid';

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

const auctioneer = generateKeypair();
const bidderKeypair = generateKeypair();

beforeAll(() => {
  initSealingKeypair(auctioneer.privateKey);
});

describe('normalizeSealedBid', () => {
  it('drops extraneous properties', () => {
    // Intentionally include an extra field to ensure the normalizer drops it.
    const normalized = normalizeSealedBid({
      bidder: '0x00000000000000000000000000000000000000ab',
      ciphertext: '0x1234',
      plaintextHash: '0x5678',
      extra: 'ignore',
    } as unknown as Parameters<typeof normalizeSealedBid>[0]);

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
    const { ciphertextHex, plaintextHash } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidderKeypair.publicKey,
    });

    const sealed = {
      bidder: plaintext.bidder,
      ciphertext: ciphertextHex,
      plaintextHash,
    };

    const unsealed = unsealBid(plaintext.isin, sealed, 7);

    expect(unsealed.plaintext).toEqual(plaintext);
    expect(unsealed.usedWrap).toBe('auctioneer');
    expect(unsealed.bidIndex).toBe(7);
  });

  it('rejects plaintextHash mismatch', () => {
    const plaintext = basePlaintext();
    const { ciphertextHex } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidderKeypair.publicKey,
    });

    expect(() =>
      unsealBid(plaintext.isin, {
        bidder: plaintext.bidder,
        ciphertext: ciphertextHex,
        plaintextHash: '0xdeadbeef',
      }),
    ).toThrow(/plaintextHash mismatch/);
  });

  it('rejects bidder mismatch', () => {
    const plaintext = basePlaintext();
    const { ciphertextHex, plaintextHash } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidderKeypair.publicKey,
    });

    expect(() =>
      unsealBid(plaintext.isin, {
        bidder: '0x0000000000000000000000000000000000000001',
        ciphertext: ciphertextHex,
        plaintextHash,
      }),
    ).toThrow(/bidder mismatch/);
  });

  it('rejects ISIN mismatch', () => {
    const plaintext = basePlaintext();
    const { ciphertextHex, plaintextHash } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidderKeypair.publicKey,
    });

    expect(() =>
      unsealBid('NO0000000001', {
        bidder: plaintext.bidder,
        ciphertext: ciphertextHex,
        plaintextHash,
      }),
    ).toThrow(/bid ISIN mismatch/);
  });

  it('rejects invalid plaintext schema', () => {
    const plaintext = { ...basePlaintext(), bidderSig: 'bad' };
    const { ciphertextHex, plaintextHash } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidderKeypair.publicKey,
    });

    expect(() =>
      unsealBid(plaintext.isin, {
        bidder: plaintext.bidder,
        ciphertext: ciphertextHex,
        plaintextHash,
      }),
    ).toThrow(/invalid bid plaintext/);
  });
});
