/**
 * OpenAPI v2 schemas for nb-bond-api.
 *
 * Single source of truth: every DTO and route is declared here.
 * `npm run regen:openapi` writes services/nb-bond-api/openapi.json from
 * this module. The runtime serves the same document at /v1/openapi.json
 * and /docs.
 *
 * Plan reference: docs/plans/archive/openapi-v2-plan.md.
 */
import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';

// #region Primitives ─────────────────────────────────────────────────

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .meta({
    id: 'Address',
    description: 'Ethereum address',
    examples: ['0x1234567890abcdef1234567890abcdef12345678'],
  });

const hexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/)
  .meta({
    id: 'HexString',
    description: 'Hex string',
    examples: ['0xabc123'],
  });

const bigIntStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'BigIntString',
    description: 'Decimal string representation of a uint256',
    examples: ['1000000000000000000'],
  });

const bpsSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .meta({
    id: 'Bps',
    description: 'Basis points (1e4 precision). 425 = 4.25%, 9875 = 98.75%.',
    examples: ['425', '9875', '10123'],
  });

const isinSchema = z
  .string()
  .min(1)
  .meta({
    id: 'Isin',
    description: 'ISIN identifying a bond',
    examples: ['NO0012345678'],
  });

const auctionIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .meta({
    id: 'AuctionId',
    description: 'Auction identifier (bytes32 hex)',
    examples: ['0x1234abcd'.padEnd(66, '0')],
  });

const md5Schema = z.string().meta({
  description:
    'MD5 of canonical (key-sorted) JSON of this DTO. Server-computed; clients compare as opaque strings for cache validation.',
  examples: ['9e107d9d372bb6826bd81d3542a419d6'],
});

const blockNumberSchema = z.number().int().nullable().meta({
  description: 'Block number, or null if not yet mined / unknown.',
});

const unixSecondsSchema = bigIntStringSchema.meta({
  description: 'Unix timestamp in seconds (decimal string).',
});

const unixMillisSchema = z.number().int().meta({
  description: 'Unix timestamp in milliseconds.',
});

// #endregion

// #region Enums ──────────────────────────────────────────────────────

const auctionTypeSchema = z.enum(['RATE', 'PRICE', 'BUYBACK']).meta({
  id: 'AuctionType',
  description: 'Auction pricing model',
});

const auctionStatusSchema = z.enum(['open', 'closed', 'finalised', 'rejected', 'cancelled']).meta({
  id: 'AuctionStatus',
  description: 'Auction lifecycle status',
});

const bondStatusSchema = z.enum(['minting', 'maturing', 'matured', 'redeemed', 'unknown']).meta({
  id: 'BondStatus',
  description: 'Bond lifecycle status',
});

export const bidStateSchema = z.enum(['sealed', 'unsealed']).meta({
  id: 'BidState',
  description: 'Bid disclosure state',
});

// #endregion

// #region Shared nested DTOs ─────────────────────────────────────────

const txRefSchema = z
  .object({
    hash: hexStringSchema,
    block: blockNumberSchema,
  })
  .meta({
    id: 'TxRef',
    description: 'Reference to an on-chain transaction',
  });

const allocationEntrySchema = z
  .object({
    bidder: addressSchema,
    units: bigIntStringSchema,
    rate: bpsSchema,
  })
  .meta({
    id: 'AllocationEntry',
    description: 'A single bidder share of a completed allocation',
  });

const allocationSchema = z
  .object({
    clearingRate: bpsSchema,
    totalAllocated: bigIntStringSchema,
    hash: hexStringSchema.meta({
      description:
        'Off-chain commitment to the computed allocation (clearing rate + each bidder share); recomputed server-side and confirmed by the operator at finalisation.',
    }),
    auctionType: auctionTypeSchema,
    computedAt: unixMillisSchema,
    entries: z.array(allocationEntrySchema),
    md5: md5Schema,
  })
  .meta({
    id: 'Allocation',
    description: 'Computed allocation result for a closed auction',
  });

// #endregion

// #region Bid (discriminated union) ──────────────────────────────────

const bidIndexSchema = z
  .number()
  .int()
  .nonnegative()
  .meta({
    id: 'BidIndex',
    description:
      'On-chain sealed-bid array index identifying this bid within its auction. Stable for the ' +
      'life of the auction; used by the operator UI to address winners at finalisation.',
  });

const sealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('sealed'),
    bidIndex: bidIndexSchema,
    ciphertext: hexStringSchema,
    plaintextHash: hexStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'SealedBid',
    description: 'Bid in sealed (encrypted) state during an open auction',
  });

const unsealedBidSchema = z
  .object({
    bidder: addressSchema,
    state: z.literal('unsealed'),
    bidIndex: bidIndexSchema,
    rate: bpsSchema,
    units: bigIntStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'UnsealedBid',
    description: 'Bid in unsealed (revealed) state after auction close',
  });

const bidSchema = z.discriminatedUnion('state', [sealedBidSchema, unsealedBidSchema]).meta({
  id: 'Bid',
  description: 'Bid; discriminated by `state` — sealed during open, unsealed after close',
});

// #endregion

// #region Auction ────────────────────────────────────────────────────

const auctionContractsSchema = z
  .object({
    auction: addressSchema,
    token: addressSchema,
  })
  .meta({
    id: 'AuctionContracts',
    description: 'On-chain contract addresses owning this auction',
  });

const auctionTxsSchema = z
  .object({
    create: txRefSchema,
    close: txRefSchema.nullable(),
    finalise: txRefSchema.nullable(),
    cancel: txRefSchema.nullable(),
  })
  .meta({
    id: 'AuctionTxs',
    description: 'Latest transaction per state-changing action on this auction',
  });

