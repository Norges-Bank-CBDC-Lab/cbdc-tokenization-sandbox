import { existsSync, readFileSync } from "fs";
import path from "path";
import process from "process";

import {
  Contract,
  ContractTransactionReceipt,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isHexString,
} from "ethers";

import { bondAuctionAbi } from "./abi";

interface CliArgs {
  sealedBidsPath: string;
  keysPath: string;
  bondAuction: string;
  rpcUrl: string;
  auctionId: string;
}

interface SealedBid {
  ciphertext: string;
  plaintextHash: string;
  bidder: string;
  ciphertextHash?: string;
  bidderNonce?: string;
  bidderSig?: string;
}

interface KeyEntry {
  privateKey: string;
}

type KeyMap = Map<string, string>;

const usage = `Usage:
  tsx src/index.ts --sealed-bids <path> --keys <path> --bond-auction <address> --auction-id <bytes32> --rpc-url <url>

Arguments:
  --sealed-bids   Path to JSON containing ciphertext(s) (single object or array)
  --keys          Path to JSON mapping bidder addresses to { "privateKey": "0x..." }
  --bond-auction  BondAuction contract address
  --auction-id    Auction ID (bytes32 hex string) returned from createAuction/buybackWithAuction
  --rpc-url       RPC endpoint to submit transactions`;

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const sealedBids = loadSealedBids(args.sealedBidsPath);
    const keyMap = loadKeys(args.keysPath);
    const provider = new JsonRpcProvider(args.rpcUrl);
    const contract = new Contract(args.bondAuction, bondAuctionAbi, provider);

    for (let i = 0; i < sealedBids.length; i += 1) {
      const bid = sealedBids[i];

      const signer = getSignerForBidder(bid.bidder, keyMap, provider);
      const connected = contract.connect(signer);

      console.log(`Submitting bid ${i} for bidder ${bid.bidder}`);
      const tx = await connected.submitBid(args.auctionId, bid.ciphertext, bid.plaintextHash);
      console.log(`  tx: ${tx.hash}`);

      const receipt = await tx.wait();
      if (!receipt) {
        console.log("  receipt unavailable (transaction not confirmed)");
        continue;
      }

      const bidIndex = parseBidIndex(receipt, contract.interface);
      const message = bidIndex !== undefined ? `bidIndex ${bidIndex}` : "bidIndex not found in logs";
      console.log(`  confirmed in block ${receipt.blockNumber} (${message})`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    console.error(usage);
    process.exit(1);
  }
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(usage);
    process.exit(0);
  }

  const args: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--sealed-bids":
        args.sealedBidsPath = requireValue(flag, next);
        i += 1;
        break;
      case "--keys":
        args.keysPath = requireValue(flag, next);
        i += 1;
        break;
      case "--bond-auction":
        args.bondAuction = normalizeAddress(requireValue(flag, next), "bond-auction");
        i += 1;
        break;
      case "--auction-id":
        args.auctionId = normalizeBytes32(requireValue(flag, next), "auction-id");
        i += 1;
        break;
      case "--rpc-url":
        args.rpcUrl = requireValue(flag, next);
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  const missing = ["sealedBidsPath", "keysPath", "bondAuction", "auctionId", "rpcUrl"].filter(
    (key) => !(args as Record<string, unknown>)[key],
  );
  if (missing.length) {
    throw new Error(`Missing required arguments: ${missing.join(", ")}`);
  }

  return args as CliArgs;
}

