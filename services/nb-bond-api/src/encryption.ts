////////////////////////////////////
//     BID SEALING ENCRYPTION     //
////////////////////////////////////

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import * as secp256k1 from '@noble/secp256k1';
import { keccak256 } from 'ethers';

const VERSION = 1;
const SYM_KEY_LEN = 32;
const SYM_NONCE_LEN = 12;
const SYM_TAG_LEN = 16;
const KEY_WRAP_PUBKEY_LEN = 33;
const KEY_WRAP_NONCE_LEN = 12;
const KEY_WRAP_TAG_LEN = 16;

export type Role = 'auctioneer' | 'bidder';

export interface BidPlaintext {
  isin: string;
  bidder: string;
  nonce: string;
  rate: string; // percentage in bps (1e4 precision), represents interest rate (RATE) or price per 100 (PRICE)
  units: string; // number of 1,000 NOK nominal units
  salt: string;
  bidderNonce: string; // uint256 decimal string
  bidderSig: string; // EIP-712 signature over intent (stored in ciphertext, excluded from plaintext hash)
}

export interface EncryptBidParams {
  plaintext: BidPlaintext;
  auctioneerPubKey: string; // compressed secp256k1 key (0x...)
  bidderPubKey: string; // compressed secp256k1 key (0x...)
  version?: number;
}

export interface DecryptBidResult {
  plaintext: BidPlaintext;
  plaintextHash: string;
  ciphertextHash: string;
  usedWrap: Role;
}

interface KeyWrap {
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}

interface CiphertextParts {
  version: number;
  auctioneerWrap: KeyWrap;
  bidderWrap: KeyWrap;
  symNonce: Uint8Array;
  symCiphertext: Uint8Array;
  symTag: Uint8Array;
}

export type ParsedCiphertext = CiphertextParts;

export interface GeneratedKeypair {
  privateKey: string;
  publicKey: string;
}

export function generateKeypair(): GeneratedKeypair {
  const priv = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(priv, true);
  return {
    privateKey: toPrefixedHex(priv),
    publicKey: toPrefixedHex(pub),
  };
}

/// Encrypt a bid’s plaintext into the dual-wrapped ciphertext blob.
export function encryptBid(params: EncryptBidParams): {
  ciphertextHex: string;
  plaintextHash: string;
  ciphertextHash: string;
} {
  const version = params.version ?? VERSION;
  const symKey = randomBytes(SYM_KEY_LEN);
  const plaintextBytes = Buffer.from(JSON.stringify(params.plaintext), 'utf8');
  const plaintextHash = hashBidPlaintext(params.plaintext);

  const {
    ciphertext: symCiphertext,
    nonce: symNonce,
    authTag: symTag,
  } = aesGcmEncrypt(symKey, plaintextBytes);
  const auctioneerWrap = wrapKeyForRecipient(params.auctioneerPubKey, symKey);
  const bidderWrap = wrapKeyForRecipient(params.bidderPubKey, symKey);

  const blob = packCiphertext({
    version,
    auctioneerWrap,
    bidderWrap,
    symNonce,
    symCiphertext,
    symTag,
  });

  const ciphertextHash = keccak256(blob);

  return {
    ciphertextHex: toPrefixedHex(blob),
    plaintextHash,
    ciphertextHash,
  };
}

/// Decrypt a ciphertext using either the auctioneer or bidder private key.
export function decryptBid(
  ciphertextHex: string,
  privateKeyHex: string,
  preferredRole?: Role,
): DecryptBidResult {
  const ciphertextHash = keccak256(Buffer.from(strip0x(ciphertextHex), 'hex'));
  const parsed = parseCiphertext(ciphertextHex);
  const roles: Role[] =
    preferredRole === 'bidder'
      ? ['bidder', 'auctioneer']
      : preferredRole === 'auctioneer'
        ? ['auctioneer', 'bidder']
        : ['auctioneer', 'bidder'];

  let symKey: Uint8Array | undefined;
  let usedWrap: Role | undefined;

  for (const role of roles) {
    try {
      if (role === 'auctioneer') {
        symKey = unwrapKey(privateKeyHex, parsed.auctioneerWrap);
      } else {
        symKey = unwrapKey(privateKeyHex, parsed.bidderWrap);
      }
      usedWrap = role;
      break;
    } catch {
      continue;
    }
  }

  if (!symKey || !usedWrap) {
    throw new Error('private key could not decrypt any wrapped symmetric key');
  }

  const plaintextBytes = aesGcmDecrypt(
    symKey,
    parsed.symNonce,
    parsed.symCiphertext,
    parsed.symTag,
  );
  const plaintext = JSON.parse(Buffer.from(plaintextBytes).toString('utf8')) as BidPlaintext;

  return {
    plaintext,
    plaintextHash: hashBidPlaintext(plaintext),
    ciphertextHash,
    usedWrap,
  };
}

/// Compute the canonical plaintext hash (excludes bidderSig to avoid self-reference).
export function hashBidPlaintext(plaintext: BidPlaintext): string {
  const { bidderSig: _sig, ...rest } = plaintext;
  const bytes = Buffer.from(JSON.stringify(rest), 'utf8');
  return keccak256(bytes);
}