const auctionSchema = z
  .object({
    id: auctionIdSchema,
    isin: isinSchema,
    type: auctionTypeSchema,
    status: auctionStatusSchema,
    end: unixSecondsSchema.nullable().meta({
      description: 'Scheduled close timestamp',
    }),
    size: bigIntStringSchema.nullable().meta({
      description: 'Offering or buyback size in 1000-NOK units',
    }),
    maturityDuration: bigIntStringSchema.nullable().meta({
      description: 'Seconds from distribution until maturity (required for RATE auctions)',
    }),
    owner: addressSchema,
    sealingPubKey: hexStringSchema.meta({
      description: 'Public key used by bidders to encrypt sealed bids',
    }),
    contracts: auctionContractsSchema,
    bids: z.array(bidSchema),
    allocation: allocationSchema.nullable(),
    txs: auctionTxsSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'Auction',
    description: 'Auction resource with bids and allocation subtree',
  });

// #endregion

// #region Bond ───────────────────────────────────────────────────────

const bondContractsSchema = z
  .object({
    token: addressSchema.meta({ description: 'ERC20 bond token contract' }),
    auction: addressSchema.meta({ description: 'BondAuction contract' }),
    manager: addressSchema.meta({ description: 'BondManager contract' }),
  })
  .meta({
    id: 'BondContracts',
    description: 'On-chain contract addresses for this bond',
  });

const maturitySchema = z
  .object({
    duration: bigIntStringSchema.nullable().meta({
      description: 'Configured maturity duration in seconds (raw chain value)',
    }),
    durationYears: bigIntStringSchema.nullable().meta({
      description:
        'Maturity in DURATION_SCALAR units (= years on a real chain; sandbox compresses ' +
        '1 unit to DURATION_SCALAR seconds). Derived as duration / DURATION_SCALAR — ' +
        'use this for human-readable display; use `duration` for second-level arithmetic.',
    }),
    date: unixSecondsSchema.nullable().meta({
      description: 'Maturity date as unix timestamp',
    }),
    remaining: bigIntStringSchema.nullable().meta({
      description: 'Seconds until maturity; 0 once matured',
    }),
    remainingYears: bigIntStringSchema.nullable().meta({
      description: 'Remaining time in DURATION_SCALAR units (see durationYears for semantics)',
    }),
  })
  .meta({
    id: 'BondMaturity',
    description: 'Maturity configuration and remaining time',
  });

const couponPaymentsSchema = z
  .object({
    total: bigIntStringSchema.nullable(),
    made: bigIntStringSchema.nullable(),
    remaining: bigIntStringSchema.nullable(),
  })
  .meta({
    id: 'CouponPayments',
    description: 'Coupon payment progress',
  });

const couponSchema = z
  .object({
    duration: bigIntStringSchema.nullable().meta({
      description: 'Seconds between coupon payments (raw chain value)',
    }),
    durationYears: bigIntStringSchema.nullable().meta({
      description:
        'Coupon interval in DURATION_SCALAR units (= years on a real chain; see ' +
        'BondMaturity.durationYears for the unit semantics).',
    }),
    rateBps: bpsSchema.nullable().meta({
      description:
        'Contractual annualised coupon rate in bps, fixed at bond issuance. ' +
        'Not the same as yield-to-maturity, which depends on the secondary-market ' +
        'price the holder paid; the sandbox has no secondary market so they coincide ' +
        'at par issuance.',
    }),
    payments: couponPaymentsSchema,
  })
  .meta({
    id: 'BondCoupon',
    description: 'Coupon configuration and payment progress',
  });

const holderBalanceSchema = z
  .object({
    holder: addressSchema,
    balance: bigIntStringSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'HolderBalance',
    description: 'A single bond holder and their balance',
  });

const bondSchema = z
  .object({
    isin: isinSchema,
    status: bondStatusSchema,
    disabled: z.boolean().meta({
      description:
        'True when the bond has been soft-deleted via DELETE /v1/bonds/{isin}. Disabled bonds ' +
        'are excluded from the default GET /v1/bonds response — pass ?includeDisabled=true to ' +
        'see them. Chain history (events) is preserved.',
    }),
    totalSupply: bigIntStringSchema.nullable(),
    contracts: bondContractsSchema,
    maturity: maturitySchema.nullable(),
    coupon: couponSchema.nullable(),
    holders: z.array(holderBalanceSchema),
    auctions: z.array(auctionSchema),
    md5: md5Schema,
  })
  .meta({
    id: 'Bond',
    description:
      'Bond resource. Carries the full subtree of auctions, bids, allocations, and holders. ' +
      'A single GET /v1/bonds populates the entire UI cache.',
  });

// #endregion

// #region History ────────────────────────────────────────────────────

const historyEventSchema = z
  .object({
    isin: isinSchema,
    auctionId: auctionIdSchema.nullable().meta({
      description: 'Set for auction-scoped events; null for bond-level events',
    }),
    type: z.string().meta({
      description: 'Event name as emitted by the contracts (e.g. "BidSubmitted", "CouponPaid")',
    }),
    block: z.number().int(),
    txHash: hexStringSchema,
    payload: z.unknown().meta({
      description: 'Event-specific opaque payload; clients treat as untyped JSON',
    }),
  })
  .meta({
    id: 'HistoryEvent',
    description: 'Auction or bond event observed on-chain',
  });

// #endregion

// #region Bidder ─────────────────────────────────────────────────────

