import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { addressSchema, bigIntStringSchema, md5Schema } from './common';
import { transactionRefSchema } from './central-bank';
import { errorRefs, successJson } from '../openapi/shared-responses';

export const tbdHolderSchema = z
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

export const tbdTokenSchema = z
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
        bankAllowlisted: z.boolean().meta({
          description:
            "True when the owning bank's address is on the WNOK allowlist — i.e. it can hold the " +
            'WNOK reserve and settle cross-bank in WNOK. Distinct from government-nomination.',
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

export const tbdMintBurnBodySchema = z
  .object({
    address: addressSchema.meta({ description: 'Target address (must be on the TBD allowlist)' }),
    amount: bigIntStringSchema.meta({ description: 'Amount in whole TBD units (decimals = 0)' }),
  })
  .meta({
    id: 'TbdMintBurnBody',
    description: 'Body for TBD mint / burn operations',
  });

export const tbdTransferBodySchema = z
  .object({
    to: addressSchema,
    amount: bigIntStringSchema,
  })
  .meta({
    id: 'TbdTransferBody',
    description: "Body for a transfer from the owning bank's account",
  });

export const bankInfoSchema = z
  .object({
    name: z.string().meta({ description: 'Bank label, e.g. "Nordea Bank"' }),
    address: addressSchema.meta({
      description:
        "The bank's on-chain EVM address as recorded by its TBD contract (getBankAddress) — " +
        'always chain truth, never derived from server-side key material',
    }),
    actAsAvailable: z.boolean().meta({
      description:
        'Whether the API holds a signing key matching this bank address, i.e. whether ' +
        '"act as bank" mutations (mint / burn / transfer / allowlist) can succeed. False when ' +
        "the environment's on-chain bank was not created with a key this API knows",
    }),
    md5: md5Schema,
  })
  .meta({
    id: 'BankInfo',
    description:
      'A bank the operator can act as — configured fixture or created from the Banking page. ' +
      'The server holds the signing key; only the address is exposed. Feeds the UI bank selector.',
  });

export const createBankBodySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .meta({
        description:
          'Human-readable bank label. Also derives the GlobalRegistry key ("TBD <name>") ' +
          'and the token symbol.',
      }),
    privateKey: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional()
      .meta({
        description: 'Optional import of an existing 32-byte hex key. Generated if omitted.',
      }),
    enableWnokSettlement: z
      .boolean()
      .default(true)
      .meta({
        description:
          'Add the bank address to the WNOK allowlist so it can hold the WNOK reserve and ' +
          'settle cross-bank. Default true.',
      }),
  })
  .meta({
    id: 'CreateBankBody',
    description: 'Request body for creating a bank (deploys a fresh TBD contract)',
  });

const tbdAddressPathParam = {
  in: 'path' as const,
  name: 'address',
  required: true,
  schema: { $ref: '#/components/schemas/Address' },
};

const tbdHolderPathParam = {
  in: 'path' as const,
  name: 'holder',
  required: true,
  schema: { $ref: '#/components/schemas/Address' },
};

export const bankingPaths: ZodOpenApiPathsObject = {
  '/v1/banking/banks': {
    get: {
      tags: ['banking'],
      operationId: 'listBanks',
      summary: 'List the banks the operator can act as (configured + created; signer selector)',
      responses: {
        200: successJson('Banks (configured + created)', z.array(bankInfoSchema)),
        ...errorRefs.read,
      },
    },
    post: {
      tags: ['banking'],
      operationId: 'createBank',
      summary:
        'Create a bank: deploy a fresh TBD signed by the bank key (generated when privateKey ' +
        'is omitted), register "TBD <name>" in GlobalRegistry, and optionally add the bank to ' +
        'the WNOK allowlist',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createBankBodySchema } },
      },
      responses: {
        200: successJson('Newly created bank', bankInfoSchema),
        ...errorRefs.mutate,
      },
    },
  },
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
  '/v1/banking/tbd/{address}/allowlist/{holder}': {
    put: {
      tags: ['banking'],
      operationId: 'addToTbdAllowlist',
      summary: "Add an address to a TBD's allowlist (signed by the owning bank; idempotent)",
      parameters: [tbdAddressPathParam, tbdHolderPathParam],
      responses: {
        200: successJson('Transaction reference for the on-chain add', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
    delete: {
      tags: ['banking'],
      operationId: 'removeFromTbdAllowlist',
      summary: "Remove an address from a TBD's allowlist (signed by the owning bank; idempotent)",
      parameters: [tbdAddressPathParam, tbdHolderPathParam],
      responses: {
        200: successJson('Transaction reference for the on-chain remove', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/banking/tbd/{address}/mint': {
    post: {
      tags: ['banking'],
      operationId: 'mintTbd',
      summary: 'Mint TBD to an allowlisted address (signed by the owning bank)',
      parameters: [tbdAddressPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: tbdMintBurnBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the mint', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/banking/tbd/{address}/burn': {
    post: {
      tags: ['banking'],
      operationId: 'burnTbd',
      summary: 'Burn TBD from an allowlisted address (signed by the owning bank)',
      parameters: [tbdAddressPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: tbdMintBurnBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the burn', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
  '/v1/banking/tbd/{address}/transfer': {
    post: {
      tags: ['banking'],
      operationId: 'transferTbd',
      summary: "Transfer TBD from the owning bank's account to an allowlisted recipient",
      parameters: [tbdAddressPathParam],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: tbdTransferBodySchema } },
      },
      responses: {
        200: successJson('Transaction reference for the transfer', transactionRefSchema),
        ...errorRefs.mutate,
      },
    },
  },
};

export type TbdMintBurnBody = z.infer<typeof tbdMintBurnBodySchema>;
export type TbdTransferBody = z.infer<typeof tbdTransferBodySchema>;
export type CreateBankBody = z.infer<typeof createBankBodySchema>;
