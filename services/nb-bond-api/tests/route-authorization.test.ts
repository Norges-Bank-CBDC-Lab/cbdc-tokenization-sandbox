/**
 * Route-level authorization in `entra` mode, through the real auth middleware
 * and the real route wiring in createApp.
 *
 * `jose` is mocked so a bearer token's text becomes its `roles` claim
 * (`Bearer operator` → the operator role, `Bearer tester` → the tester role).
 * The chain seam is mocked offline so no handler reaches a node. Env is set
 * before requiring the app, because src/env-vars and src/auth read it at load.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { IngestionDatabase } from '../src/ingestion-db';

const OPERATOR_ROLE = 'Sandbox.Operator';
const TESTER_ROLE = 'Sandbox.Tester';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(async (token: string) => ({
    payload: { roles: token === 'operator' ? ['Sandbox.Operator'] : ['Sandbox.Tester'] },
  })),
}));

jest.mock('../src/chain', () => {
  const offline = async () => {
    throw new Error('chain offline in this test');
  };
  return {
    ...jest.requireActual('../src/chain'),
    provider: { getBalance: async () => 0n },
    getWnok: offline,
    getBondManager: offline,
    getBondToken: offline,
    getBondAuction: offline,
  };
});

const originalEnv = { ...process.env };
process.env = {
  ...originalEnv,
  NB_BOND_API_AUTH_MODE: 'entra',
  NB_BOND_API_AUTH_ENTRA_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  NB_BOND_API_AUTH_ENTRA_AUDIENCE: 'api://test',
  NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES: OPERATOR_ROLE,
  NB_BOND_API_AUTH_ENTRA_TESTER_ROLES: TESTER_ROLE,
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { openDatabase } = require('../src/ingestion-db') as typeof import('../src/ingestion-db');
const { createBidder } = require('../src/bidders') as typeof import('../src/bidders');
/* eslint-enable @typescript-eslint/no-require-imports */

type Caller = 'operator' | 'tester';

describe('route authorization (entra mode)', () => {
  const db = openDatabase({ dbPath: ':memory:', readonly: false }) as IngestionDatabase & {
    close: () => void;
  };
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ historyDb: db, biddersDb: db });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    db.close();
    process.env = { ...originalEnv };
  });

  function call(caller: Caller, method: string, path: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${caller}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('returns no bidder private key outside none mode, for testers and operators alike', async () => {
    createBidder(db, { name: 'Generated' });
    for (const caller of ['tester', 'operator'] as const) {
      const response = await call(caller, 'GET', '/v1/bidders');
      expect(response.status).toBe(200);
      const bidders = (await response.json()) as Array<{ name: string; privateKey: unknown }>;
      expect(bidders.map((b) => b.name)).toContain('Generated');
      for (const bidder of bidders) expect(bidder.privateKey).toBeNull();
    }
  });
});
