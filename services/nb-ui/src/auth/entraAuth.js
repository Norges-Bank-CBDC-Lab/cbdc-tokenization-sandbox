/**
 * entraAuth — Microsoft Entra (Azure AD) OIDC plugin via MSAL Browser.
 *
 * Activated only when window.__APP_CONFIG__.AUTH_MODE === "entra". MSAL is
 * loaded with a dynamic import so the no-auth bundle path doesn't pay the
 * MSAL bytes.
 *
 * Tenant / client / scope values come from runtime config — never committed.
 *
 * Session model (MSAL Browser v5):
 * - The token cache lives in localStorage, so a signed-in session survives
 *   new tabs and browser restarts. The hard bounds are the refresh token
 *   Entra issues to SPAs (fixed lifetime of roughly a day, not configurable)
 *   and manual sign-out.
 * - `acquireTokenSilent` renews access tokens with the cached refresh token —
 *   a plain network call, no hidden iframes — so no COOP redirect-bridge page
 *   is needed. (The previously-documented bridge approach was dropped:
 *   iframe-based silent auth is unreliable under third-party-cookie blocking,
 *   and refresh-token renewal covers the silent path while a session is
 *   valid.)
 * - When silent renewal requires interaction (refresh token expired or
 *   revoked), the provider flips to "session expired": listeners are
 *   notified and isSessionExpired() returns true, so the auth gate can swap
 *   to the login page instead of letting API calls 401 silently.
 *
 * @param {Object} cfg - subset of AppConfig
 * @param {string} cfg.AUTH_TENANT_ID
 * @param {string} cfg.AUTH_CLIENT_ID
 * @param {string} cfg.AUTH_AUTHORITY
 * @param {string} cfg.AUTH_SCOPES   - comma-separated scope list (e.g. "api://.../.default")
 * @param {string} cfg.AUTH_REDIRECT_URI
 */
function base64UrlDecode(segment) {
  const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

/** Best-effort extraction of the App Roles (`roles`) claim from a JWT. */
function decodeJwtRoles(token) {
  try {
    const claims = JSON.parse(base64UrlDecode(token.split('.')[1]));
    return Array.isArray(claims.roles) ? claims.roles : [];
  } catch {
    return [];
  }
}

/** App Roles from the cached account's ID-token claims (may be empty). */
function rolesFromIdToken(account) {
  const roles = account?.idTokenClaims?.roles;
  return Array.isArray(roles) ? roles : [];
}

export function createEntraAuth(cfg) {
  // Lazy-load MSAL. Kept inside the factory so the no-auth code path never
  // pulls the chunk down. The module reference is retained so error-type
  // checks (InteractionRequiredAuthError) work without a second import.
  let msal = null;
  let pcaPromise = null;
  async function pca() {
    if (!pcaPromise) {
      pcaPromise = import('@azure/msal-browser').then(async (mod) => {
        msal = mod;
        const authority =
          cfg.AUTH_AUTHORITY || `https://login.microsoftonline.com/${cfg.AUTH_TENANT_ID}`;
        const app = new mod.PublicClientApplication({
          auth: {
            clientId: cfg.AUTH_CLIENT_ID,
            authority,
            redirectUri: cfg.AUTH_REDIRECT_URI || window.location.origin,
            // Without this, MSAL falls back to the CURRENT page URL as the
            // post_logout_redirect_uri. Entra exact-matches that value
            // against the registered redirect URIs, so a route like
            // /#/bonds fails validation and sign-out strands the user on
            // the Entra interstitial instead of this app's login page.
            // There is no separate post-logout registration in Entra —
            // reusing the registered redirect URI is the contract.
            postLogoutRedirectUri: cfg.AUTH_REDIRECT_URI || window.location.origin,
          },
          cache: {
            // localStorage so the session survives new tabs and browser
            // restarts. The effective bound is the SPA refresh-token
            // lifetime (~a day, fixed by Entra) or manual sign-out.
            // Trade-off (accepted for this sandbox): localStorage is
            // readable by any script in the origin, so an XSS could lift
            // cached tokens — sessionStorage would only shrink, not close,
            // that window.
            cacheLocation: 'localStorage',
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
  let sessionExpired = false;

  function setActiveAccount(app, account) {
    if (account) {
      app.setActiveAccount(account);
    }
    // Any explicit account-state change (sign-in, restore, sign-out)
    // supersedes a prior expiry signal.
    sessionExpired = false;
    cachedAccount = account
      ? { username: account.username, name: account.name, roles: rolesFromIdToken(account) }
      : null;
    notify();
  }

  function markSessionExpired() {
    if (!sessionExpired) {
      sessionExpired = true;
      notify();
    }
  }

  // Resolve the account's App Roles. Prefer the ID-token claims (present
  // whenever the App Roles are assigned on the app the ID token is issued for
  // — the common single-registration setup), and fall back to decoding the
  // access token (audience = the API) when the ID token carries none, e.g. a
  // separate API app registration. The backend independently re-checks the
  // access token's roles, so this only governs what the UI shows.
  async function resolveRoles(app, account) {
    const fromId = rolesFromIdToken(account);
    if (fromId.length) return fromId;
    try {
      const result = await app.acquireTokenSilent({ scopes, account });
      return decodeJwtRoles(result.accessToken);
    } catch {
      return [];
    }
  }

  async function hydrateRoles(app, account) {
    const roles = await resolveRoles(app, account);
    if (cachedAccount) {
      cachedAccount = { ...cachedAccount, roles };
      notify();
    }
  }

  return {
    async init() {
      const app = await pca();
      const result = await app.handleRedirectPromise();
      if (result?.account) {
        setActiveAccount(app, result.account);
        await hydrateRoles(app, result.account);
        return;
      }
      const accounts = app.getAllAccounts();
      if (accounts.length > 0) {
        setActiveAccount(app, accounts[0]);
        await hydrateRoles(app, accounts[0]);
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
    isSessionExpired() {
      return sessionExpired;
    },
    async getAuthHeader() {
      const app = await pca();
      const account = app.getActiveAccount();
      if (!account) return null;
      try {
        const result = await app.acquireTokenSilent({ scopes, account });
        if (sessionExpired) {
          // Renewal works again (e.g. a transient outage was misread as
          // expiry by an intermediate state) — clear the signal.
          sessionExpired = false;
          notify();
        }
        return `Bearer ${result.accessToken}`;
      } catch (e) {
        if (msal && e instanceof msal.InteractionRequiredAuthError) {
          // The refresh token is spent (expired/revoked) — only an
          // interactive sign-in can continue. Flip the gate to the login
          // page instead of letting requests 401 silently.
          markSessionExpired();
        }
        // Transient failures (network, throttling) keep today's behavior:
        // the request goes out unauthenticated and the caller surfaces the
        // API error.
        return null;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
