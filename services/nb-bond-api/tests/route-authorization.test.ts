/**
 * Route-level authorization in `entra` mode, through the real auth middleware
 * and the real route wiring in createApp. The ROUTES table covers every
 * mutating route, so removing or misplacing any gate fails a row.
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

const BAD_ID = 'not-a-bytes32';
const BAD_ADDRESS = 'not-an-address';
const ISIN = 'NO0000000001';

/**
 * Every mutating route with an input that fails validation right after the
 * gate, so a passing gate answers without reaching the chain. `pass` is the
 * status a caller who clears the gate gets. `DELETE /v1/bonds/{isin}` has no
 * invalid path value, so it reaches the handler and fails on the offline
 * chain (500); `/v1/admin` is covered through its prefix guard.
 */
const ROUTES: Array<{
  gate: 'operator' | 'recognised';
  method: string;
  path: string;
  body?: unknown;
  pass: number;
}> = [
  // Issuer actions (operator-only).
  { gate: 'operator', method: 'POST', path: '/v1/bonds', body: {}, pass: 400 },
  { gate: 'operator', method: 'DELETE', path: `/v1/bonds/${ISIN}`, pass: 500 },
  { gate: 'operator', method: 'POST', path: `/v1/bonds/${ISIN}/auctions`, body: {}, pass: 400 },
  {
    gate: 'operator',
    method: 'PATCH',
    path: `/v1/auctions/${BAD_ID}`,
    body: { status: 'closed' },
    pass: 400,
  },
  { gate: 'operator', method: 'DELETE', path: `/v1/auctions/${BAD_ID}`, pass: 400 },
  {
    gate: 'operator',
    method: 'PUT',
    path: `/v1/auctions/${BAD_ID}/finalisation`,
    body: { approve: true },
    pass: 400,
  },
  {
    gate: 'operator',
    method: 'POST',
    path: `/v1/bonds/${ISIN}/coupon-payments`,
    body: { holders: [BAD_ADDRESS] },
    pass: 400,
  },
  // Admin and Central Bank prefix guards (operator-only).
  { gate: 'operator', method: 'POST', path: '/v1/admin/no-such-route', pass: 404 },
  {
    gate: 'operator',
    method: 'PUT',
    path: `/v1/central-bank/allowlist/${BAD_ADDRESS}`,
    pass: 400,
  },
  { gate: 'operator', method: 'POST', path: '/v1/central-bank/wnok/mint', body: {}, pass: 400 },
  // Bidding and Banking (any recognised role).
  { gate: 'recognised', method: 'POST', path: '/v1/bidders', body: {}, pass: 400 },
  { gate: 'recognised', method: 'DELETE', path: `/v1/bidders/${BAD_ADDRESS}`, pass: 400 },
  {
    gate: 'recognised',
    method: 'POST',
    path: `/v1/bidders/${BAD_ADDRESS}/bids`,
    body: {},
    pass: 400,
  },
  { gate: 'recognised', method: 'POST', path: '/v1/banking/banks', body: {}, pass: 400 },
  {
    gate: 'recognised',
    method: 'PUT',
    path: `/v1/banking/tbd/${BAD_ADDRESS}/allowlist/${BAD_ADDRESS}`,
    pass: 400,
  },
  {
    gate: 'recognised',
    method: 'POST',
    path: `/v1/banking/tbd/${BAD_ADDRESS}/mint`,
    body: {},
    pass: 400,
  },
];

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

  it.each(ROUTES)('$method $path: operators clear the gate', async (route) => {
    const response = await call('operator', route.method, route.path, route.body);
    expect(response.status).toBe(route.pass);
  });

  it.each(ROUTES)('$method $path: testers get the $gate gate', async (route) => {
    const response = await call('tester', route.method, route.path, route.body);
    expect(response.status).toBe(route.gate === 'operator' ? 403 : route.pass);
  });

  it('rejects a request without a bearer token', async () => {
    const response = await fetch(`${baseUrl}/v1/bonds`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

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
