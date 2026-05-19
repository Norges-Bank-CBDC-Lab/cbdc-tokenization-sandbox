/**
 * entraAuth — Microsoft Entra (Azure AD) OIDC plugin via MSAL Browser.
 *
 * Activated only when window.__APP_CONFIG__.AUTH_MODE === "entra". MSAL is
 * loaded with a dynamic import so the no-auth bundle path doesn't pay the
 * MSAL bytes.
 *
 * Tenant / client / scope values come from runtime config — never committed.
 *
 * @param {Object} cfg - subset of AppConfig
 * @param {string} cfg.AUTH_TENANT_ID
 * @param {string} cfg.AUTH_CLIENT_ID
 * @param {string} cfg.AUTH_AUTHORITY
 * @param {string} cfg.AUTH_SCOPES   - comma-separated scope list (e.g. "api://.../.default")
 * @param {string} cfg.AUTH_REDIRECT_URI
 */
export function createEntraAuth(cfg) {
  // Lazy-load MSAL. Kept inside the factory so the no-auth code path never
  // pulls the chunk down.
  let pcaPromise = null;
  async function pca() {
    if (!pcaPromise) {
      pcaPromise = import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
        const authority =
          cfg.AUTH_AUTHORITY || `https://login.microsoftonline.com/${cfg.AUTH_TENANT_ID}`;
        const app = new PublicClientApplication({
          auth: {
            clientId: cfg.AUTH_CLIENT_ID,
            authority,
            redirectUri: cfg.AUTH_REDIRECT_URI || window.location.origin,
          },
          cache: {
            cacheLocation: 'sessionStorage',
            storeAuthStateInCookie: false,
          },
        });
        await app.initialize();
        return app;
      });
    }
    return pcaPromise;
  }

  const scopes = (cfg.AUTH_SCOPES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const listeners = new Set();
  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // ignore listener errors so one bad subscriber can't block the rest
      }
    }
  }

  let cachedAccount = null;

  function setActiveAccount(app, account) {
    if (account) {
      app.setActiveAccount(account);
    }
    cachedAccount = account ? { username: account.username, name: account.name } : null;
    notify();
  }

  return {
    async init() {
      const app = await pca();
      const result = await app.handleRedirectPromise();
      if (result?.account) {
        setActiveAccount(app, result.account);
        return;
      }
      const accounts = app.getAllAccounts();
      if (accounts.length > 0) {
        setActiveAccount(app, accounts[0]);
      }
    },
    async login() {
      const app = await pca();
      await app.loginRedirect({ scopes });
    },
    async logout() {
      const app = await pca();
      const account = app.getActiveAccount();
      await app.logoutRedirect({ account });
      setActiveAccount(app, null);
    },
    getAccount() {
      return cachedAccount;
    },
    async getAuthHeader() {
      const app = await pca();
      const account = app.getActiveAccount();
      if (!account) return null;
      try {
        const result = await app.acquireTokenSilent({ scopes, account });
        return `Bearer ${result.accessToken}`;
      } catch {
        // Silent acquisition failed (token expired, no interaction).
        // The caller's request will go out unauth'd; the UI can prompt re-login.
        return null;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
