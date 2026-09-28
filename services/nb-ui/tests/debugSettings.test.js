import { afterEach, describe, expect, it, vi } from 'vitest';

// Feature: getTestMode() in src/utils/debugSettings.js reports the stored
// test-mode flag only for accounts that can operate (always in none mode), so
// a flag left in localStorage never reaches the API for a tester.

async function loadDebugSettings({ authMode, account = null }) {
  vi.resetModules();
  window.__APP_CONFIG__ = {
    API_BASE_URL: 'http://test.local',
    AUTH_MODE: authMode,
    AUTH_OPERATOR_ROLES: 'Sandbox.Operator',
    AUTH_TESTER_ROLES: 'Sandbox.Tester',
  };
  vi.doMock('../src/auth/index.js', () => ({ auth: { getAccount: () => account }, authMode }));
  return import('../src/utils/debugSettings.js');
}

afterEach(() => {
  vi.doUnmock('../src/auth/index.js');
  vi.resetModules();
  window.localStorage.clear();
});

describe('getTestMode', () => {
  it('returns the stored flag in none mode', async () => {
    const { getTestMode, setTestMode } = await loadDebugSettings({ authMode: 'none' });
    expect(getTestMode()).toBe(false);
    setTestMode(true);
    expect(getTestMode()).toBe(true);
  });

  it('returns the stored flag for an operator', async () => {
    window.localStorage.setItem('nbui.testMode', 'true');
    const { getTestMode } = await loadDebugSettings({
      authMode: 'entra',
      account: { roles: ['Sandbox.Operator'] },
    });
    expect(getTestMode()).toBe(true);
  });

  it('ignores a stored flag for a tester', async () => {
    window.localStorage.setItem('nbui.testMode', 'true');
    const { getTestMode } = await loadDebugSettings({
      authMode: 'entra',
      account: { roles: ['Sandbox.Tester'] },
    });
    expect(getTestMode()).toBe(false);
  });
});
