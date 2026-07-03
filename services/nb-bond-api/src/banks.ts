/**
 * Created banks — the deploy-a-bank-from-the-UI flow behind
 * POST /v1/banking/banks.
 *
 * Creating a bank:
 *   1. generates (or imports) the bank's secp256k1 keypair — the chain has
 *      a zero-base-fee genesis, so the fresh key can sign transactions
 *      without funding (same property the impersonated-bid flow relies on),
 *   2. deploys a fresh Tbd contract (contracts/src/private-bank/Tbd.sol)
 *      signed by the bank's own key, so the bank address holds
 *      admin / minter / burner on its token — exactly like the configured
 *      fixture banks deployed by contracts/script/private-bank/04_Tbd.s.sol,
 *   3. registers "TBD <name>" in GlobalRegistry signed by the Central Bank
 *      key (the registry owner IS the CB account in the local deploy),
 *   4. optionally adds the bank address to the WNOK allowlist so it can
 *      hold the WNOK reserve and settle cross-bank (same call as the
 *      central-bank allowlist PUT route),
 *   5. persists the bank in the `banks` system-of-record table so the
 *      roster in banking-tbd.ts picks it up for listing and mutations.
 *
 * Sandbox-only: private keys are stored in plaintext, matching the bidder
 * roster precedent. Never deploy this configuration against real funds.
 */
import {
  Contract,
  ContractFactory,
  type ContractTransactionResponse,
  Interface,
  type InterfaceAbi,
  Wallet,
  getAddress,
} from 'ethers';

import { globalRegistryAbi, tbdAbi, tbdBytecode, wnokAbi } from './abi';
import { TBD_BANKS } from './banking-tbd';
import { deriveBidderAddress, generateBidderPrivateKey } from './bidders';
import { WnokUnavailableError, addToAllowlist, getCbWallet } from './central-bank';
import { decodeCustomError, getWnokAddress, provider, resolveRegisteredAddress } from './chain';
import { envVariables } from './env-vars';
import {
  type BankRow,
  type IngestionDatabase,
  getBankRowByAddress,
  getBankRowByName,
  insertBankRow,
  listBankRows,
} from './ingestion-db';
import { logger } from './logger';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class BankValidationError extends Error {
  constructor(
    message: string,
    public readonly field: 'name' | 'privateKey',
  ) {
    super(message);
    this.name = 'BankValidationError';
  }
}

export class BankConflictError extends Error {
  constructor(
    message: string,
    public readonly field: 'name' | 'address',
  ) {
    super(message);
    this.name = 'BankConflictError';
  }
}

/** DvP is a required Tbd constructor arg; without it no bank can be created. */
export class DvpUnavailableError extends Error {
  constructor(contractName: string) {
    super(`DvP contract not registered under "${contractName}" in GlobalRegistry`);
    this.name = 'DvpUnavailableError';
  }
}

export interface CreateBankInput {
  name: string;
  privateKey?: string;
  enableWnokSettlement?: boolean;
}

export interface CreatedBankRecord {
  name: string;
  address: string;
  privateKey: string;
  contractName: string;
  tbdAddress: string;
  createdAt: number;
}

/** GlobalRegistry key a bank's TBD is registered under — same "TBD <name>" shape as the fixtures. */
export function contractNameForBank(name: string): string {
  return `TBD ${name}`;
}

/**
 * Symbol derivation rule: "TBD" + the bank name with every non-alphanumeric
 * character stripped, upper-cased, truncated to 8 characters. Examples:
 * "Sparebanken Norge" → "TBDSPAREBAN" (TBD + SPAREBAN), "SR-Bank 1" →
 * "TBDSRBANK1". Falls back to "TBDBANK" when nothing alphanumeric survives.
 */
export function deriveTbdSymbol(name: string): string {
  const compact = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return `TBD${compact || 'BANK'}`;
}

function normalizeBankPrivateKey(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new BankValidationError(
      'private key must be 32-byte hex (0x-prefixed, 64 hex chars)',
      'privateKey',
    );
  }
  return `0x${hex.toLowerCase()}`;
}

function rowToRecord(row: BankRow): CreatedBankRecord {
  return {
    name: row.name,
    address: row.address,
    privateKey: row.private_key,
    contractName: row.contract_name,
    tbdAddress: row.tbd_address,
    createdAt: row.created_at,
  };
}

export function listCreatedBanks(db: IngestionDatabase): CreatedBankRecord[] {
  return listBankRows(db).map(rowToRecord);
}

/**
 * Chain side of bank creation, injectable so tests can exercise the
 * orchestration without a live RPC (jest boots against a no-op provider).
 * The default implementation is the real ethers plumbing below.
 */
export interface CreateBankChainOps {
  isRegistryNameTaken(contractName: string): Promise<boolean>;
  resolveWnok(): Promise<string | null>;
  resolveDvp(): Promise<string | null>;
  /** Deploy Tbd signed by the bank's own key; returns the contract address. */
  deployTbd(args: {
    privateKey: string;
    bank: string;
    wnok: string;
    dvp: string;
    name: string;
    symbol: string;
  }): Promise<string>;
  /** GlobalRegistry.setContract signed by the Central Bank (registry owner). */
  registerContract(contractName: string, address: string): Promise<void>;
  /** WNOK allowlist add signed by the Central Bank (same call as the PUT route). */
  addBankToWnokAllowlist(address: string): Promise<void>;
}

// Decode Solidity custom-error reverts from any contract this flow touches
// into a readable message instead of raw revert bytes.
function decodeInterfaces(): Interface[] {
  return [
    new Interface(tbdAbi as InterfaceAbi),
    new Interface(globalRegistryAbi as InterfaceAbi),
    new Interface(wnokAbi as InterfaceAbi),
  ];
}

