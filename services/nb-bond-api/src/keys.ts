import * as secp256k1 from '@noble/secp256k1';
import { generateKeypair } from './encryption';
import { logger } from './logger';

export interface SealingKeypair {
  privateKey: string;
  publicKey: string;
}

let cachedKeypair: SealingKeypair | null = null;

export function initSealingKeypair(envPrivateKey?: string): SealingKeypair {
  if (cachedKeypair) {
    return cachedKeypair;
  }

  if (envPrivateKey) {
    const priv = normalizeHex(envPrivateKey);
    const privBytes = Buffer.from(priv.slice(2), 'hex');
    const pub = `0x${Buffer.from(secp256k1.getPublicKey(privBytes, true)).toString('hex')}`;
    cachedKeypair = { privateKey: priv, publicKey: pub };
    logger.debug(`Sealing with pubkey ${pub}`);
    return cachedKeypair;
  }

  cachedKeypair = generateKeypair();
  return cachedKeypair;
}

export function getSealingKeypair(): SealingKeypair {
  if (!cachedKeypair) {
    throw new Error('Sealing keypair not initialised');
  }
  return cachedKeypair;
}

function normalizeHex(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (hex.length !== 64) {
    throw new Error('sealing private key must be 32 bytes hex');
  }
  return `0x${hex}`;
}
