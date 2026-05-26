import '@testing-library/jest-dom/vitest';

// Default runtime config for tests. Individual tests override window.__APP_CONFIG__
// before importing modules that read it (use vi.resetModules + dynamic import
// when the override needs to take effect).
window.__APP_CONFIG__ = {
  API_BASE_URL: 'http://test.local',
  AUTH_MODE: 'none',
  AUTH_TENANT_ID: '',
  AUTH_CLIENT_ID: '',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: '',
  AUTH_REDIRECT_URI: '',
};
