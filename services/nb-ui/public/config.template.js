// Runtime-config template. At container start an init step substitutes the
// __PLACEHOLDERS__ from chart-supplied env vars (envsubst-style) and writes the
// result to /usr/share/nginx/html/config.js so the same built bundle works in
// every environment without a rebuild. See services/nb-ui/DEVELOPMENT.md.
window.__APP_CONFIG__ = {
  API_BASE_URL: '__API_BASE_URL__',
  AUTH_MODE: '__AUTH_MODE__',
  AUTH_TENANT_ID: '__AUTH_TENANT_ID__',
  AUTH_CLIENT_ID: '__AUTH_CLIENT_ID__',
  AUTH_AUTHORITY: '__AUTH_AUTHORITY__',
  AUTH_SCOPES: '__AUTH_SCOPES__',
  AUTH_REDIRECT_URI: '__AUTH_REDIRECT_URI__',
  AUTH_OPERATOR_ROLES: '__AUTH_OPERATOR_ROLES__',
  AUTH_TESTER_ROLES: '__AUTH_TESTER_ROLES__',
};
