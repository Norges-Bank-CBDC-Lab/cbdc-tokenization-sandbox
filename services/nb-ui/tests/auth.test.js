import { describe, it, expect, beforeEach, vi } from 'vitest';

// Auth-mode resolution is decided at module load (in src/auth/index.js).
// Each test resets the module graph so the resolver re-runs against a
// freshly-set window.__APP_CONFIG__.

describe('auth plugin resolver', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns the no-auth provider when AUTH_MODE is "none"', async () => {
    window.__APP_CONFIG__.AUTH_MODE = 'none';
    const { auth, authMode } = await import('../src/auth/index.js');
    expect(authMode).toBe('none');
    expect(await auth.getAuthHeader()).toBeNull();
    expect(auth.getAccount()).toBeNull();
  });

  it('returns the no-auth provider when AUTH_MODE is unset', async () => {
    window.__APP_CONFIG__.AUTH_MODE = '';
    const { auth, authMode } = await import('../src/auth/index.js');
    expect(authMode).toBe('none');
    expect(await auth.getAuthHeader()).toBeNull();
  });

  it('falls back to no-auth on an unknown AUTH_MODE (with a warning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.__APP_CONFIG__.AUTH_MODE = 'pigeon-courier';
    const { auth } = await import('../src/auth/index.js');
    expect(await auth.getAuthHeader()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('selects the Entra provider when AUTH_MODE is "entra"', async () => {
    window.__APP_CONFIG__.AUTH_MODE = 'entra';
    window.__APP_CONFIG__.AUTH_TENANT_ID = '11111111-1111-1111-1111-111111111111';
    window.__APP_CONFIG__.AUTH_CLIENT_ID = '22222222-2222-2222-2222-222222222222';
    const { authMode, auth } = await import('../src/auth/index.js');
    expect(authMode).toBe('entra');
    // Entra provider has the same interface; getAccount before init is null.
    expect(auth.getAccount()).toBeNull();
  });
});
