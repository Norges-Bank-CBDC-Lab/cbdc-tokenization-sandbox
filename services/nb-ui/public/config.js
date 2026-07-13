// Local-dev runtime config. Served verbatim by `vite dev`.
// In a deployed environment, an init container renders this file from
// public/config.template.js using envsubst before nginx starts (see
// services/nb-ui/DEVELOPMENT.md "Runtime config injection").
window.__APP_CONFIG__ = {
  API_BASE_URL: 'http://bond-api.cbdc-sandbox.local',
  EXPLORER_BASE_URL: 'http://blockscout.cbdc-sandbox.local',
  AUTH_MODE: 'none',
  AUTH_TENANT_ID: '',
  AUTH_CLIENT_ID: '',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: '',
  AUTH_REDIRECT_URI: '',
  LIVE_UPDATES: true,
};
