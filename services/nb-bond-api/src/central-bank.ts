/**
 * Central Bank operations against the WNOK contract.
 *
 * The CB private key (`CENTRAL_BANK_PK`) is expected to hold
 * `MINTER_ROLE`, `BURNER_ROLE`, and `ALLOWLIST_ADMIN_ROLE` on WNOK —
 * matching the local deploy in
 * `contracts/script/norges-bank/03_Wnok.s.sol`, where `PK_NORGES_BANK`
 * is granted everything at construction.
 *
 * All write functions return a `TransactionRef` carrying the on-chain
 * tx hash + block. Reads (balance, allowlist) come straight from the
 * contract.
 *
 * Sandbox-only — the key sits in plaintext in env. The banner on the
 * Central Bank page is the user-facing warning.
 */
import {
  Contract,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  Wallet,
  getAddress,
} from 'ethers';

import { wnokAbi } from './abi';
import { getWnokAddress, provider } from './chain';
import { envVariables } from './env-vars';

export class CentralBankNotConfiguredError extends Error {
  constructor() {
    super('CENTRAL_BANK_PK is not configured; Central Bank endpoints are disabled');
    this.name = 'CentralBankNotConfiguredError';
  }
}

export class WnokUnavailableError extends Error {
  constructor(contractName: string) {
    super(`WNOK contract not registered under "${contractName}" in GlobalRegistry`);
    this.name = 'WnokUnavailableError';
  }
}

let cachedWallet: Wallet | null = null;
let cachedContract: Contract | null = null;

function getWallet(): Wallet {
  if (!envVariables.CENTRAL_BANK_PK) {
    throw new CentralBankNotConfiguredError();
  }
  if (!cachedWallet) {
    cachedWallet = new Wallet(envVariables.CENTRAL_BANK_PK, provider);
  }
  return cachedWallet;
}

async function getWnokContract(): Promise<Contract> {
  if (cachedContract) return cachedContract;
  // Fail fast on missing key BEFORE the chain lookup — avoids leaking
  // a JsonRpcProvider retry loop in tests that don't supply a CB key.
  const wallet = getWallet();
  const address = await getWnokAddress();
  if (!address) {
    throw new WnokUnavailableError(envVariables.WNOK_CONTRACT_NAME);
  }
  cachedContract = new Contract(address, wnokAbi, wallet);
  return cachedContract;
}

export interface TransactionRef {
  hash: string;
  block: number | null;
}

function toTxRef(
  tx: ContractTransactionResponse,
  receipt: ContractTransactionReceipt | null,
): TransactionRef {
  return { hash: tx.hash, block: receipt?.blockNumber ?? null };
}

/** True only when the CB key is set and WNOK is resolvable. */
export async function isCentralBankReady(): Promise<boolean> {
  if (!envVariables.CENTRAL_BANK_PK) return false;
  const address = await getWnokAddress();
  return address !== null;
}

export function getCbAddress(): string {
  return getWallet().address;
}

/** Read CB's own WNOK balance via the bound contract. */
export async function getCbWnokBalance(): Promise<bigint> {
  const wnok = await getWnokContract();
  const bal = (await wnok.balanceOf(getCbAddress())) as bigint;
  return bal;
}

/** Read the full WNOK allowlist (sandbox-scale; contract returns one array). */
export async function listAllowlist(): Promise<string[]> {
  const wnok = await getWnokContract();
  const addresses = (await wnok.allowlistQueryAll()) as string[];
  return addresses.map((a) => getAddress(a));
}

/** Check if a single address is on the allowlist. */
export async function isAllowlisted(address: string): Promise<boolean> {
  const wnok = await getWnokContract();
  return (await wnok.allowlistQuery(getAddress(address))) as boolean;
}

/**
 * Add an address to the WNOK allowlist. The contract is idempotent —
 * adding an already-listed address is a no-op (returns the tx ref
 * either way).
 */
export async function addToAllowlist(address: string): Promise<TransactionRef> {
  const wnok = await getWnokContract();
  const fn = wnok.add as unknown as (a: string) => Promise<ContractTransactionResponse>;
  const tx = await fn(getAddress(address));
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return toTxRef(tx, receipt);
}

/**
 * Remove an address from the WNOK allowlist. Contract is idempotent.
 */
export async function removeFromAllowlist(address: string): Promise<TransactionRef> {
  const wnok = await getWnokContract();
  const fn = wnok.remove as unknown as (a: string) => Promise<ContractTransactionResponse>;
  const tx = await fn(getAddress(address));
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return toTxRef(tx, receipt);
}

export async function mintWnok(to: string, amount: bigint): Promise<TransactionRef> {
  const wnok = await getWnokContract();
  const fn = wnok.mint as unknown as (a: string, b: bigint) => Promise<ContractTransactionResponse>;
  const tx = await fn(getAddress(to), amount);
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return toTxRef(tx, receipt);
}

export async function burnWnok(from: string, amount: bigint): Promise<TransactionRef> {
  const wnok = await getWnokContract();
  const fn = wnok.burn as unknown as (a: string, b: bigint) => Promise<ContractTransactionResponse>;
  const tx = await fn(getAddress(from), amount);
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return toTxRef(tx, receipt);
}

/**
 * Transfer WNOK from the CB account to `to`. The WNOK contract
 * enforces allowlist on both sender and receiver — the CB is
 * permanently allowlisted at deploy time, so this only fails if `to`
 * isn't yet on the allowlist.
 */
export async function transferWnokFromCb(to: string, amount: bigint): Promise<TransactionRef> {
  const wnok = await getWnokContract();
  const fn = wnok.transfer as unknown as (
    a: string,
    b: bigint,
  ) => Promise<ContractTransactionResponse>;
  const tx = await fn(getAddress(to), amount);
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return toTxRef(tx, receipt);
}
