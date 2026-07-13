/**
 * Banking — read surface over the per-bank TBD (tokenized bank deposit)
 * tokens. Each commercial bank owns one allowlist-gated, WNOK-reserve-backed
 * ERC-20 (decimals = 0), registered in GlobalRegistry by name.
 *
 * The roster is the configured local-sandbox banks (TBD_BANKS) merged with
 * the banks created from the Banking page (`banks` system-of-record table,
 * see banks.ts). Both resolve their TBD address from GlobalRegistry by
 * contract name, so a bank whose TBD is not (yet / any longer) registered
 * simply drops out of the listing.
 *
 * Reads are live chain calls (no projection), mirroring central-bank.ts.
 * Mutations sign with the owning bank's key — derived deterministically the
 * same way as the bidder roster (bidders.ts) for configured banks, stored
 * in SQLite for created banks.
 *
 * Sandbox-only.
 */
import {
  Contract,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  Wallet,
  getAddress,
} from 'ethers';

import { tbdAbi } from './abi';
import { deriveBidderAddress, deriveFixturePrivateKey } from './bidders';
import { getBondManager, getWnok, provider, resolveRegisteredAddress } from './chain';
import { envVariables } from './env-vars';
import { withMd5 } from './http';
import { type IngestionDatabase, listBankRows } from './ingestion-db';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * The local-sandbox bank roster. `role` is the fixture key role used by
 * `scripts/generate-local-sandbox-fixtures.mjs` and bidders.ts — it drives
 * per-bank signing for the (later) mutation surface. `contractName` is the
 * GlobalRegistry key the TBD is registered under.
 */
export const TBD_BANKS: ReadonlyArray<{ bankName: string; role: string; contractName: string }> = [
  {
    bankName: 'Nordea Bank',
    role: 'PK_NORDEA',
    contractName: envVariables.TBD_NORDEA_CONTRACT_NAME,
  },
  { bankName: 'DNB Bank', role: 'PK_DNB', contractName: envVariables.TBD_DNB_CONTRACT_NAME },
];

/** One bank the operator can act as: label, registry key, and signing key. */
interface BankRosterEntry {
  bankName: string;
  contractName: string;
  privateKey: string;
}

/** The full roster: configured fixture banks + banks created from the UI. */
function bankRoster(createdBanksDb: IngestionDatabase | null): BankRosterEntry[] {
  const configured = TBD_BANKS.map((b) => ({
    bankName: b.bankName,
    contractName: b.contractName,
    privateKey: deriveFixturePrivateKey(b.role),
  }));
  const created = createdBanksDb
    ? listBankRows(createdBanksDb).map((r) => ({
        bankName: r.name,
        contractName: r.contract_name,
        privateKey: r.private_key,
      }))
    : [];
  return [...configured, ...created];
}

export interface TbdHolderData {
  address: string;
  balance: string;
}

/** Read one TBD contract and compose its enriched, md5-stamped DTO. */
async function composeToken(bankName: string, address: string) {
  const tbd = new Contract(address, tbdAbi, provider);
  const [name, symbol, decimalsRaw, totalSupplyRaw, bankAddrRaw, govReserveRaw, allowlistRaw] =
    await Promise.all([
      tbd.name() as Promise<string>,
      tbd.symbol() as Promise<string>,
      tbd.decimals() as Promise<bigint>,
      tbd.totalSupply() as Promise<bigint>,
      tbd.getBankAddress() as Promise<string>,
      tbd.govReserve() as Promise<string>,
      tbd.allowlistQueryAll() as Promise<string[]>,
    ]);

  const bankAddress = getAddress(bankAddrRaw);

  const holderAddrs = allowlistRaw.map((a) => getAddress(a));
  const balances = await Promise.all(holderAddrs.map((a) => tbd.balanceOf(a) as Promise<bigint>));
  const holders: TbdHolderData[] = holderAddrs.map((a, i) => ({
    address: a,
    balance: balances[i].toString(),
  }));

  // Reserve backing: the owning bank's WNOK balance vs the TBD supply.
  // Informational only — 1:1 backing is not enforced on-chain.
  let reserve: { wnokBalance: string; backed: boolean; bankAllowlisted: boolean } | null = null;
  const wnok = await getWnok(provider).catch(() => null);
  if (wnok) {
    const [wnokBalance, bankAllowlisted] = await Promise.all([
      (wnok.balanceOf(bankAddress) as Promise<bigint>).catch(() => 0n),
      (wnok.allowlistQuery(bankAddress) as Promise<boolean>).catch(() => false),
    ]);
    reserve = {
      wnokBalance: wnokBalance.toString(),
      backed: wnokBalance >= totalSupplyRaw,
      bankAllowlisted,
    };
  }

  const govReserve = getAddress(govReserveRaw);
  const nominated = govReserve !== ZERO_ADDRESS;

  return withMd5({
    address: getAddress(address),
    name,
    symbol,
    decimals: Number(decimalsRaw),
    totalSupply: totalSupplyRaw.toString(),
    bank: { name: bankName, address: bankAddress },
    reserve,
    government: { nominated, reserveAddress: nominated ? govReserve : null },
    holders,
  });
}

