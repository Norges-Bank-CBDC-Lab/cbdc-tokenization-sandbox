import {
  decryptBid,
  encryptBid,
  generateKeypair,
  hashBidPlaintext,
  parseCiphertext,
} from '../src/encryption';

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

const makePlaintext = (overrides?: Partial<ReturnType<typeof basePlaintext>>) => ({
  ...basePlaintext(),
  ...overrides,
});

describe('encryptBid/decryptBid', () => {
  it('round-trips with the auctioneer key', () => {
    const auctioneer = generateKeypair();
    const bidder = generateKeypair();
    const plaintext = makePlaintext();

    const { ciphertextHex, plaintextHash, ciphertextHash } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidder.publicKey,
    });

    const decrypted = decryptBid(ciphertextHex, auctioneer.privateKey, 'auctioneer');

    expect(decrypted.plaintext).toEqual(plaintext);
    expect(decrypted.usedWrap).toBe('auctioneer');
    expect(decrypted.plaintextHash).toBe(plaintextHash);
    expect(decrypted.ciphertextHash).toBe(ciphertextHash);
  });

  it('round-trips with the bidder key', () => {
    const auctioneer = generateKeypair();
    const bidder = generateKeypair();
    const plaintext = makePlaintext({ rate: '105' });

    const { ciphertextHex } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidder.publicKey,
    });

    const decrypted = decryptBid(ciphertextHex, bidder.privateKey, 'bidder');

    expect(decrypted.plaintext).toEqual(plaintext);
    expect(decrypted.usedWrap).toBe('bidder');
  });

  it('fails to decrypt with the wrong key', () => {
    const auctioneer = generateKeypair();
    const bidder = generateKeypair();
    const attacker = generateKeypair();
    const plaintext = makePlaintext();

    const { ciphertextHex } = encryptBid({
      plaintext,
      auctioneerPubKey: auctioneer.publicKey,
      bidderPubKey: bidder.publicKey,
    });

    expect(() => decryptBid(ciphertextHex, attacker.privateKey)).toThrow(
      'private key could not decrypt any wrapped symmetric key',
    );
  });
});

describe('hashBidPlaintext', () => {
  it('excludes bidderSig from the hash', () => {
    const base = makePlaintext();
    const withDifferentSig = makePlaintext({ bidderSig: '0x02' });

    expect(hashBidPlaintext(base)).toBe(hashBidPlaintext(withDifferentSig));
  });
});

describe('parseCiphertext', () => {
  it('rejects too-short ciphertext', () => {
    expect(() => parseCiphertext('0x12')).toThrow('ciphertext too short');
  });
});
