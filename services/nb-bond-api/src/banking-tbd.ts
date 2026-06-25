/**
 * Banking — read surface over the per-bank TBD (tokenized bank deposit)
 * tokens. Each commercial bank owns one allowlist-gated, WNOK-reserve-backed
 * ERC-20 (decimals = 0), registered in GlobalRegistry by name.
 *
 * Discovery is a config list for now (the local-sandbox banks). When
 * deploy-from-UI lands this moves to GlobalRegistry enumeration — see
 * docs/plans/nav-categories-and-tbd-page-plan.md (D7).
 *
 * Reads are live chain calls (no projection), mirroring central-bank.ts.
 * Mutations (a later increment) sign with the owning bank's key, derived
 * deterministically the same way as the bidder roster (bidders.ts).
 *
 * Sandbox-only.
 */
import { Contract, getAddress } from 'ethers';

import { tbdAbi } from './abi';
import { getWnok, provider, resolveRegisteredAddress } from './chain';
import { envVariables } from './env-vars';
import { withMd5 } from './http';

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
  let reserve: { wnokBalance: string; backed: boolean } | null = null;
  const wnok = await getWnok(provider).catch(() => null);
  if (wnok) {
    const wnokBalance = await (wnok.balanceOf(bankAddress) as Promise<bigint>).catch(() => 0n);
    reserve = { wnokBalance: wnokBalance.toString(), backed: wnokBalance >= totalSupplyRaw };
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

/** Resolve each configured bank's TBD address; skips any not registered. */
async function resolveConfiguredTbds(): Promise<{ bankName: string; address: string }[]> {
  const resolved = await Promise.all(
    TBD_BANKS.map(async (b) => {
      const address = await resolveRegisteredAddress(b.contractName);
      return address ? { bankName: b.bankName, address: getAddress(address) } : null;
    }),
  );
  return resolved.filter((r): r is { bankName: string; address: string } => r !== null);
}

/** Read every configured TBD token. */
export async function listTbdTokens() {
  const present = await resolveConfiguredTbds();
  return Promise.all(present.map((r) => composeToken(r.bankName, r.address)));
}

/** Read one TBD by contract address. Returns null when it isn't a configured TBD. */
export async function getTbdToken(address: string) {
  let target: string;
  try {
    target = getAddress(address);
  } catch {
    return null;
  }
  const present = await resolveConfiguredTbds();
  const match = present.find((r) => r.address === target);
  return match ? composeToken(match.bankName, match.address) : null;
}