/** Resolve each roster bank's TBD address; skips any not registered. */
async function resolveRosterTbds(
  createdBanksDb: IngestionDatabase | null,
): Promise<{ bankName: string; privateKey: string; address: string }[]> {
  const resolved = await Promise.all(
    bankRoster(createdBanksDb).map(async (b) => {
      const address = await resolveRegisteredAddress(b.contractName);
      return address
        ? { bankName: b.bankName, privateKey: b.privateKey, address: getAddress(address) }
        : null;
    }),
  );
  return resolved.filter(
    (r): r is { bankName: string; privateKey: string; address: string } => r !== null,
  );
}

/** Read every roster TBD token (configured + created). */
export async function listTbdTokens(createdBanksDb: IngestionDatabase | null = null) {
  const present = await resolveRosterTbds(createdBanksDb);
  return Promise.all(present.map((r) => composeToken(r.bankName, r.address)));
}

/** Read one TBD by contract address. Returns null when it isn't a roster TBD. */
export async function getTbdToken(
  address: string,
  createdBanksDb: IngestionDatabase | null = null,
) {
  let target: string;
  try {
    target = getAddress(address);
  } catch {
    return null;
  }
  const present = await resolveRosterTbds(createdBanksDb);
  const match = present.find((r) => r.address === target);
  return match ? composeToken(match.bankName, match.address) : null;
}

// ── Mutations ───────────────────────────────────────────────────────
// Signed by the TBD's OWNING bank — the only key holding MINTER / BURNER /
// ALLOWLIST_ADMIN on that token. Configured banks derive their key the same
// way as the bidder roster; created banks read theirs from SQLite.
// Each write returns null when the address isn't a roster TBD (route 404s).
// Sandbox-only.

export interface TbdTransactionRef {
  hash: string;
  block: number | null;
}

async function tbdWriteContract(
  address: string,
  createdBanksDb: IngestionDatabase | null,
): Promise<Contract | null> {
  let target: string;
  try {
    target = getAddress(address);
  } catch {
    return null;
  }
  const match = (await resolveRosterTbds(createdBanksDb)).find((r) => r.address === target);
  if (!match) return null;
  const wallet = new Wallet(match.privateKey, provider);
  return new Contract(match.address, tbdAbi, wallet);
}

async function sendTbdTx(
  address: string,
  invoke: (tbd: Contract) => Promise<ContractTransactionResponse>,
  createdBanksDb: IngestionDatabase | null,
): Promise<TbdTransactionRef | null> {
  const tbd = await tbdWriteContract(address, createdBanksDb);
  if (!tbd) return null;
  const tx = await invoke(tbd);
  const receipt = (await tx.wait()) as ContractTransactionReceipt | null;
  return { hash: tx.hash, block: receipt?.blockNumber ?? null };
}

