/**
 * Auth middleware tests — role capture + authorization gates.
 *
 * `jose` is mocked so jwtVerify returns a chosen payload without a real Entra
 * tenant. Env is set before (re)importing src/auth so the module picks up
 * entra mode + role config at load — mirrors tests/env-vars.test.ts.
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

function loadAuth(extra: Record<string, string>) {
  jest.resetModules();
  process.env = { ...originalEnv, ...extra };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../src/auth') as typeof import('../src/auth');
}

function joseMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('jose') as { jwtVerify: jest.Mock; createRemoteJWKSet: jest.Mock };
}

function mockReqRes(authHeader?: string) {
  const captured: { statusCode?: number; body?: unknown } = {};
  const locals: Record<string, unknown> = {};
  const res = {
    locals,
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      captured.body = payload;
      return res;
    },
  } as unknown as Response;
  const req = {
    header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
    originalUrl: '/v1/test',
  } as unknown as Request;
  return { req, res, captured, locals };
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
});

describe('requireAnyRole', () => {
  it('is a no-op in none mode (passes through without a role)', () => {
    const { requireAnyRole } = loadAuth({ NB_BOND_API_AUTH_MODE: 'none' });
    const { req, res, captured } = mockReqRes();
    const next = jest.fn();
    requireAnyRole(['Sandbox.Operator'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBeUndefined();
  });

  it('allows a token whose roles intersect the allow-list (entra)', () => {
    const { requireAnyRole, operatorRoles } = loadAuth(entraEnv);
    const { req, res, captured, locals } = mockReqRes();
    locals.authRoles = ['Sandbox.Operator'];
    const next = jest.fn();
    requireAnyRole(operatorRoles)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBeUndefined();
  });

  it('rejects a tester-only token on the operator gate, allows it on the baseline gate (entra)', () => {
    const { requireAnyRole, operatorRoles, recognizedRoles } = loadAuth(entraEnv);

    const cb = mockReqRes();
    cb.locals.authRoles = ['Sandbox.Tester'];
    const cbNext = jest.fn();
    requireAnyRole(operatorRoles)(cb.req, cb.res, cbNext);
    expect(cbNext).not.toHaveBeenCalled();
    expect(cb.captured.statusCode).toBe(403);

    const base = mockReqRes();
    base.locals.authRoles = ['Sandbox.Tester'];
    const baseNext = jest.fn();
    requireAnyRole(recognizedRoles)(base.req, base.res, baseNext);
    expect(baseNext).toHaveBeenCalledTimes(1);
    expect(base.captured.statusCode).toBeUndefined();
  });

  it('rejects a no-recognised-role token on the baseline gate with 403 (entra)', () => {
    const { requireAnyRole, recognizedRoles } = loadAuth(entraEnv);
    const { req, res, captured, locals } = mockReqRes();
    locals.authRoles = [];
    const next = jest.fn();
    requireAnyRole(recognizedRoles)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(403);
  });
});

describe('authMiddleware role capture', () => {
  it('passes through in none mode', async () => {
    const { authMiddleware } = loadAuth({ NB_BOND_API_AUTH_MODE: 'none' });
    const { req, res } = mockReqRes();
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('captures the roles claim from a verified token (entra)', async () => {
    const { authMiddleware } = loadAuth(entraEnv);
    joseMock().jwtVerify.mockResolvedValue({ payload: { roles: ['Sandbox.Operator'] } });
    const { req, res, locals } = mockReqRes('Bearer good-token');
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(locals.authRoles).toEqual(['Sandbox.Operator']);
  });

  it('defaults to an empty role set when the token has no roles claim (entra)', async () => {
    const { authMiddleware } = loadAuth(entraEnv);
    joseMock().jwtVerify.mockResolvedValue({ payload: { sub: 'user-1' } });
    const { req, res, locals } = mockReqRes('Bearer good-token');
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(locals.authRoles).toEqual([]);
  });

  it('rejects a missing token with 401 (entra)', async () => {
    const { authMiddleware } = loadAuth(entraEnv);
    const { req, res, captured } = mockReqRes();
    const next = jest.fn();
    await authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(401);
  });
});
