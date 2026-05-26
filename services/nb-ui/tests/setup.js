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

// Vitest 4's default localStorage shim is partial (warning:
// "--localstorage-file was provided without a valid path"). Replace it
// with a Map-backed Storage that implements the full Web Storage API the
// production code relies on (debugSettings, BondsPage Show-disabled
// toggle, etc.).
{
  const store = new Map();
  const storage = {
    get length() {
      return store.size;
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}
