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
  API_BASE_URL: 'http://bond-api.cbdc-sandbox.local',
  EXPLORER_BASE_URL: 'http://blockscout.cbdc-sandbox.local',
  AUTH_MODE: 'none',
  AUTH_TENANT_ID: '',
  AUTH_CLIENT_ID: '',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: '',
  AUTH_REDIRECT_URI: '',
  AUTH_OPERATOR_ROLES: '',
  AUTH_TESTER_ROLES: '',
  LIVE_UPDATES: true,
};

function readWindowConfig() {
  if (typeof window === 'undefined') return {};
  return window.__APP_CONFIG__ ?? {};
}

const configured = { ...defaults, ...readWindowConfig() };

function booleanConfig(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export const AppConfig = {
  ...configured,
  LIVE_UPDATES: booleanConfig(configured.LIVE_UPDATES, defaults.LIVE_UPDATES),
};