async function withDecodedRevert<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Rethrow the original error (stack preserved) with the decoded custom
    // error prepended so the 500 detail names the revert, not raw bytes.
    const errorName = decodeCustomError(err, decodeInterfaces());
    if (errorName && err instanceof Error) {
      err.message = `${operation} reverted with ${errorName}: ${err.message}`;
    }
    throw err;
  }
}

export const defaultCreateBankChainOps: CreateBankChainOps = {
  async isRegistryNameTaken(contractName) {
    return (await resolveRegisteredAddress(contractName)) !== null;
  },
  async resolveWnok() {
    return getWnokAddress();
  },
  async resolveDvp() {
    return resolveRegisteredAddress(envVariables.DVP_CONTRACT_NAME);
  },
  async deployTbd(args) {
    // The bank's own wallet deploys, mirroring 04_Tbd.s.sol's
    // (admin = bank, bank = bank, govReserve = 0) shape used for DNB.
    // Fresh keys start at nonce 0 and the zero-base-fee genesis means no
    // funding is needed, so no cross-request nonce coordination applies.
    const bankWallet = new Wallet(args.privateKey, provider);
    const factory = new ContractFactory(tbdAbi as InterfaceAbi, tbdBytecode, bankWallet);
    const contract = await withDecodedRevert('Tbd deploy', () =>
      factory
        .deploy(args.bank, args.bank, args.wnok, args.dvp, args.name, args.symbol, ZERO_ADDRESS)
        .then(async (c) => {
          await c.waitForDeployment();
          return c;
        }),
    );
    return getAddress(await contract.getAddress());
  },
  async registerContract(contractName, address) {
    const registry = new Contract(
      envVariables.GLOBAL_REGISTRY_ADDRESS,
      globalRegistryAbi,
      getCbWallet(),
    );
    const fn = registry.setContract as unknown as (
      n: string,
      a: string,
    ) => Promise<ContractTransactionResponse>;
    await withDecodedRevert('GlobalRegistry.setContract', async () => {
      const tx = await fn(contractName, address);
      await tx.wait();
    });
  },
  async addBankToWnokAllowlist(address) {
    await withDecodedRevert('WNOK allowlist add', async () => {
      await addToAllowlist(address);
    });
  },
};

/**
 * Create a bank: validate + uniqueness-check, deploy its TBD, register it
 * in GlobalRegistry, optionally allowlist it on WNOK, persist the roster
 * row. Throws `BankValidationError` on bad input, `BankConflictError` when
 * the name / address is taken, `CentralBankNotConfiguredError` when the CB
 * key is unset, and `WnokUnavailableError` / `DvpUnavailableError` when a
 * constructor dependency is not registered.
 */
export async function createBank(
  db: IngestionDatabase,
  input: CreateBankInput,
  ops: CreateBankChainOps = defaultCreateBankChainOps,
): Promise<CreatedBankRecord> {
  // Registration is CB-signed; fail fast (503) before any chain work.
  // getCbWallet throws CentralBankNotConfiguredError when the key is unset.
  getCbWallet();

  const name = input.name?.trim();
  if (!name) {
    throw new BankValidationError('name is required', 'name');
  }
  if (name.length > 64) {
    throw new BankValidationError('name must be at most 64 characters', 'name');
  }

  const privateKey = normalizeBankPrivateKey(input.privateKey ?? generateBidderPrivateKey());
  let address: string;
  try {
    address = deriveBidderAddress(privateKey);
  } catch {
    throw new BankValidationError('private key is not a valid secp256k1 key', 'privateKey');
  }

  const contractName = contractNameForBank(name);

  // Uniqueness: configured roster, created roster, then the registry itself
  // (covers anything registered outside this API's rosters).
  const configuredClash = TBD_BANKS.some(
    (b) =>
      b.bankName.toLowerCase() === name.toLowerCase() ||
      b.contractName.toLowerCase() === contractName.toLowerCase(),
  );
  if (configuredClash) {
    throw new BankConflictError(`bank name "${name}" collides with a configured bank`, 'name');
  }
  if (getBankRowByName(db, name)) {
    throw new BankConflictError(`bank name "${name}" already exists`, 'name');
  }
  if (getBankRowByAddress(db, address)) {
    throw new BankConflictError(`bank address ${address} already exists`, 'address');
  }
  if (await ops.isRegistryNameTaken(contractName)) {
    throw new BankConflictError(
      `"${contractName}" is already registered in GlobalRegistry`,
      'name',
    );
  }

  // Tbd's constructor rejects zero wnok / dvp addresses, so resolve both
  // up front and 503 rather than burn a deploy on a guaranteed revert.
  const wnok = await ops.resolveWnok();
  if (!wnok) {
    throw new WnokUnavailableError(envVariables.WNOK_CONTRACT_NAME);
  }
  const dvp = await ops.resolveDvp();
  if (!dvp) {
    throw new DvpUnavailableError(envVariables.DVP_CONTRACT_NAME);
  }

  const symbol = deriveTbdSymbol(name);
  const tbdAddress = await ops.deployTbd({
    privateKey,
    bank: address,
    wnok,
    dvp,
    name: contractName,
    symbol,
  });
  await ops.registerContract(contractName, tbdAddress);

  if (input.enableWnokSettlement ?? true) {
    await ops.addBankToWnokAllowlist(address);
  }

  const row: BankRow = {
    address,
    name,
    private_key: privateKey,
    contract_name: contractName,
    tbd_address: tbdAddress,
    created_at: Date.now(),
  };
  insertBankRow(db, row);
  logger.info(`created bank "${name}" (${address}) with TBD ${tbdAddress} as "${contractName}"`);
  return rowToRecord(row);
}
