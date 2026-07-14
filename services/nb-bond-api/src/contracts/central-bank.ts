import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import {
  addressSchema,
  bigIntStringSchema,
  blockNumberSchema,
  hexStringSchema,
  md5Schema,
} from './common';
import { errorRefs, successJson } from '../openapi/shared-responses';

export const allowlistEntrySchema = z
  .object({
    address: addressSchema,
    wnokBalance: bigIntStringSchema.nullable().meta({
      description: "The address's current WNOK balance; null when the chain read failed.",
    }),
    md5: md5Schema,
  })
  .meta({
    id: 'AllowlistEntry',
    description: 'A single allowlisted address with its live WNOK holding',
  });

export const transactionRefSchema = z
  .object({
    hash: hexStringSchema,
    block: blockNumberSchema,
  })
  .meta({
    id: 'TransactionRef',
    description: 'On-chain transaction reference (hash + block)',
  });

export const centralBankSchema = z
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
        totalSupply: bigIntStringSchema.meta({
          description: 'Total WNOK in existence (minted minus burned), in 1-NOK units',
        }),
        allowlistSize: z.number().int().nonnegative(),
      })
      .nullable()
      .meta({
        description: 'WNOK binding state. Null when WNOK is unreachable.',
      }),
    govSettlementBank: z
      .object({
        name: z.string().meta({ description: 'Bank whose TBD settles government bond payments' }),
        address: addressSchema,
      })
      .nullable()
      .meta({
        description:
          "BondManager.GOV_TBD resolved to a configured bank — the government's bond-payment settlement bank. Null when BondManager is unavailable.",
      }),
    md5: md5Schema,
  })
  .meta({
    id: 'CentralBank',
    description: 'Central Bank operator summary',
  });

export const registeredContractSchema = z
  .object({
    name: z
      .string()
      .meta({ description: 'Name the contract is registered under in GlobalRegistry' }),
    address: addressSchema,
  })
  .meta({
    id: 'RegisteredContract',
    description: 'A contract registered in the GlobalRegistry (name -> address)',
  });

export const wnokMintBurnBodySchema = z
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

export const wnokTransferBodySchema = z
  .object({
    to: addressSchema,
    amount: bigIntStringSchema,
  })
  .meta({
    id: 'WnokTransferBody',
    description: 'Body for a transfer from the CB account',
  });

export const centralBankPaths: ZodOpenApiPathsObject = {
  '/v1/registry': {
    get: {
      tags: ['system'],
      operationId: 'listRegistry',
      summary: 'List contracts registered in the GlobalRegistry',
      responses: {
        200: successJson(
          'Registered contracts (name -> address); the GlobalRegistry itself is first.',
          z.array(registeredContractSchema),
        ),
      },
    },
  },
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
};

export type CentralBank = z.infer<typeof centralBankSchema>;
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;
export type TransactionRefDto = z.infer<typeof transactionRefSchema>;
export type WnokMintBurnBody = z.infer<typeof wnokMintBurnBodySchema>;
export type WnokTransferBody = z.infer<typeof wnokTransferBodySchema>;
