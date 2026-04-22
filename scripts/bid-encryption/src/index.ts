import { readFileSync, writeFileSync } from "fs";
import path from "path";
import process from "process";

import { BidPlaintext, Role, decryptBid, encryptBid, generateKeypair, hashBidPlaintext } from "./encryption";
import { Wallet, getAddress, isHexString } from "ethers";

interface EncryptInput {
  payload: BidPlaintext;
  auctioneerPublicKey: string;
  bidderPublicKey: string;
  version?: number;
  signing?: SigningParams;
}

interface SigningParams {
  chainId: number | string | bigint;
  verifyingContract: string;
  auctionId: string;
  bidderPrivateKey: string;
  bidderNonce: string;
}

type SigningOverrides = Partial<Pick<SigningParams, "chainId" | "verifyingContract" | "auctionId">>;

interface DecryptInput {
  ciphertext: string;
  privateKey: string;
  preferredRole?: Role;
  plaintextHash?: string;
}

type Mode = "encrypt" | "decrypt" | "keygen";

const usage = `Usage:
  yarn tsx src/index.ts encrypt <input.json> [output.json] [--chainId <id> --verifyingContract 0x... --auctionId 0x...]
  yarn tsx src/index.ts decrypt <input.json> [output.json]
  yarn tsx src/index.ts keygen [output.json]

Input JSON:
  encrypt -> { "payload": BidPlaintext, "auctioneerPublicKey": "0x...", "bidderPublicKey": "0x...", "version": 1, "signing": { "chainId": 1, "verifyingContract": "0x...", "auctionId": "0x...", "bidderPrivateKey": "0x...", "bidderNonce": "0" } } | [ ... ]
  decrypt -> { "ciphertext": "0x...", "privateKey": "0x...", "preferredRole": "auctioneer" | "bidder", "plaintextHash": "0x..." } | [ ... ]
  keygen  -> no input file

Output:
  encrypt -> { "ciphertext": "0x...", "plaintextHash": "0x...", "bidder": "0x...", "bidderSig": "0x...", "bidderNonce": "0" } (mirrors input shape: single object or array)
  decrypt -> { "payload": BidPlaintext, "plaintextHash": "0x...", "usedWrap": "auctioneer" | "bidder", "verified": true } (single or array)
  keygen  -> { "privateKey": "0x...", "publicKey": "0x..." }`;

async function main(): Promise<void> {
  const [rawMode, arg1, arg2, ...rest] = process.argv.slice(2);
  const mode = parseMode(rawMode);
  const inputPath = mode === "keygen" ? undefined : arg1;
  let outputPath: string | undefined = mode === "keygen" ? arg1 : arg2;
  let extraArgs: string[] = rest;

  if ((mode === "encrypt" || mode === "decrypt") && outputPath?.startsWith("--")) {
    extraArgs = [outputPath, ...rest];
    outputPath = undefined;
  }

  if (!mode || ((mode === "encrypt" || mode === "decrypt") && !inputPath)) {
    console.error(usage);
    process.exit(1);
  }

  try {
    let result: unknown;
    const overrides = mode === "encrypt" ? parseSigningOverrides(extraArgs) : undefined;

    if (mode !== "encrypt" && extraArgs.length) {
      throw new Error("unexpected extra arguments (override flags are only supported with encrypt)");
    }

    if (mode === "encrypt" || mode === "decrypt") {
      const absoluteInput = path.resolve(process.cwd(), inputPath!);
      const parsed = readJsonFile(absoluteInput);
      result = mode === "encrypt" ? await handleEncrypt(parsed, overrides) : handleDecrypt(parsed);
    } else {
      result = handleKeygen();
    }

    const serialized = JSON.stringify(result, null, 2);
    if (outputPath) {
      const absoluteOutput = path.resolve(process.cwd(), outputPath);
      writeFileSync(absoluteOutput, `${serialized}\n`, "utf8");
      console.log(`Wrote ${mode}ed output to ${absoluteOutput}`);
    } else {
      console.log(serialized);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

function parseMode(value?: string): Mode | null {
  if (value === "encrypt" || value === "decrypt" || value === "keygen") {
    return value;
  }
  return null;
}

function readJsonFile(filePath: string): unknown {
  const data = readFileSync(filePath, "utf8");
  return JSON.parse(data);
}

async function handleEncrypt(input: unknown, overrides?: SigningOverrides) {
  const { inputs, isArray } = normalizeEncryptInputs(input);
  const outputs = await Promise.all(inputs.map(async (item, index) => {
    try {
      const { payload } = await withSignature(item, overrides);

      const { ciphertextHex, plaintextHash } = encryptBid({
        plaintext: payload,
        auctioneerPubKey: item.auctioneerPublicKey,
        bidderPubKey: item.bidderPublicKey,
        version: item.version,
      });

      return {
        ciphertext: ciphertextHex,
        plaintextHash,
        bidder: payload.bidder,
        bidderSig: payload.bidderSig,
        bidderNonce: payload.bidderNonce,
      };
    } catch (err) {
      if (isArray) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`encrypt index ${index}: ${message}`);
      }
      throw err;
    }
  }));

  return isArray ? outputs : outputs[0];
}

function handleDecrypt(input: unknown) {
  const { inputs, isArray } = normalizeDecryptInputs(input);
  const outputs = inputs.map((item, index) => {
    try {
      const { plaintext, plaintextHash, usedWrap } = decryptBid(item.ciphertext, item.privateKey, item.preferredRole);

      if (item.plaintextHash) {
        const expected = item.plaintextHash.toLowerCase();
        const actual = plaintextHash.toLowerCase();
        if (expected !== actual) {
          throw new Error(`plaintextHash mismatch. expected ${expected}, got ${actual}`);
        }
      }

      return { payload: plaintext, plaintextHash, usedWrap, verified: Boolean(item.plaintextHash) };
    } catch (err) {
      if (isArray) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`decrypt index ${index}: ${message}`);
      }
      throw err;
    }
  });

  return isArray ? outputs : outputs[0];
}