const bidderSchema = z
  .object({
    address: addressSchema,
    name: z.string().meta({ description: 'Human-readable bidder label, unique per sandbox' }),
    publicKey: hexStringSchema.meta({
      description: 'Compressed secp256k1 public key (33-byte hex)',
    }),
    privateKey: hexStringSchema.meta({
      description:
        'Private key, hex (0x + 64 chars). Returned in plaintext because this surface is sandbox-only.',
    }),
    ethBalance: bigIntStringSchema.meta({ description: 'Current ETH balance in wei' }),
    wnokBalance: bigIntStringSchema.meta({
      description: 'Current WNOK balance in 1-NOK units. "0" until WNOK is reachable.',
    }),
    createdAt: unixMillisSchema.meta({ description: 'Creation timestamp (unix milliseconds)' }),
    md5: md5Schema,
  })
  .meta({
    id: 'Bidder',
    description:
      'Sandbox bidder roster entry. The same private key signs transactions, ' +
      'signs EIP-712 bid intents, and acts as the bidder pubkey for the dual-wrap encryption.',
  });

const createBidderBodySchema = z
  .object({
    name: z.string().min(1).max(64).meta({ description: 'Human-readable bidder label' }),
    privateKey: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional()
      .meta({
        description: 'Optional import of an existing 32-byte hex key. Generated if omitted.',
      }),
  })
  .meta({
    id: 'CreateBidderBody',
    description: 'Request body for creating a bidder',
  });

const submitBidBodySchema = z
  .object({
    auctionId: auctionIdSchema,
    units: bigIntStringSchema.meta({
      description: 'Bid size in 1000-NOK units',
    }),
    rate: bpsSchema.meta({
      description:
        'Bid rate (bps). Interpretation depends on auction type — yield for RATE, price-per-100 for PRICE/BUYBACK.',
    }),
  })
  .meta({
    id: 'SubmitBidBody',
    description:
      'Request body for impersonated bid submission. The server builds the plaintext, signs the ' +
      'EIP-712 BidIntent with the stored bidder key, dual-wraps with the auctioneer sealing key, ' +
      'and calls BondAuction.submitBid from the bidder’s wallet.',
  });

// #endregion

// #region Central Bank ───────────────────────────────────────────────

const allowlistEntrySchema = z
  .object({
    address: addressSchema,
    md5: md5Schema,
  })
  .meta({
    id: 'AllowlistEntry',
    description: 'A single allowlisted address',
  });

const transactionRefSchema = z
  .object({
    hash: hexStringSchema,
    block: blockNumberSchema,
  })
  .meta({
    id: 'TransactionRef',
    description: 'On-chain transaction reference (hash + block)',
  });

const centralBankSchema = z
  .object({
    address: addressSchema.meta({ description: "The CB operator's EVM address" }),
    available: z.boolean().meta({
      description:
        'False when CENTRAL_BANK_PK is unset or the WNOK contract is not registered — endpoints respond 503',
    }),
    wnok: z
      .object({
        contractAddress: addressSchema,
        balance: bigIntStringSchema.meta({ description: 'CB account balance in 1-NOK units' }),
        allowlistSize: z.number().int().nonnegative(),
      })
      .nullable()
      .meta({
        description: 'WNOK binding state. Null when WNOK is unreachable.',
      }),
    md5: md5Schema,
  })
  .meta({
    id: 'CentralBank',
    description: 'Central Bank operator summary',
  });

const wnokMintBurnBodySchema = z
  .object({
    address: addressSchema.meta({
      description: 'Target address (must be on the WNOK allowlist)',
    }),
    amount: bigIntStringSchema.meta({ description: 'Amount in 1-NOK units (uint256)' }),
  })
  .meta({
    id: 'WnokMintBurnBody',
    description: 'Body for mint / burn operations',
  });

const wnokTransferBodySchema = z
  .object({
    to: addressSchema,
    amount: bigIntStringSchema,
  })
  .meta({
    id: 'WnokTransferBody',
    description: 'Body for a transfer from the CB account',
  });

// #endregion

// #region Banking ────────────────────────────────────────────────────

const tbdHolderSchema = z
  .object({
    address: addressSchema,
    balance: bigIntStringSchema.meta({
      description: 'TBD balance in whole units (the contract uses decimals = 0)',
    }),
  })
  .meta({
    id: 'TbdHolder',
    description: 'An allowlisted TBD holder and its balance. Always read with its parent token.',
  });

const tbdTokenSchema = z
  .object({
    address: addressSchema.meta({ description: 'TBD contract address — the resource id' }),
    name: z.string().meta({ description: 'Token name, e.g. "TBD Nordea"' }),
    symbol: z.string().meta({ description: 'Token symbol, e.g. "TBDnordea"' }),
    decimals: z
      .number()
      .int()
      .meta({ description: 'Always 0 — TBD is denominated in whole units' }),
    totalSupply: bigIntStringSchema.meta({ description: 'Total TBD issued, whole units' }),
    bank: z
      .object({
        name: z.string().meta({ description: 'Owning bank label, e.g. "Nordea Bank"' }),
        address: addressSchema.meta({
          description: "Owning bank's EVM address — holds admin / minter / burner on this token",
        }),
      })
      .meta({ id: 'TbdBank', description: 'The commercial bank that owns this TBD token' }),
    reserve: z
      .object({
        wnokBalance: bigIntStringSchema.meta({
          description: "Owning bank's WNOK balance — the central-bank-money reserve",
        }),
        backed: z.boolean().meta({
          description:
            'True when the bank WNOK reserve covers the TBD supply (reserve >= totalSupply). ' +
            'Informational only — 1:1 backing is not enforced on-chain.',
        }),
      })
      .nullable()
      .meta({
        id: 'TbdReserve',
        description: 'WNOK reserve backing (informational). Null when WNOK is unreachable.',
      }),
    government: z
      .object({
        nominated: z.boolean().meta({
          description:
            'True when a government reserve account is set (enables the gov-reserve mint path)',
        }),
        reserveAddress: addressSchema.nullable().meta({
          description: 'The government reserve account, or null when not nominated',
        }),
      })
      .meta({ id: 'TbdGovernment', description: 'Government-nomination state for this token' }),
    holders: z
      .array(tbdHolderSchema)
      .meta({ description: 'Allowlisted addresses with their TBD balances (sandbox-scale)' }),
    md5: md5Schema,
  })
  .meta({
    id: 'TbdToken',
    description:
      'A tokenized bank deposit (TBD) — one ERC-20 per commercial bank, allowlist-gated and ' +
      'WNOK-reserve-backed. The same DTO is returned by the list and the single-token GET.',
  });