/// Parse a ciphertext blob into its structured parts without decrypting.
export function parseCiphertext(ciphertextHex: string): ParsedCiphertext {
  const data = Buffer.from(strip0x(ciphertextHex), 'hex');
  if (data.length < 3) {
    throw new Error('ciphertext too short');
  }

  let offset = 0;
  const version = data[offset];
  offset += 1;

  const auctioneerWrapLen = data.readUInt16BE(offset);
  offset += 2;
  if (offset + auctioneerWrapLen > data.length) {
    throw new Error('invalid auctioneer wrap length');
  }
  const auctioneerWrapBytes = data.subarray(offset, offset + auctioneerWrapLen);
  offset += auctioneerWrapLen;

  const bidderWrapLen = data.readUInt16BE(offset);
  offset += 2;
  if (offset + bidderWrapLen > data.length) {
    throw new Error('invalid bidder wrap length');
  }
  const bidderWrapBytes = data.subarray(offset, offset + bidderWrapLen);
  offset += bidderWrapLen;

  const expectedRemaining = SYM_NONCE_LEN + SYM_TAG_LEN;
  if (data.length < offset + expectedRemaining) {
    throw new Error('ciphertext missing symmetric segment');
  }

  const symNonce = data.subarray(offset, offset + SYM_NONCE_LEN);
  offset += SYM_NONCE_LEN;
  const symTag = data.subarray(offset, offset + SYM_TAG_LEN);
  offset += SYM_TAG_LEN;
  const symCiphertext = data.subarray(offset);

  return {
    version,
    auctioneerWrap: unpackKeyWrap(auctioneerWrapBytes),
    bidderWrap: unpackKeyWrap(bidderWrapBytes),
    symNonce,
    symCiphertext,
    symTag,
  };
}

function wrapKeyForRecipient(recipientPubKeyHex: string, key: Uint8Array): KeyWrap {
  const ephemeralPriv = secp256k1.utils.randomSecretKey();
  const recipientPubKey = normalizeCompressedPubKey(recipientPubKeyHex);
  const sharedKey = deriveSharedSecret(ephemeralPriv, recipientPubKey);

  const { ciphertext, nonce, authTag } = aesGcmEncrypt(sharedKey, key, KEY_WRAP_NONCE_LEN);

  return {
    ephemeralPublicKey: secp256k1.getPublicKey(ephemeralPriv, true),
    nonce,
    ciphertext,
    authTag,
  };
}

function unwrapKey(privateKeyHex: string, wrap: KeyWrap): Uint8Array {
  const privKey = normalizePrivateKey(privateKeyHex);
  const sharedKey = deriveSharedSecret(privKey, wrap.ephemeralPublicKey);
  return aesGcmDecrypt(sharedKey, wrap.nonce, wrap.ciphertext, wrap.authTag);
}

function packCiphertext(parts: CiphertextParts): Uint8Array {
  const auctioneerWrapBytes = packKeyWrap(parts.auctioneerWrap);
  const bidderWrapBytes = packKeyWrap(parts.bidderWrap);

  const buffers = [
    Buffer.from([parts.version]),
    u16FromLength(auctioneerWrapBytes.length),
    auctioneerWrapBytes,
    u16FromLength(bidderWrapBytes.length),
    bidderWrapBytes,
    Buffer.from(parts.symNonce),
    Buffer.from(parts.symTag),
    Buffer.from(parts.symCiphertext),
  ];

  return Buffer.concat(buffers);
}

function packKeyWrap(wrap: KeyWrap): Buffer {
  return Buffer.concat([
    Buffer.from(wrap.ephemeralPublicKey),
    Buffer.from(wrap.nonce),
    Buffer.from(wrap.authTag),
    Buffer.from(wrap.ciphertext),
  ]);
}

function unpackKeyWrap(data: Uint8Array): KeyWrap {
  const wrapLen = data.length;
  const minLen = KEY_WRAP_PUBKEY_LEN + KEY_WRAP_NONCE_LEN + KEY_WRAP_TAG_LEN + SYM_KEY_LEN;
  if (wrapLen < minLen) {
    throw new Error('invalid key wrap');
  }

  let offset = 0;
  const ephemeralPublicKey = data.subarray(offset, offset + KEY_WRAP_PUBKEY_LEN);
  offset += KEY_WRAP_PUBKEY_LEN;
  const nonce = data.subarray(offset, offset + KEY_WRAP_NONCE_LEN);
  offset += KEY_WRAP_NONCE_LEN;
  const authTag = data.subarray(offset, offset + KEY_WRAP_TAG_LEN);
  offset += KEY_WRAP_TAG_LEN;
  const ciphertext = data.subarray(offset);

  return { ephemeralPublicKey, nonce, ciphertext, authTag };
}

function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, nonceLength = SYM_NONCE_LEN) {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, nonce, authTag };
}

function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  authTag: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(Buffer.from(authTag));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}

function deriveSharedSecret(privateKey: Uint8Array, publicKey: string | Uint8Array): Uint8Array {
  const publicKeyBytes = ensureBytes(publicKey);
  const shared = secp256k1.getSharedSecret(privateKey, publicKeyBytes, true);
  return createHash('sha256').update(Buffer.from(shared).subarray(1)).digest();
}

function strip0x(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function toPrefixedHex(data: Uint8Array): string {
  return `0x${Buffer.from(data).toString('hex')}`;
}

function u16FromLength(len: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(len, 0);
  return buf;
}

function ensureBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    const hex = strip0x(value);
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error('invalid hex input');
    }
    return Buffer.from(hex, 'hex');
  }
  return value;
}

function normalizePrivateKey(value: string): Uint8Array {
  const hex = strip0x(value);
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('private key must be hex-encoded');
  }
  if (hex.length !== 64) {
    throw new Error('private key must be 32 bytes hex');
  }
  return Buffer.from(hex, 'hex');
}

function normalizeCompressedPubKey(value: string): Uint8Array {
  const hex = strip0x(value);
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('public key must be hex-encoded');
  }
  if (hex.length !== 66) {
    throw new Error('compressed public key must be 33 bytes hex');
  }
  const prefix = hex.slice(0, 2);
  if (prefix !== '02' && prefix !== '03') {
    throw new Error('compressed public key must start with 02 or 03');
  }
  return Buffer.from(hex, 'hex');
}
