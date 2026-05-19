/**
 * AppConfig — runtime configuration reader.
 *
 * Values come from window.__APP_CONFIG__ which is populated by /config.js
 * (loaded by index.html before this bundle runs). The same built bundle is
 * served in every environment; the file at /config.js is what changes per
 * deployment — see services/nb-ui/DEVELOPMENT.md "Runtime config injection".
 *
 * Defaults below are safety net only — index.html always loads /config.js
 * first, so they only kick in if that script is missing entirely (e.g.
 * during a unit test that doesn't set up the global).
 */
const defaults = {
  USE_MOCK: false,
  API_BASE_URL: 'http://bond-api.cbdc-sandbox.local',
  AUTH_MODE: 'none',
  AUTH_TENANT_ID: '',
  AUTH_CLIENT_ID: '',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: '',
  AUTH_REDIRECT_URI: '',
  MOCK_LATENCY_MS: 0,
};

function readWindowConfig() {
  if (typeof window === 'undefined') return {};
  return window.__APP_CONFIG__ ?? {};
}

export const AppConfig = { ...defaults, ...readWindowConfig() };