function requireValue(flag: string, value?: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Flag ${flag} requires a value`);
  }
  return value;
}

function loadSealedBids(filePath: string): SealedBid[] {
  const data = readJson(filePath);
  const bids = Array.isArray(data) ? data : [data];
  return bids.map((bid, index) => normalizeSealedBid(bid, index));
}

function normalizeSealedBid(value: unknown, index: number): SealedBid {
  if (!value || typeof value !== "object") {
    throw new Error(`Sealed bid at index ${index} must be an object`);
  }

  const bid = value as Record<string, unknown>;
  const ciphertext = bid.ciphertext;
  const plaintextHash = bid.plaintextHash;
  const bidder = bid.bidder;
  const ciphertextHash = bid.ciphertextHash;
  const bidderNonce = bid.bidderNonce;
  const bidderSig = bid.bidderSig;

  if (typeof ciphertext !== "string" || !isHexString(ciphertext)) {
    throw new Error(`Sealed bid ${index} missing valid "ciphertext"`);
  }
  if (typeof plaintextHash !== "string" || !isHexString(plaintextHash, 32)) {
    throw new Error(`Sealed bid ${index} missing valid "plaintextHash"`);
  }
  if (typeof bidder !== "string") {
    throw new Error(`Sealed bid ${index} missing bidder address`);
  }
  if (ciphertextHash !== undefined && (typeof ciphertextHash !== "string" || !isHexString(ciphertextHash, 32))) {
    throw new Error(`Sealed bid ${index} has invalid "ciphertextHash"`);
  }
  if (bidderNonce !== undefined && typeof bidderNonce !== "string") {
    throw new Error(`Sealed bid ${index} has invalid "bidderNonce" (expected string)`);
  }
  if (bidderSig !== undefined && (typeof bidderSig !== "string" || !isHexString(bidderSig))) {
    throw new Error(`Sealed bid ${index} has invalid "bidderSig"`);
  }

  return {
    ciphertext,
    plaintextHash,
    bidder: normalizeAddress(bidder, `sealed bid ${index} bidder`),
    ciphertextHash: typeof ciphertextHash === "string" ? ciphertextHash : undefined,
    bidderNonce: typeof bidderNonce === "string" ? bidderNonce : undefined,
    bidderSig: typeof bidderSig === "string" ? bidderSig : undefined,
  };
}

function loadKeys(filePath: string): KeyMap {
  const data = readJson(filePath);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Keys file must be an object mapping addresses to key entries");
  }

  const entries = data as Record<string, unknown>;
  const map: KeyMap = new Map();
  for (const [rawAddress, rawEntry] of Object.entries(entries)) {
    if (!rawEntry || typeof rawEntry !== "object") {
      throw new Error(`Key entry for ${rawAddress} is invalid`);
    }

    const entry = rawEntry as Partial<KeyEntry>;
    if (!entry.privateKey || typeof entry.privateKey !== "string") {
      throw new Error(`Key entry for ${rawAddress} missing "privateKey"`);
    }

    const normalized = normalizeAddress(rawAddress, "key address");
    map.set(normalized, entry.privateKey);
  }

  return map;
}

function getSignerForBidder(bidder: string, keyMap: KeyMap, provider: JsonRpcProvider): Wallet {
  const normalized = normalizeAddress(bidder, "bidder");
  const privateKey = keyMap.get(normalized);
  if (!privateKey) {
    throw new Error(`No private key found for bidder ${normalized}`);
  }

  return new Wallet(privateKey, provider);
}

function normalizeAddress(address: string, label: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new Error(`Invalid address for ${label}: ${address}`);
  }
}

function parseBidIndex(receipt: ContractTransactionReceipt, iface: Interface): bigint | undefined {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "BidSubmitted") {
        const index = parsed.args.index;
        if (typeof index === "bigint") {
          return index;
        }
        if (index && typeof index.toString === "function") {
          return BigInt(index.toString());
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function normalizeBytes32(value: string, label: string): string {
  if (!isHexString(value, 32)) {
    throw new Error(`Invalid bytes32 for ${label}: ${value}`);
  }
  return value.toLowerCase();
}

function readJson(filePath: string): any {
  const absolute = path.resolve(process.cwd(), filePath);
  try {
    const raw = readFileSync(absolute, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const parsed = path.parse(absolute);
      const example = path.join(parsed.dir, `${parsed.name}.example${parsed.ext}`);
      if (existsSync(example)) {
        const displayExample = path.relative(process.cwd(), example) || path.basename(example);
        throw new Error(
          `Missing required local file: ${filePath}\n` +
            `Create it from the example file before continuing:\n` +
            `  cp ${displayExample} ${filePath}`,
        );
      }
    }
    throw error;
  }
}

void main();