export function addTbdAllowlist(
  address: string,
  holder: string,
  createdBanksDb: IngestionDatabase | null = null,
) {
  return sendTbdTx(
    address,
    (tbd) => {
      const fn = tbd.add as unknown as (a: string) => Promise<ContractTransactionResponse>;
      return fn(getAddress(holder));
    },
    createdBanksDb,
  );
}

export function removeTbdAllowlist(
  address: string,
  holder: string,
  createdBanksDb: IngestionDatabase | null = null,
) {
  return sendTbdTx(
    address,
    (tbd) => {
      const fn = tbd.remove as unknown as (a: string) => Promise<ContractTransactionResponse>;
      return fn(getAddress(holder));
    },
    createdBanksDb,
  );
}

export function mintTbd(
  address: string,
  to: string,
  amount: bigint,
  createdBanksDb: IngestionDatabase | null = null,
) {
  return sendTbdTx(
    address,
    (tbd) => {
      const fn = tbd.mint as unknown as (
        a: string,
        b: bigint,
      ) => Promise<ContractTransactionResponse>;
      return fn(getAddress(to), amount);
    },
    createdBanksDb,
  );
}

export function burnTbd(
  address: string,
  from: string,
  amount: bigint,
  createdBanksDb: IngestionDatabase | null = null,
) {
  return sendTbdTx(
    address,
    (tbd) => {
      const fn = tbd.burn as unknown as (
        a: string,
        b: bigint,
      ) => Promise<ContractTransactionResponse>;
      return fn(getAddress(from), amount);
    },
    createdBanksDb,
  );
}

export function transferTbd(
  address: string,
  to: string,
  amount: bigint,
  createdBanksDb: IngestionDatabase | null = null,
) {
  return sendTbdTx(
    address,
    (tbd) => {
      const fn = tbd.transfer as unknown as (
        a: string,
        b: bigint,
      ) => Promise<ContractTransactionResponse>;
      return fn(getAddress(to), amount);
    },
    createdBanksDb,
  );
}

/**
 * The banks the operator can act as (configured + created). Addresses
 * only — keys stay server-side.
 */
export function listBanks(
  createdBanksDb: IngestionDatabase | null = null,
): { name: string; address: string }[] {
  return bankRoster(createdBanksDb).map((b) => ({
    name: b.bankName,
    address: deriveBidderAddress(b.privateKey),
  }));
}

/**
 * The bank whose tokenized deposit (TBD) settles government bond payments —
 * `BondManager.GOV_TBD` resolved against the roster. Name is `'Unknown'`
 * when GOV_TBD points at a TBD that is not in the roster.
 */
export async function getGovSettlementBank(
  createdBanksDb: IngestionDatabase | null = null,
): Promise<{ name: string; address: string }> {
  const manager = await getBondManager();
  const govTbd = getAddress((await manager.GOV_TBD()) as string);
  const tbds = await resolveRosterTbds(createdBanksDb);
  const match = tbds.find((t) => t.address === govTbd);
  return { name: match?.bankName ?? 'Unknown', address: govTbd };
}

/** Explicitly bound banking operations for one application/database instance. */
export function createBankingService(createdBanksDb: IngestionDatabase) {
  return {
    listTbdTokens: () => listTbdTokens(createdBanksDb),
    getTbdToken: (address: string) => getTbdToken(address, createdBanksDb),
    addTbdAllowlist: (address: string, holder: string) =>
      addTbdAllowlist(address, holder, createdBanksDb),
    removeTbdAllowlist: (address: string, holder: string) =>
      removeTbdAllowlist(address, holder, createdBanksDb),
    mintTbd: (address: string, to: string, amount: bigint) =>
      mintTbd(address, to, amount, createdBanksDb),
    burnTbd: (address: string, from: string, amount: bigint) =>
      burnTbd(address, from, amount, createdBanksDb),
    transferTbd: (address: string, to: string, amount: bigint) =>
      transferTbd(address, to, amount, createdBanksDb),
    listBanks: () => listBanks(createdBanksDb),
    getGovSettlementBank: () => getGovSettlementBank(createdBanksDb),
  };
}