// #endregion

// #region Health ─────────────────────────────────────────────────────

const healthContractsSchema = z
  .object({
    bondManager: addressSchema,
    bondAuction: addressSchema,
    bondToken: addressSchema,
    wnok: addressSchema.nullable().meta({
      description: 'WNOK contract address; null when WNOK is not registered in GlobalRegistry',
    }),
  })
  .meta({
    id: 'HealthContracts',
    description: 'Contract addresses the service is bound to',
  });

const healthChainSchema = z
  .object({
    rpcUrl: z.string().meta({
      description: 'Sanitised RPC endpoint — protocol://host[:port] only, no credentials or path',
      examples: ['http://besu-rpc.besu:8545'],
    }),
    chainId: z.number().nullable().meta({
      description: 'EVM chainId reported by the provider, or null when unreachable',
    }),
    head: z.number().nullable().meta({
      description: 'Chain head block number, or null when unreachable',
    }),
    headReachable: z.boolean().meta({
      description: 'True iff the backend could read the chain head at the time of this request',
    }),
  })
  .meta({
    id: 'HealthChain',
    description: 'On-chain reachability and head state',
  });

const recentIngestionErrorSchema = z
  .object({
    ts: z.number().meta({ description: 'Unix-epoch ms when the error was observed' }),
    message: z.string().meta({ description: 'Error message from the failing tick' }),
    code: z
      .string()
      .nullable()
      .meta({ description: 'Error code (ethers `err.code`) or class name; null when neither set' }),
  })
  .meta({
    id: 'RecentIngestionError',
    description: 'Single entry in the ring buffer of recent ingestion errors',
  });

const healthIngestionSchema = z
  .object({
    loopRunning: z.boolean().meta({
      description: 'True once startIngestionLoop() has wired its setInterval',
    }),
    lastBlockProcessed: z.number().nullable().meta({
      description: 'Last block the loop wrote to the projection, or null before the first tick',
    }),
    lag: z.number().nullable().meta({
      description: 'chain.head - ingestion.lastBlockProcessed; null when either side is unknown',
    }),
    pollIntervalMs: z.number().meta({
      description: 'Configured poll cadence for the ingestion loop',
    }),
    lastTickAt: z.number().nullable().meta({
      description: 'Unix-epoch ms of the last tick (success or failure), or null pre-first-tick',
    }),
    lastEventTxHash: z.string().nullable().meta({
      description:
        'Most recent tx hash whose log we ingested; null before any events have been seen this process',
    }),
    consecutiveFailures: z.number().meta({
      description: 'Count of tick failures since the last success; reset on each successful tick',
    }),
    recentErrors: z.array(recentIngestionErrorSchema).meta({
      description:
        'Ring buffer (newest first, max 10) of the most recent ingestion-loop errors. Cleared on a successful restart via /v1/admin/restart-ingestion.',
    }),
  })
  .meta({
    id: 'HealthIngestion',
    description: 'Runtime state of the in-process ingestion loop',
  });

const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    contracts: healthContractsSchema,
    sealingPubKey: hexStringSchema,
    chain: healthChainSchema,
    ingestion: healthIngestionSchema,
  })
  .meta({
    id: 'Health',
    description: 'Service health and binding information',
  });

const restartOutcomeSchema = z
  .object({
    restarted: z.boolean().meta({
      description:
        'True when the ingestion loop confirmed `loopRunning=true` within the 5s timeout. ' +
        'False means the loop is still coming up (e.g. chain unreachable); operator UI ' +
        'should poll /v1/health to track readiness.',
    }),
    status: healthIngestionSchema.meta({
      description: 'Post-restart snapshot of the ingestion-loop state',
    }),
  })
  .meta({
    id: 'RestartOutcome',
    description: 'Result of POST /v1/admin/restart-ingestion',
  });

// #endregion

// #region ProblemDetails (RFC 7807) ──────────────────────────────────

const problemFieldErrorSchema = z
  .object({
    field: z.string(),
    message: z.string(),
  })
  .meta({
    id: 'ProblemFieldError',
    description: 'Per-field validation error',
  });

const problemDetailsSchema = z
  .object({
    type: z
      .string()
      .meta({ description: 'URI reference categorising the error', examples: ['about:blank'] }),
    title: z.string().meta({ description: 'Short, human-readable summary' }),
    status: z.number().int().meta({ description: 'HTTP status code' }),
    detail: z.string().nullable().meta({ description: 'Human-readable explanation' }),
    instance: z.string().nullable().meta({ description: 'Path that produced the error' }),
    errors: z.array(problemFieldErrorSchema).nullable().meta({
      description: 'Populated for 400 validation failures; null otherwise',
    }),
  })
  .meta({
    id: 'ProblemDetails',
    description: 'RFC 7807 error body. Returned for every 4xx/5xx response.',
  });

// #endregion

// #region Request bodies ─────────────────────────────────────────────

