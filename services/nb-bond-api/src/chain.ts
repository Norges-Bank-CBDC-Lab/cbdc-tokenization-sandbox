import { Contract, JsonRpcProvider, TransactionReceipt, TransactionResponse, Wallet } from 'ethers';
import { bondAuctionAbi, bondManagerAbi, bondTokenAbi, globalRegistryAbi } from './abi';
import { envVariables } from './env-vars';

export const provider = new JsonRpcProvider(envVariables.RPC_URL);

const wallet = new Wallet(envVariables.BOND_ADMIN_PK, provider);
export const signer = wallet;

export class RegistryResolutionError extends Error {
  readonly registryAddress: string;
  readonly contractName: string;
  readonly code: string;

  constructor(message: string, registryAddress: string, contractName: string) {
    super(message);
    this.name = 'RegistryResolutionError';
    this.code = 'REGISTRY_CONTRACT_NOT_FOUND';
    this.registryAddress = registryAddress;
    this.contractName = contractName;
  }
}

export class RpcUnavailableError extends Error {
  readonly rpcUrl: string;
  readonly code: string;

  constructor(message: string, rpcUrl: string) {
    super(message);
    this.name = 'RpcUnavailableError';
    this.code = 'RPC_UNAVAILABLE';
    this.rpcUrl = rpcUrl;
  }
}

const registry = new Contract(envVariables.GLOBAL_REGISTRY_ADDRESS, globalRegistryAbi, provider);
let bondManager: Contract | null = null;

let bondAuction: Contract | null = null;
let bondToken: Contract | null = null;

let cachedNonce: number | null = null;
let nonceMutex: Promise<void> = Promise.resolve();

async function withNonceLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = nonceMutex;
  nonceMutex = previous.then(() => next);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function nextNonce(): Promise<number> {
  const address = await wallet.getAddress();
  if (cachedNonce === null) {
    cachedNonce = await provider.getTransactionCount(address, 'pending');
  }
  return cachedNonce;
}

export async function sendWithManagedNonce(
  send: (nonce: number) => Promise<TransactionResponse>,
): Promise<{ tx: TransactionResponse; receipt: TransactionReceipt | null }> {
  return withNonceLock(async () => {
    const nonce = await nextNonce();
    try {
      const tx = await send(nonce);
      const receipt = await tx.wait();
      cachedNonce = nonce + 1;
      return { tx, receipt };
    } catch (err) {
      cachedNonce = null; // reload from chain on next send to avoid gaps after failures
      throw err;
    }
  });
}

async function assertProviderReady() {
  try {
    await provider.getBlockNumber();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RpcUnavailableError(`RPC unavailable: ${message}`, envVariables.RPC_URL);
  }
}

export async function getBondManagerAddress(): Promise<string> {
  await assertProviderReady();
  const [found, address] = await registry.tryGetContract(envVariables.BOND_MANAGER_CONTRACT_NAME);
  if (!found) {
    throw new RegistryResolutionError(
      'BondManager not found in GlobalRegistry',
      envVariables.GLOBAL_REGISTRY_ADDRESS,
      envVariables.BOND_MANAGER_CONTRACT_NAME,
    );
  }
  return address;
}

export async function getBondManager(): Promise<Contract> {
  if (bondManager) {
    return bondManager;
  }

  const address = await getBondManagerAddress();
  bondManager = new Contract(address, bondManagerAbi, signer);
  return bondManager;
}

export async function getBondAuctionAddress(): Promise<string> {
  if (bondAuction) {
    return bondAuction.target.toString();
  }
  const manager = await getBondManager();
  return manager.BOND_AUCTION();
}

export async function getBondAuction(): Promise<Contract> {
  if (bondAuction) {
    return bondAuction;
  }
  const address = await getBondAuctionAddress();
  bondAuction = new Contract(address, bondAuctionAbi, signer);
  return bondAuction;
}

export async function getBondToken(): Promise<Contract> {
  if (bondToken) {
    return bondToken;
  }
  const manager = await getBondManager();
  const address = await manager.BOND_TOKEN();
  bondToken = new Contract(address, bondTokenAbi, signer);
  return bondToken;
}
