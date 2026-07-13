import { afterEach, describe, expect, it, vi } from 'vitest';

describe('runtime config', () => {
  afterEach(() => {
    window.__APP_CONFIG__.LIVE_UPDATES = undefined;
    vi.resetModules();
  });

  it('enables live updates by default', async () => {
    delete window.__APP_CONFIG__.LIVE_UPDATES;
    const { AppConfig } = await import('../src/config.js');
    expect(AppConfig.LIVE_UPDATES).toBe(true);
  });

  it('accepts the string false emitted by env substitution', async () => {
    window.__APP_CONFIG__.LIVE_UPDATES = 'false';
    const { AppConfig } = await import('../src/config.js');
    expect(AppConfig.LIVE_UPDATES).toBe(false);
  });
});
