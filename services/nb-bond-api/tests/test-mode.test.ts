/**
 * parseTestMode — the `testMode` flag is honoured in `none` mode and for
 * operator callers in `entra` mode; a tester's flag is ignored (not rejected).
 * Env is set before (re)importing so src/auth picks up the mode at load, as in
 * tests/auth.test.ts.
 */
import type { Request, Response } from 'express';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

const originalEnv = { ...process.env };

const entraEnv = {
  NB_BOND_API_AUTH_MODE: 'entra',
  NB_BOND_API_AUTH_ENTRA_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  NB_BOND_API_AUTH_ENTRA_AUDIENCE: 'api://test',
  NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES: 'Sandbox.Operator',
  NB_BOND_API_AUTH_ENTRA_TESTER_ROLES: 'Sandbox.Tester',
};

function loadParseTestMode(env: Record<string, string>) {
  jest.resetModules();
  process.env = { ...originalEnv, ...env };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../src/test-mode') as typeof import('../src/test-mode')).parseTestMode;
}

function request(testMode: string | undefined, roles?: string[]) {
  const req = { query: testMode === undefined ? {} : { testMode } } as unknown as Request;
  const res = { locals: roles ? { authRoles: roles } : {} } as unknown as Response;
  return { req, res };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('parseTestMode', () => {
  it('honours the flag in none mode', () => {
    const parseTestMode = loadParseTestMode({ NB_BOND_API_AUTH_MODE: 'none' });
    for (const value of ['true', '1']) {
      const { req, res } = request(value);
      expect(parseTestMode(req, res)).toBe(true);
    }
    const off = request(undefined);
    expect(parseTestMode(off.req, off.res)).toBe(false);
  });

  it('honours the flag for an operator in entra mode', () => {
    const parseTestMode = loadParseTestMode(entraEnv);
    const { req, res } = request('true', ['Sandbox.Operator']);
    expect(parseTestMode(req, res)).toBe(true);
  });

  it('ignores the flag for a tester in entra mode', () => {
    const parseTestMode = loadParseTestMode(entraEnv);
    const { req, res } = request('true', ['Sandbox.Tester']);
    expect(parseTestMode(req, res)).toBe(false);
  });
});
