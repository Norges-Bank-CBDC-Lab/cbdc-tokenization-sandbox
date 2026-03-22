#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createECDH, createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);
const FIXTURE_PREFIX = 'cbdc-tokenization-sandbox/local-fixture/';

const quiet = process.argv.includes('--quiet');
const force = process.argv.includes('--force');

const contractsEnvExamplePath = path.join(REPO_ROOT, 'contracts/.env.example');
const contractsEnvPath = path.join(REPO_ROOT, 'contracts/.env');
const nbBondApiValuesExamplePath = path.join(
  REPO_ROOT,
  'services/nb-bond-api/helm/values.local.example.yaml',
);
const nbBondApiValuesPath = path.join(
  REPO_ROOT,
  'services/nb-bond-api/helm/values.local.yaml',
);
const bidKeysPath = path.join(
  REPO_ROOT,
  'scripts/bid-submitter/examples/bids.keys.json',
);
const tmpBidExamplesRoot = path.join(REPO_ROOT, '.tmp/bid-encryption/examples');

const transactionRoles = [
  ['BESU_SIGNER_KEY', 'BESU_SIGNER'],
  ['PK_DEPLOYER', 'PK_DEPLOYER'],
  ['PK_BROKER1', 'PK_BROKER1'],
  ['PK_BROKER2', 'PK_BROKER2'],
  ['PK_OPERATOR1', 'PK_OPERATOR1'],
  ['PK_NORDEA', 'PK_NORDEA'],
  ['PK_DNB', 'PK_DNB'],
  ['PK_ALICE_TBD', 'PK_ALICE_TBD'],
  ['PK_ALICE_SEC', 'PK_ALICE_SEC'],
  ['PK_BOB_TBD', 'PK_BOB_TBD'],
  ['PK_BOB_SEC', 'PK_BOB_SEC'],
  ['PK_CSD', 'PK_CSD'],
  ['PK_NORGES_BANK', 'PK_NORGES_BANK'],
  ['PK_ID_WALLET_ALICE', 'PK_ID_WALLET_ALICE'],
  ['PK_ID_WALLET_BOB', 'PK_ID_WALLET_BOB'],
  ['PK_MARKET_MAKER', 'PK_MARKET_MAKER'],
  ['PK_BOND_ADMIN', 'PK_BOND_ADMIN'],
  ['PK_GOV_RESERVE', 'PK_GOV_RESERVE'],
  ['PK_17', 'PK_17'],
  ['PK_18', 'PK_18'],
  ['PK_19', 'PK_19'],
];

const sealRoles = {
  PK_NORDEA: 'SEAL_NORDEA',
  PK_DNB: 'SEAL_DNB',
  PK_ALICE_TBD: 'SEAL_ALICE_TBD',
};

function log(message) {
  if (!quiet) {
    console.log(message);
  }
}

function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  ensureParentDir(filePath);
  writeFileSync(filePath, content, 'utf8');
}

function writeIfMissing(filePath, content, label) {
  if (!force && existsSync(filePath)) {
    log(`Keeping existing ${label}: ${path.relative(REPO_ROOT, filePath)}`);
    return false;
  }

  writeText(filePath, content);
  log(`${force && existsSync(filePath) ? 'Rewrote' : 'Wrote'} ${label}: ${path.relative(REPO_ROOT, filePath)}`);
  return true;
}

function writeAlways(filePath, content, label) {
  writeText(filePath, content);
  log(`Wrote ${label}: ${path.relative(REPO_ROOT, filePath)}`);
}

function deriveFixturePrivateKey(role) {
  const hashHex = createHash('sha256')
    .update(`${FIXTURE_PREFIX}${role}`)
    .digest('hex');
  const value = (BigInt(`0x${hashHex}`) % (SECP256K1_ORDER - 1n)) + 1n;
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function deriveAddress(privateKey) {
  const result = spawnSync(
    'cast',
    ['wallet', 'address', '--private-key', privateKey],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const error = stderr || stdout || 'unknown cast error';
    throw new Error(`failed to derive address with cast: ${error}`);
  }

  return result.stdout.trim();
}

function deriveCompressedPublicKey(privateKey) {
  const ecdh = createECDH('secp256k1');
  const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  ecdh.setPrivateKey(Buffer.from(hex, 'hex'));
  return `0x${ecdh.getPublicKey(null, 'compressed').toString('hex')}`;
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const rawLine of readText(filePath).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }
  return values;
}

