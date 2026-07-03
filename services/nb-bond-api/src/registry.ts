/**
 * GlobalRegistry inventory.
 *
 * The GlobalRegistry (`contracts/src/common/GlobalRegistry.sol`) is a
 * name -> address mapping keyed by *hashed* names, so it cannot be
 * enumerated on-chain. The inventory is the union of two sources:
 *
 * - the canonical set of names the local deploy registers
 *   (`contracts/script/...`), which pins ordering and keeps the page
 *   alive when the chain's event history is unavailable, and
 * - every name recovered from the registry's own `ContractAdded` /
 *   `ContractUpdated` events, which picks up runtime registrations —
 *   e.g. the "TBD <name>" entries written when a bank is created from
 *   the Banking page.
 */
import { getAddress } from 'ethers';

import { listRegistryEventNames, resolveRegisteredAddress } from './chain';
import { envVariables } from './env-vars';

export interface RegisteredContract {
  name: string;
  address: string;
}

// Canonical registry names from the local deploy. The four the API already
// configures follow their env vars; the rest match contracts/.env literally.
export const REGISTRY_CONTRACT_NAMES: readonly string[] = [
  envVariables.WNOK_CONTRACT_NAME,
  envVariables.BOND_MANAGER_CONTRACT_NAME,
  'Bond Auction',
  'Bond Token',
  'Bond Delivery vs Payment',
  envVariables.TBD_NORDEA_CONTRACT_NAME,
  envVariables.TBD_DNB_CONTRACT_NAME,
  envVariables.DVP_CONTRACT_NAME,
  'Order Book',
  'StockToken Factory',
  'Pareto Broker',
  'DNB Markets Broker',
];

/**
 * List contracts registered in the GlobalRegistry: the canonical name set
 * (stable, first) plus any extra names discovered from the registry's
 * events (runtime registrations, in first-seen order). Every name is
 * forward-resolved so updated entries report their current address;
 * names that don't resolve (not deployed) are omitted. The
 * GlobalRegistry's own address is surfaced first.
 */
export async function listRegisteredContracts(): Promise<RegisteredContract[]> {
  const eventNames = await listRegistryEventNames();
  const names = [...REGISTRY_CONTRACT_NAMES];
  for (const name of eventNames) {
    if (!names.includes(name)) names.push(name);
  }
  const resolved = await Promise.all(
    names.map(async (name) => {
      const address = await resolveRegisteredAddress(name);
      return address ? { name, address: getAddress(address) } : null;
    }),
  );
  return [
    { name: 'Global Registry', address: getAddress(envVariables.GLOBAL_REGISTRY_ADDRESS) },
    ...resolved.filter((e): e is RegisteredContract => e !== null),
  ];
}