const createAuctionBodySchema = z
  .object({
    type: auctionTypeSchema,
    end: unixSecondsSchema.meta({ description: 'Auction close timestamp (unix seconds)' }),
    size: bigIntStringSchema.meta({
      description: 'Offering or buyback size in 1000-NOK units',
    }),
    maturityDuration: bigIntStringSchema.nullable().meta({
      description:
        'Maturity in DURATION_SCALAR units (years on a real chain; sandbox treats each unit ' +
        'as 60 seconds for fast testing). The contract multiplies by DURATION_SCALAR to derive ' +
        'seconds — do not pre-convert. Required for RATE auctions; null otherwise.',
    }),
  })
  .meta({
    id: 'CreateAuctionBody',
    description: 'Request body for creating an auction under a bond',
  });

const closeAuctionBodySchema = z
  .object({
    status: z.literal('closed').meta({
      description: 'Target status. Only "closed" is accepted today; enum extensible later.',
    }),
  })
  .meta({
    id: 'CloseAuctionBody',
    description: 'PATCH body for the close transition',
  });

const finaliseBodySchema = z
  .object({
    approve: z.boolean().meta({
      description: 'true → finalised; false → rejected (allocation discarded)',
    }),
    winningBidIndexes: z
      .array(bidIndexSchema)
      .meta({
        description:
          'Sealed-bid indexes (each Bid.bidIndex) selected as winners. Required and non-empty ' +
          'when approve=true: the server recomputes the allocation over exactly these bids and ' +
          'ignores all unselected bids. Ignored when approve=false.',
      })
      .optional(),
    expectedClearingRate: bpsSchema.optional(),
  })
  .meta({
    id: 'FinaliseBody',
    description:
      'PUT body for finalisation. Approve: approve=true with winningBidIndexes plus ' +
      'expectedClearingRate (bps) — the server recomputes the clearing rate over the selected ' +
      'bids and rejects on mismatch, so the minted coupon can never silently diverge from what ' +
      'the operator saw. Reject: approve=false (allocation discarded; selection ignored).',
  });

const holdersBodySchema = z
  .object({
    holders: z.array(addressSchema).nullable().meta({
      description: 'Optional subset of holders to pay/redeem. null = all holders.',
    }),
  })
  .meta({
    id: 'HoldersBody',
    description: 'Body for coupon-payment and redemption operations',
  });

// #endregion

// #region Path / query parameters ────────────────────────────────────

const isinParamSchema = z
  .object({ isin: isinSchema })
  .meta({ id: 'IsinParam', description: 'ISIN path parameter' });

const auctionIdParamSchema = z
  .object({ auctionId: auctionIdSchema })
  .meta({ id: 'AuctionIdParam', description: 'Auction id path parameter' });

const bidderAddressParamSchema = z
  .object({ address: addressSchema })
  .meta({ id: 'BidderAddressParam', description: 'Bidder address path parameter' });

const historyQuerySchema = z
  .object({
    before: z.coerce.number().int().nonnegative().nullable().meta({
      description: 'Return events with block < this value; null/unset = latest',
    }),
    limit: z.coerce.number().int().positive().max(500).nullable().meta({
      description: 'Maximum events to return; default 100, max 500',
    }),
  })
  .meta({ id: 'HistoryQuery' });

// #endregion

// #region OpenAPI document ───────────────────────────────────────────

const etagHeader = {
  ETag: {
    description: 'MD5 of the response body. Reuse via If-None-Match for cache revalidation.',
    schema: { type: 'string' as const },
  },
};

const successJson = (description: string, schema: z.ZodTypeAny) => ({
  description,
  headers: etagHeader,
  content: { 'application/json': { schema } },
});

const notModified = {
  description: 'Not Modified — If-None-Match matched current ETag; cached body still valid.',
};

const errorRefs = {
  read: {
    304: notModified,
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    404: { $ref: '#/components/responses/NotFound' },
    500: { $ref: '#/components/responses/InternalError' },
  },
  mutate: {
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    404: { $ref: '#/components/responses/NotFound' },
    409: { $ref: '#/components/responses/Conflict' },
    500: { $ref: '#/components/responses/InternalError' },
  },
};

const isinPathParam = {
  in: 'path' as const,
  name: 'isin',
  required: true,
  schema: { $ref: '#/components/schemas/Isin' },
};

const auctionIdPathParam = {
  in: 'path' as const,
  name: 'auctionId',
  required: true,
  schema: { $ref: '#/components/schemas/AuctionId' },
};

const testModeQueryParam = {
  in: 'query' as const,
  name: 'testMode',
  required: false,
  schema: { type: 'boolean' as const, default: false },
  description:
    'Sandbox-only umbrella "test mode" flag. The operator UI flips this from the top bar; ArgoCD- ' +
    'managed deployments should ignore it. Today `testMode=true` enables: ' +
    '(a) unsealing of bids on auctions still in the BIDDING phase on bond / auction GETs; ' +
    '(b) skipping the API-side end-time pre-check on PATCH /v1/auctions/{id} (close) so the ' +
    'operator can attempt close before the bidding window expires — the on-chain contract still ' +
    'enforces `block.timestamp > metadata.end` and reverts with `InBidPhase()` if the window is ' +
    'open. Future test affordances will plumb through this same flag.',
};

const bidderAddressPathParam = {
  in: 'path' as const,
  name: 'address',
  required: true,
  schema: { $ref: '#/components/schemas/Address' },
};

const tbdAddressPathParam = {
  in: 'path' as const,
  name: 'address',
  required: true,
  schema: { $ref: '#/components/schemas/Address' },
};

const includeDisabledQueryParam = {
  in: 'query' as const,
  name: 'includeDisabled',
  required: false,
  schema: { type: 'boolean' as const, default: false },
  description:
    'When true, include soft-deleted bonds in the response. Disabled bonds are hidden by ' +
    'default to keep the operator working list focused. See DELETE /v1/bonds/{isin}.',
};

