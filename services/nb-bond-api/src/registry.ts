/**
 * GlobalRegistry inventory.
 *
 * The GlobalRegistry (`contracts/src/common/GlobalRegistry.sol`) is a
 * name -> address mapping keyed by *hashed* names, so it cannot be
 * enumerated on-chain. We forward-resolve the canonical set of names the
 * local deploy registers (`contracts/script/...`). A fully-dynamic list
 * would instead index the GlobalRegistry `ContractAdded` /
 * `ContractUpdated` events.
 */
import { getAddress } from 'ethers';

import { resolveRegisteredAddress } from './chain';
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
 * List contracts registered in the GlobalRegistry, resolved from the
 * canonical name set. The GlobalRegistry's own address is surfaced first;
 * names that don't resolve (not deployed) are omitted.
 */
export async function listRegisteredContracts(): Promise<RegisteredContract[]> {
  const resolved = await Promise.all(
    REGISTRY_CONTRACT_NAMES.map(async (name) => {
      const address = await resolveRegisteredAddress(name);
      return address ? { name, address: getAddress(address) } : null;
    }),
  );
  return [
    { name: 'Global Registry', address: getAddress(envVariables.GLOBAL_REGISTRY_ADDRESS) },
    ...resolved.filter((e): e is RegisteredContract => e !== null),
  ];
}