function replaceEnvKey(exampleText, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!pattern.test(exampleText)) {
    throw new Error(`missing ${key} in contracts/.env.example`);
  }
  return exampleText.replace(pattern, `${key}=${value}`);
}

function buildTransactionAccounts(existingEnv) {
  return Object.fromEntries(
    transactionRoles.map(([envName, role]) => {
      const privateKey = existingEnv[envName] || deriveFixturePrivateKey(role);
      return [
        envName,
        {
          privateKey,
          address: deriveAddress(privateKey),
        },
      ];
    }),
  );
}

function buildSealAccounts(existingBidKeys) {
  const accounts = {};
  for (const [envName, role] of Object.entries(sealRoles)) {
    const existingEntry = existingBidKeys[envName];
    const privateKey = existingEntry?.sealPrivateKey || deriveFixturePrivateKey(role);
    accounts[envName] = {
      privateKey,
      publicKey: deriveCompressedPublicKey(privateKey),
    };
  }
  return accounts;
}

function parseExistingBidKeys(filePath, txAccounts) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readText(filePath));
    const keyedByEnvName = {};

    for (const [envName, account] of Object.entries(txAccounts)) {
      const existing = parsed[account.address];
      if (existing && typeof existing === 'object') {
        keyedByEnvName[envName] = existing;
      }
    }

    return keyedByEnvName;
  } catch {
    return {};
  }
}

function buildContractsEnv(existingEnv, txAccounts) {
  let rendered = readText(contractsEnvExamplePath);
  for (const [envName, account] of Object.entries(txAccounts)) {
    rendered = replaceEnvKey(rendered, envName, account.privateKey);
  }
  return rendered;
}

function buildNbBondApiHelmValues(txAccounts, auctionOwnerSealPrivateKey) {
  let rendered = readText(nbBondApiValuesExamplePath);
  rendered = rendered.replace(
    '<base64-encoded-local-sandbox-private-key>',
    Buffer.from(txAccounts.PK_BOND_ADMIN.privateKey).toString('base64'),
  );
  rendered = rendered.replace(
    '<base64-encoded-local-seal-private-key>',
    Buffer.from(auctionOwnerSealPrivateKey).toString('base64'),
  );
  return rendered;
}

function buildBidKeysJson(txAccounts, sealAccounts) {
  const bidders = ['PK_NORDEA', 'PK_DNB', 'PK_ALICE_TBD'];
  const data = Object.fromEntries(
    bidders.map((envName) => [
      txAccounts[envName].address,
      {
        privateKey: txAccounts[envName].privateKey,
        sealPrivateKey: sealAccounts[envName].privateKey,
        sealPublicKey: sealAccounts[envName].publicKey,
      },
    ]),
  );
  return `${JSON.stringify(data, null, 2)}\n`;
}

function buildBasicSealExample(txAccounts, sealAccounts, auctionOwnerSealPublicKey) {
  return {
    payload: {
      isin: 'NO0012345678',
      bidder: txAccounts.PK_NORDEA.address,
      nonce: 'bid-2',
      rate: '100000000000000000000',
      units: '500',
      salt: '0xffffffffffffff',
    },
    auctioneerPublicKey: auctionOwnerSealPublicKey,
    bidderPublicKey: sealAccounts.PK_NORDEA.publicKey,
    signing: {
      chainId: '2018',
      verifyingContract: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
      auctionId:
        '0x8f78e70251da216bf3e810197eddb19a9892f0b9c8c9977cb92b894982e2e255',
      bidderPrivateKey: txAccounts.PK_NORDEA.privateKey,
      bidderNonce: '1',
    },
    version: 1,
  };
}

