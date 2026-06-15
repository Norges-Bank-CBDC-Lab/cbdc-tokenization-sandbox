import { afterEach, describe, expect, it, vi } from 'vitest';

// Feature: the role -> capability policy in src/auth/capabilities.js. Role
// lists come from runtime config (AUTH_OPERATOR_ROLES / AUTH_TESTER_ROLES),
// read at module load — so each case re-imports against a fresh config.

async function loadCapabilities(config) {
  vi.resetModules();
  window.__APP_CONFIG__ = config;
  const mod = await import('../src/auth/capabilities.js');
  return mod.capabilitiesForAccount;
}

const entra = {
  AUTH_MODE: 'entra',
  AUTH_OPERATOR_ROLES: 'Sandbox.Operator',
  AUTH_TESTER_ROLES: 'Sandbox.Tester',
};

afterEach(() => {
  delete window.__APP_CONFIG__;
  vi.resetModules();
});

describe('capabilitiesForAccount', () => {
  it('grants full access in none mode regardless of roles', async () => {
    const cap = await loadCapabilities({ AUTH_MODE: 'none' });
    expect(cap(null)).toEqual({ canUseApp: true, canAccessCentralBank: true });
    expect(cap({ roles: [] })).toEqual({ canUseApp: true, canAccessCentralBank: true });
  });

  it('grants full access to an operator', async () => {
    const cap = await loadCapabilities(entra);
    expect(cap({ roles: ['Sandbox.Operator'] })).toEqual({
      canUseApp: true,
      canAccessCentralBank: true,
    });
  });

  it('grants the UI without Central Bank to a tester', async () => {
    const cap = await loadCapabilities(entra);
    expect(cap({ roles: ['Sandbox.Tester'] })).toEqual({
      canUseApp: true,
      canAccessCentralBank: false,
    });
  });

  it('denies an account with no recognised role', async () => {
    const cap = await loadCapabilities(entra);
    expect(cap({ roles: ['Some.Other.Role'] })).toEqual({
      canUseApp: false,
      canAccessCentralBank: false,
    });
    expect(cap(null)).toEqual({ canUseApp: false, canAccessCentralBank: false });
  });

  it('lets operator capabilities win when an account holds both roles', async () => {
    const cap = await loadCapabilities(entra);
    expect(cap({ roles: ['Sandbox.Tester', 'Sandbox.Operator'] })).toEqual({
      canUseApp: true,
      canAccessCentralBank: true,
    });
  });
});