const createBondBodySchema = z
  .object({
    isin: isinSchema,
    maturityDuration: bigIntStringSchema.meta({
      description:
        'Maturity in DURATION_SCALAR units (years on a real chain; sandbox treats each unit ' +
        'as 60 seconds for fast testing). The contract multiplies by DURATION_SCALAR to derive ' +
        'seconds — do not pre-convert.',
    }),
  })
  .meta({ id: 'CreateBondRequest', description: 'Request body for POST /v1/bonds' });

const noContent204 = {
  description: 'No Content — operation succeeded; response body intentionally empty.',
};

const paths: ZodOpenApiPathsObject = {
  // system ─────────────────────────────────────────
  '/v1/health': {
    get: {
      tags: ['system'],
      operationId: 'getHealth',
      summary: 'Service health',
      security: [],
      responses: {
        200: successJson('Health and binding information', healthSchema),
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },

  // bonds ──────────────────────────────────────────
  '/v1/bonds': {
    get: {
      tags: ['bonds'],
      operationId: 'listBonds',
      summary: 'List all bonds with full subtree (auctions, bids, allocations, holders)',
      parameters: [testModeQueryParam, includeDisabledQueryParam],
      responses: {
        200: successJson('All bonds. Primary cache-priming call for the UI.', z.array(bondSchema)),
        ...errorRefs.read,
      },
    },
    post: {
      tags: ['bonds'],
      operationId: 'createBond',
      summary:
        'Create a bond partition without scheduling an auction. The first auction is scheduled ' +
        'separately via POST /v1/bonds/{isin}/auctions.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createBondBodySchema } },
      },
      responses: {
        201: successJson('Newly created bond with no auctions yet', bondSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}': {
    get: {
      tags: ['bonds'],
      operationId: 'getBond',
      summary: 'Get a single bond with full subtree',
      parameters: [isinPathParam, testModeQueryParam],
      responses: {
        200: successJson('Bond resource', bondSchema),
        ...errorRefs.read,
      },
    },
    delete: {
      tags: ['bonds'],
      operationId: 'disableBond',
      summary:
        'Soft-delete a bond. Requires no minted supply, no in-flight auction, and no FINALISED ' +
        'auction in history. Idempotent — returns 204 even if the bond is already disabled.',
      parameters: [isinPathParam],
      responses: {
        204: { description: 'Bond disabled (or was already disabled)' },
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/coupon-payments': {
    post: {
      tags: ['bonds'],
      operationId: 'payCoupon',
      summary: 'Pay coupon to bond holders',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: holdersBodySchema } },
      },
      responses: {
        200: successJson('Updated bond after submitting the coupon-payment tx', bondSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/redemptions': {
    post: {
      tags: ['bonds'],
      operationId: 'redeem',
      summary: 'Redeem bond tokens for holders',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: holdersBodySchema } },
      },
      responses: {
        200: successJson('Updated bond after submitting the redemption tx', bondSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bonds/{isin}/history': {
    get: {
      tags: ['bonds'],
      operationId: 'listBondHistory',
      summary: 'Paginated event history for a bond and its auctions',
      parameters: [
        isinPathParam,
        {
          in: 'query',
          name: 'before',
          required: false,
          schema: { type: 'integer', minimum: 0 },
          description: 'Return events with block < this value',
        },
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        },
      ],
      responses: {
        200: successJson('Event history', z.array(historyEventSchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/bonds/{isin}/auctions': {
    post: {
      tags: ['auctions'],
      operationId: 'createAuction',
      summary: 'Create an auction under a bond. Response is the updated parent Bond.',
      parameters: [isinPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createAuctionBodySchema } },
      },
      responses: {
        200: successJson('Updated bond with the new auction appended', bondSchema),
        ...errorRefs.mutate,
      },
    },
  },

  // auctions ───────────────────────────────────────
  '/v1/auctions': {
    get: {
      tags: ['auctions'],
      operationId: 'listAuctions',
      summary: 'List all auctions across bonds (flat view of the full tree)',
      parameters: [testModeQueryParam],
      responses: {
        200: successJson('All auctions with bids and allocations', z.array(auctionSchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/auctions/{auctionId}': {
    get: {
      tags: ['auctions'],
      operationId: 'getAuction',
      summary: 'Get a single auction subtree',
      parameters: [auctionIdPathParam, testModeQueryParam],
      responses: {
        200: successJson('Auction resource', auctionSchema),
        ...errorRefs.read,
      },
    },
    patch: {
      tags: ['auctions'],
      operationId: 'closeAuction',
      summary: 'Transition auction to a new status. Only "closed" accepted today.',
      parameters: [auctionIdPathParam, testModeQueryParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: closeAuctionBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after the state transition', auctionSchema),
        ...errorRefs.mutate,
      },
    },
    delete: {
      tags: ['auctions'],
      operationId: 'cancelAuction',
      summary: 'Cancel auction (soft-delete; stays on-chain with status="cancelled")',
      parameters: [auctionIdPathParam],
      responses: {
        200: successJson('Cancelled auction (status="cancelled")', auctionSchema),
        ...errorRefs.mutate,
      },
    },
  },
  // bidders ────────────────────────────────────────
  '/v1/bidders': {
    get: {
      tags: ['bidders'],
      operationId: 'listBidders',
      summary: 'List the sandbox bidder roster',
      responses: {
        200: successJson('All bidders in the roster', z.array(bidderSchema)),
        ...errorRefs.read,
      },
    },
    post: {
      tags: ['bidders'],
      operationId: 'createBidder',
      summary: 'Create a bidder (generates a fresh keypair when privateKey is omitted)',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createBidderBodySchema } },
      },
      responses: {
        200: successJson('Newly created bidder', bidderSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bidders/{address}': {
    delete: {
      tags: ['bidders'],
      operationId: 'deleteBidder',
      summary:
        'Delete a bidder. Hard-blocked while the bidder has unrevealed bids on an open auction.',
      parameters: [bidderAddressPathParam],
      responses: {
        204: noContent204,
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/bidders/{address}/bids': {
    post: {
      tags: ['bidders'],
      operationId: 'submitBidderBid',
      summary: 'Submit a sealed bid on behalf of a roster bidder',
      parameters: [bidderAddressPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: submitBidBodySchema } },
      },
      responses: {
        200: successJson('Sealed bid as accepted on-chain', sealedBidSchema),
        ...errorRefs.mutate,
      },
    },
  },

  // central-bank ────────────────────────────────────
  '/v1/central-bank': {
    get: {
      tags: ['central-bank'],
      operationId: 'getCentralBank',
      summary: 'Central Bank operator summary (CB address, WNOK balance, allowlist size)',
      responses: {
        200: successJson('Central Bank summary', centralBankSchema),
        ...errorRefs.read,
      },
    },
  },
  '/v1/central-bank/allowlist': {
    get: {
      tags: ['central-bank'],
      operationId: 'listWnokAllowlist',
      summary: 'List addresses on the WNOK allowlist',
      responses: {
        200: successJson('Allowlist entries', z.array(allowlistEntrySchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/central-bank/allowlist/{address}': {
    put: {
      tags: ['central-bank'],
      operationId: 'addToWnokAllowlist',
      summary: 'Add an address to the WNOK allowlist (idempotent)',
      parameters: [
        {
          in: 'path' as const,
          name: 'address',
          required: true,
          schema: { $ref: '#/components/schemas/Address' },
        },
      ],
      responses: {
        200: successJson('Transaction reference for the on-chain add', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
    delete: {
      tags: ['central-bank'],
      operationId: 'removeFromWnokAllowlist',
      summary: 'Remove an address from the WNOK allowlist (idempotent)',
      parameters: [
        {
          in: 'path' as const,
          name: 'address',
          required: true,
          schema: { $ref: '#/components/schemas/Address' },
        },
      ],
      responses: {
        200: successJson('Transaction reference for the on-chain remove', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/central-bank/wnok/mint': {
    post: {
      tags: ['central-bank'],
      operationId: 'mintWnok',
      summary: 'Mint WNOK to an allowlisted address',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: wnokMintBurnBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the mint', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/central-bank/wnok/burn': {
    post: {
      tags: ['central-bank'],
      operationId: 'burnWnok',
      summary: 'Burn WNOK from an allowlisted address',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: wnokMintBurnBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the burn', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/central-bank/wnok/transfer': {
    post: {
      tags: ['central-bank'],
      operationId: 'transferWnok',
      summary: 'Transfer WNOK from the CB account to an allowlisted recipient',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: wnokTransferBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the transfer', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },

  // banking ────────────────────────────────────────
  '/v1/banking/tbd': {
    get: {
      tags: ['banking'],
      operationId: 'listTbd',
      summary: 'List all deployed TBD tokens (one per bank) with supply, reserve, and holders',
      responses: {
        200: successJson('TBD tokens', z.array(tbdTokenSchema)),
        ...errorRefs.read,
      },
    },
  },
  '/v1/banking/tbd/{address}': {
    get: {
      tags: ['banking'],
      operationId: 'getTbd',
      summary: 'Get one TBD token by its contract address',
      parameters: [tbdAddressPathParam],
      responses: {
        200: successJson('TBD token', tbdTokenSchema),
        ...errorRefs.read,
      },
    },
  },

  // admin ──────────────────────────────────────────
  '/v1/admin/restart-ingestion': {
    post: {
      tags: ['admin'],
      operationId: 'restartIngestion',
      summary: 'Restart the in-process ingestion loop',
      description:
        'Tears down the running ingestion loop and starts a fresh one via the same ' +
        'retry-with-backoff helper used at boot. With `?fromBlock=0`, also drops every ' +
        'projection table (auctions, bond_events, balance_events, balances, partitions, ' +
        'ingestion_state, auction_events) so the rebuild starts from `START_BLOCK`. ' +
        'The bidder roster (`bidders` table) is preserved — it is a sandbox ' +
        'system-of-record that cannot be recovered from chain. ' +
        'Returns once `loopRunning=true` or after a 5s timeout; the operator UI polls ' +
        '`/v1/health` to track the rest of the rebuild.',
      parameters: [
        {
          in: 'query' as const,
          name: 'fromBlock',
          required: false,
          description:
            'Set to `0` to drop the projection before restarting (destructive — operator UI ' +
            'gates with a type-to-confirm phrase). Any other value, or absent, performs a ' +
            'plain restart without touching the projection.',
          schema: { type: 'string' as const, enum: ['0'] },
        },
      ],
      responses: {
        200: successJson(
          'Restart completed within the timeout; payload reflects post-restart state.',
          restartOutcomeSchema,
        ),
        202: successJson(
          'Restart accepted; loop is still coming up after the 5s timeout (e.g. chain ' +
            'still unreachable). Poll /v1/health to observe readiness.',
          restartOutcomeSchema,
        ),
        ...errorRefs.mutate,
      },
    },
  },

  '/v1/auctions/{auctionId}/finalisation': {
    put: {
      tags: ['auctions'],
      operationId: 'finaliseAuction',
      summary: 'Approve or reject the computed allocation',
      parameters: [auctionIdPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: finaliseBodySchema } },
      },
      responses: {
        200: successJson('Updated auction after finalisation', auctionSchema),
        ...errorRefs.mutate,
      },
    },
  },
};

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'NB Bond Auction Service',
    version: '2.0.0',
    description:
      'Public API for the CBDC tokenization sandbox bond service. ' +
      'Sandbox-scale demo backing the nb-ui reference frontend. ' +
      'See docs/plans/archive/openapi-v2-plan.md for design notes.',
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  servers: [
    {
      url: 'http://bond-api.cbdc-sandbox.local',
      description: 'Local Kind sandbox',
    },
  ],
  tags: [
    { name: 'system', description: 'Service health' },
    { name: 'bonds', description: 'Bond resources (root of the resource tree)' },
    { name: 'auctions', description: 'Auction resources (bid/allocation subtree of a bond)' },
    {
      name: 'bidders',
      description:
        'Sandbox bidder roster used by the impersonated-bid flow. Private keys are stored ' +
        'in plaintext — sandbox-only, never deploy against real funds.',
    },
    {
      name: 'central-bank',
      description:
        'Central Bank (Norges Bank) operator surface against the WNOK contract: mint, burn, ' +
        'transfer, allowlist add/remove. Operator-only — entra mode requires an operator App ' +
        'Role and returns 403 otherwise. Sandbox-only.',
    },
    {
      name: 'banking',
      description:
        'Commercial-bank tokenized deposits (TBD): one ERC-20 per bank, with supply, WNOK ' +
        'reserve backing, holders, and (mutations) allowlist / mint / burn / transfer. ' +
        'Operator-only — entra mode requires an operator App Role (403 otherwise). Sandbox-only.',
    },
    {
      name: 'admin',
      description:
        'Operator-only ingestion lifecycle (restart loop, drop-and-rebuild projection). ' +
        'Requires an operator App Role in entra mode (403 otherwise); auth is a no-op in ' +
        'none mode.',
    },
  ],
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Microsoft Entra ID access token. In deployments where NB_BOND_API_AUTH_MODE=none ' +
          '(local sandbox default), the header is accepted but not validated. In entra mode the ' +
          'token must carry a recognised App Role in its `roles` claim (see the 403 response); ' +
          'Central Bank endpoints require an operator role.',
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation failed; `errors[]` populated.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Unauthorized: {
        description: 'Authentication required or token invalid.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Forbidden: {
        description:
          'Authenticated, but the token lacks a role required for this resource (entra mode ' +
          'only). Central Bank endpoints require an operator App Role; every other endpoint ' +
          'requires at least one recognised role.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      NotFound: {
        description: 'Resource does not exist.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Conflict: {
        description: 'Operation conflicts with current resource state.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      InternalError: {
        description: 'Unexpected server error.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
    },
  },
});

// #endregion

// #region Internal-only schemas (not part of the OpenAPI surface) ────

// Decrypted bid plaintext; validated server-side after bid unsealing.
// Not exposed in any response — auctioneer-internal only.
export const bidPlaintextSchema = z.object({
  isin: z.string(),
  bidder: addressSchema,
  nonce: z.string(),
  rate: bpsSchema,
  units: bigIntStringSchema,
  salt: z.string(),
  bidderNonce: bigIntStringSchema,
  bidderSig: hexStringSchema,
});

// #endregion

// #region Re-exports (used by handlers & tests) ──────────────────────

export {
  closeAuctionBodySchema,
  createAuctionBodySchema,
  createBondBodySchema,
  finaliseBodySchema,
  holdersBodySchema,
  isinParamSchema,
  auctionIdParamSchema,
  historyQuerySchema,
  bidderAddressParamSchema,
  createBidderBodySchema,
  bidderSchema,
  submitBidBodySchema,
  centralBankSchema,
  allowlistEntrySchema,
  transactionRefSchema,
  wnokMintBurnBodySchema,
  wnokTransferBodySchema,
};

export type Address = z.infer<typeof addressSchema>;
export type HexString = z.infer<typeof hexStringSchema>;
export type BigIntString = z.infer<typeof bigIntStringSchema>;
export type Bps = z.infer<typeof bpsSchema>;
export type Isin = z.infer<typeof isinSchema>;
export type AuctionId = z.infer<typeof auctionIdSchema>;

export type AuctionType = z.infer<typeof auctionTypeSchema>;
export type AuctionStatus = z.infer<typeof auctionStatusSchema>;
export type BondStatus = z.infer<typeof bondStatusSchema>;
export type BidState = z.infer<typeof bidStateSchema>;

export type Bond = z.infer<typeof bondSchema>;
export type Auction = z.infer<typeof auctionSchema>;
export type Bid = z.infer<typeof bidSchema>;
export type SealedBid = z.infer<typeof sealedBidSchema>;
export type UnsealedBid = z.infer<typeof unsealedBidSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AllocationEntry = z.infer<typeof allocationEntrySchema>;
export type HolderBalance = z.infer<typeof holderBalanceSchema>;
export type HistoryEvent = z.infer<typeof historyEventSchema>;
export type Health = z.infer<typeof healthSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type TxRef = z.infer<typeof txRefSchema>;

export type CreateAuctionBody = z.infer<typeof createAuctionBodySchema>;
export type CreateBondBody = z.infer<typeof createBondBodySchema>;
export type CloseAuctionBody = z.infer<typeof closeAuctionBodySchema>;
export type FinaliseBody = z.infer<typeof finaliseBodySchema>;
export type HoldersBody = z.infer<typeof holdersBodySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type Bidder = z.infer<typeof bidderSchema>;
export type CreateBidderBody = z.infer<typeof createBidderBodySchema>;
export type SubmitBidBody = z.infer<typeof submitBidBodySchema>;
export type CentralBank = z.infer<typeof centralBankSchema>;
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;
export type TransactionRefDto = z.infer<typeof transactionRefSchema>;
export type WnokMintBurnBody = z.infer<typeof wnokMintBurnBodySchema>;
export type WnokTransferBody = z.infer<typeof wnokTransferBodySchema>;

// #endregion
