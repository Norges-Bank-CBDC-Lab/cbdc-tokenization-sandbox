import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

jest.mock('../src/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  operatorRoles: ['Sandbox.Operator'],
  recognizedRoles: ['Sandbox.Operator', 'Sandbox.Tester'],
}));

import { createApp } from '../src/app';
import { openDatabase, type IngestionDatabase } from '../src/ingestion-db';

describe('createApp', () => {
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
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    db.close();
  });

  it('serves the generated contract without starting the configured process listener', async () => {
    const response = await fetch(`${baseUrl}/v1/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as { info: { version: string } };
    expect(document.info.version).toBe('1.0.0');
  });

  it('applies boundary validation before feature orchestration', async () => {
    const response = await fetch(`${baseUrl}/v1/auctions/not-a-bytes32`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      title: 'Validation failed',
      status: 400,
    });
  });
});
