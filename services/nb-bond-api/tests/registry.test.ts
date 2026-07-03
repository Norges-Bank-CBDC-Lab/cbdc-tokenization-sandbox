/**
 * GlobalRegistry inventory tests.
 *
 * Like banking-tbd, registry is a thin chain wrapper — live resolution is
 * covered by the curl verification, not jest (which boots against a no-op
 * provider). Here we pin the drift-prone surfaces: the canonical name set,
 * and the union with names discovered from the registry's events (runtime
 * registrations such as banks created from the Banking page). The four
 * env-backed names resolve to their defaults under test.
 */
import { getAddress } from 'ethers';

import { REGISTRY_CONTRACT_NAMES, listRegisteredContracts } from '../src/registry';
import { listRegistryEventNames, resolveRegisteredAddress } from '../src/chain';

jest.mock('../src/chain', () => ({
  listRegistryEventNames: jest.fn(),
  resolveRegisteredAddress: jest.fn(),
}));

const eventNamesMock = listRegistryEventNames as jest.MockedFunction<typeof listRegistryEventNames>;
const resolveMock = resolveRegisteredAddress as jest.MockedFunction<
  typeof resolveRegisteredAddress
>;

const ADDR_A = '0x00000000000000000000000000000000000000aa';
const ADDR_B = '0x00000000000000000000000000000000000000bb';

describe('listRegisteredContracts', () => {
  beforeEach(() => {
    eventNamesMock.mockReset();
    resolveMock.mockReset();
  });

  it('appends event-discovered names after the canonical set, deduplicated', async () => {
    eventNamesMock.mockResolvedValue(['TBD Nordea', 'TBD Sparebank Test']);
    resolveMock.mockImplementation(async (name) => {
      if (name === 'TBD Nordea') return ADDR_A;
      if (name === 'TBD Sparebank Test') return ADDR_B;
      return null; // everything else unresolved → omitted
    });

    const contracts = await listRegisteredContracts();
    const names = contracts.map((c) => c.name);

    // Registry itself first, then the resolvable canonical entry, then the
    // runtime-registered extra — no duplicate for the canonical TBD Nordea.
    expect(names).toEqual(['Global Registry', 'TBD Nordea', 'TBD Sparebank Test']);
    expect(names.filter((n) => n === 'TBD Nordea')).toHaveLength(1);
    // Addresses are checksummed on the way out.
    expect(contracts[2].address).toBe(getAddress(ADDR_B));
  });

  it('falls back to the canonical set when the event scan yields nothing', async () => {
    eventNamesMock.mockResolvedValue([]);
    resolveMock.mockImplementation(async (name) => (name === 'Bond Manager' ? ADDR_A : null));

    const contracts = await listRegisteredContracts();

    expect(contracts.map((c) => c.name)).toEqual(['Global Registry', 'Bond Manager']);
    // Every canonical name was attempted exactly once.
    expect(resolveMock).toHaveBeenCalledTimes(REGISTRY_CONTRACT_NAMES.length);
  });
});

describe('registry canonical names', () => {
  it('pins the contracts the local deploy registers', () => {
    expect([...REGISTRY_CONTRACT_NAMES]).toEqual([
      'Wholesale NOK',
      'Bond Manager',
      'Bond Auction',
      'Bond Token',
      'Bond Delivery vs Payment',
      'TBD Nordea',
      'TBD DNB',
      'Delivery vs Payment',
      'Order Book',
      'StockToken Factory',
      'Pareto Broker',
      'DNB Markets Broker',
    ]);
  });

  it('has no duplicate names', () => {
    expect(new Set(REGISTRY_CONTRACT_NAMES).size).toBe(REGISTRY_CONTRACT_NAMES.length);
  });
});