function handleKeygen() {
  return generateKeypair();
}

function normalizeEncryptInputs(input: unknown): { inputs: EncryptInput[]; isArray: boolean } {
  const isArray = Array.isArray(input);
  const inputs = (isArray ? input : [input]) as unknown[];
  inputs.forEach((value, index) => assertEncryptInput(value, isArray ? index : undefined));
  return { inputs: inputs as EncryptInput[], isArray };
}

function normalizeDecryptInputs(input: unknown): { inputs: DecryptInput[]; isArray: boolean } {
  const isArray = Array.isArray(input);
  const inputs = (isArray ? input : [input]) as unknown[];
  inputs.forEach((value, index) => assertDecryptInput(value, isArray ? index : undefined));
  return { inputs: inputs as DecryptInput[], isArray };
}

function assertEncryptInput(value: unknown, index?: number): asserts value is EncryptInput {
  if (!isEncryptInput(value)) {
    const suffix = index !== undefined ? ` at index ${index}` : "";
    throw new Error(`encrypt input${suffix} must include payload, auctioneerPublicKey, bidderPublicKey`);
  }
}

function assertDecryptInput(value: unknown, index?: number): asserts value is DecryptInput {
  if (!isDecryptInput(value)) {
    const suffix = index !== undefined ? ` at index ${index}` : "";
    throw new Error(`decrypt input${suffix} must include ciphertext and privateKey`);
  }
}

function isEncryptInput(value: any): value is EncryptInput {
  return (
    value &&
    typeof value === "object" &&
    typeof value.payload === "object" &&
    typeof value.auctioneerPublicKey === "string" &&
    typeof value.bidderPublicKey === "string"
  );
}

function isDecryptInput(value: any): value is DecryptInput {
  return value && typeof value === "object" && typeof value.ciphertext === "string" && typeof value.privateKey === "string";
}

async function withSignature(input: EncryptInput, overrides?: SigningOverrides): Promise<{ payload: BidPlaintext }> {
  const signing = applySigningOverrides(input.signing, overrides);
  if (!signing) {
    if (!input.payload.bidderSig || !input.payload.bidderNonce) {
      throw new Error("payload must include bidderSig and bidderNonce or provide signing parameters");
    }
    return { payload: input.payload };
  }

  const wallet = new Wallet(signing.bidderPrivateKey);
  const bidder = wallet.address.toLowerCase();
  if (bidder !== input.payload.bidder.toLowerCase()) {
    throw new Error("signing bidderPrivateKey does not match payload.bidder");
  }

  const bidderNonce = signing.bidderNonce;
  if (typeof bidderNonce !== "string") {
    throw new Error("bidderNonce must be a string");
  }
  if (!isHexString(signing.auctionId, 32)) {
    throw new Error("auctionId must be a bytes32 hex string (0x...)");
  }
  if (!isHexString(signing.verifyingContract, 20)) {
    throw new Error("verifyingContract must be an address hex string");
  }
  const chainId = normalizeChainId(signing.chainId);

  const populated: BidPlaintext = {
    ...input.payload,
    bidderNonce,
    bidderSig: "0x",
  };
  const plaintextHash = hashBidPlaintext(populated);

  const domain = {
    name: "BondAuctionBid",
    version: "1",
    chainId,
    verifyingContract: getAddress(signing.verifyingContract),
  };
  const types = {
    BidIntent: [
      { name: "bidder", type: "address" },
      { name: "auctionId", type: "bytes32" },
      { name: "plaintextHash", type: "bytes32" },
      { name: "bidderNonce", type: "uint256" },
    ],
  };

  const signature = await wallet.signTypedData(domain, types, {
    bidder: wallet.address,
    auctionId: signing.auctionId,
    plaintextHash,
    bidderNonce: BigInt(bidderNonce),
  });

  return {
    payload: {
      ...input.payload,
      bidderNonce,
      bidderSig: signature,
    },
  };
}

function parseSigningOverrides(args: string[]): SigningOverrides | undefined {
  if (!args.length) {
    return undefined;
  }

  const overrides: SigningOverrides = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];

    if (!flag.startsWith("--")) {
      throw new Error(`unexpected argument "${flag}". Use --chainId, --verifyingContract or --auctionId.`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`flag ${flag} requires a value`);
    }

    switch (flag) {
      case "--chainId":
        overrides.chainId = normalizeChainId(value);
        break;
      case "--verifyingContract":
        overrides.verifyingContract = value;
        break;
      case "--auctionId":
        overrides.auctionId = value;
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }

    i++; // skip consumed value
  }

  return Object.keys(overrides).length ? overrides : undefined;
}

function applySigningOverrides(signing: SigningParams | undefined, overrides?: SigningOverrides): SigningParams | undefined {
  if (!signing || !overrides || Object.keys(overrides).length === 0) {
    return signing;
  }
  return { ...signing, ...overrides };
}

function normalizeChainId(value: number | string | bigint): bigint {
  try {
    const chainId = BigInt(value);
    if (chainId < 0) {
      throw new Error("chainId must be non-negative");
    }
    return chainId;
  } catch {
    throw new Error("chainId must be a valid integer");
  }
}

void main();