function buildAuctionSealExamples(txAccounts, sealAccounts, auctionOwnerSealPublicKey) {
  const bidders = [
    {
      envName: 'PK_NORDEA',
      nonceSuffix: '1',
      bidderNonce: '0',
      rate: '425',
      units: '100',
      salt: '0x11111111',
    },
    {
      envName: 'PK_DNB',
      nonceSuffix: '2',
      bidderNonce: '1',
      rate: '430',
      units: '100',
      salt: '0x22222222',
    },
    {
      envName: 'PK_ALICE_TBD',
      nonceSuffix: '3',
      bidderNonce: '2',
      rate: '450',
      units: '100',
      salt: '0x33333333',
    },
  ];

  const initial = bidders.map((bidder) => ({
    payload: {
      isin: 'NO001DEMO000',
      bidder: txAccounts[bidder.envName].address,
      nonce: `initial-${bidder.nonceSuffix}`,
      rate: bidder.rate,
      units: bidder.units,
      salt: bidder.salt,
    },
    signing: {
      chainId: '2018',
      verifyingContract: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
      auctionId:
        '0x622d3d2e29ec9177022f05144423704928a5787080f6018f2f8ba107dca748aa',
      bidderPrivateKey: txAccounts[bidder.envName].privateKey,
      bidderNonce: bidder.bidderNonce,
    },
    auctioneerPublicKey: auctionOwnerSealPublicKey,
    bidderPublicKey: sealAccounts[bidder.envName].publicKey,
    version: 1,
  }));

  const extend = bidders.map((bidder, index) => ({
    payload: {
      isin: 'NO001DEMO000',
      bidder: txAccounts[bidder.envName].address,
      nonce: `extend-${bidder.nonceSuffix}`,
      rate: ['9875', '9860', '9850'][index],
      units: ['100', '100', '50'][index],
      salt: bidder.salt,
    },
    signing: {
      chainId: '2018',
      verifyingContract: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
      auctionId:
        '0x722d3d2e29ec9177022f05144423704928a5787080f6018f2f8ba107dca748bb',
      bidderPrivateKey: txAccounts[bidder.envName].privateKey,
      bidderNonce: bidder.bidderNonce,
    },
    auctioneerPublicKey: auctionOwnerSealPublicKey,
    bidderPublicKey: sealAccounts[bidder.envName].publicKey,
    version: 1,
  }));

  const buyback = bidders.map((bidder, index) => ({
    payload: {
      isin: 'NO001DEMO000',
      bidder: txAccounts[bidder.envName].address,
      nonce: `buyback-${bidder.nonceSuffix}`,
      rate: ['9840', '9825', '9800'][index],
      units: '200',
      salt: bidder.salt,
    },
    signing: {
      chainId: '2018',
      verifyingContract: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
      auctionId:
        '0x822d3d2e29ec9177022f05144423704928a5787080f6018f2f8ba107dca748ee',
      bidderPrivateKey: txAccounts[bidder.envName].privateKey,
      bidderNonce: '2',
    },
    auctioneerPublicKey: auctionOwnerSealPublicKey,
    bidderPublicKey: sealAccounts[bidder.envName].publicKey,
    version: 1,
  }));

  return { initial, extend, buyback };
}

function main() {
  const existingEnv = parseEnvFile(contractsEnvPath);
  const txAccounts = buildTransactionAccounts(existingEnv);
  const existingBidKeys = parseExistingBidKeys(bidKeysPath, txAccounts);
  const sealAccounts = buildSealAccounts(existingBidKeys);
  const auctionOwnerSealPrivateKey =
    existingEnv.AUCTION_OWNER_SEAL_PK || deriveFixturePrivateKey('AUCTION_OWNER_SEAL');
  const auctionOwnerSealPublicKey = deriveCompressedPublicKey(
    auctionOwnerSealPrivateKey,
  );

  writeIfMissing(
    contractsEnvPath,
    buildContractsEnv(existingEnv, txAccounts),
    'contracts environment file',
  );

  writeIfMissing(
    nbBondApiValuesPath,
    buildNbBondApiHelmValues(txAccounts, auctionOwnerSealPrivateKey),
    'NB Bond API Helm values file',
  );

  writeIfMissing(
    bidKeysPath,
    buildBidKeysJson(txAccounts, sealAccounts),
    'bid submitter key map',
  );

  const basicSeal = buildBasicSealExample(
    txAccounts,
    sealAccounts,
    auctionOwnerSealPublicKey,
  );
  const auctionSealExamples = buildAuctionSealExamples(
    txAccounts,
    sealAccounts,
    auctionOwnerSealPublicKey,
  );

  writeAlways(
    path.join(tmpBidExamplesRoot, 'basic/seal.example.json'),
    `${JSON.stringify(basicSeal, null, 2)}\n`,
    'local basic bid-encryption input',
  );
  writeAlways(
    path.join(tmpBidExamplesRoot, 'auctions/seal.initial.json'),
    `${JSON.stringify(auctionSealExamples.initial, null, 2)}\n`,
    'local initial-auction bid input',
  );
  writeAlways(
    path.join(tmpBidExamplesRoot, 'auctions/seal.extend.json'),
    `${JSON.stringify(auctionSealExamples.extend, null, 2)}\n`,
    'local extension-auction bid input',
  );
  writeAlways(
    path.join(tmpBidExamplesRoot, 'auctions/seal.buyback.json'),
    `${JSON.stringify(auctionSealExamples.buyback, null, 2)}\n`,
    'local buyback-auction bid input',
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
