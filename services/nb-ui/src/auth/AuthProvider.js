/**
 * AuthProvider — abstract interface every auth plugin must implement.
 *
 * @typedef {Object} AuthAccount
 * @property {string} username
 * @property {string=} name
 *
 * @typedef {Object} AuthProvider
 * @property {() => Promise<void>} init           - one-shot setup (token refresh, redirect handling)
 * @property {() => Promise<void>} login          - trigger an interactive sign-in
 * @property {() => Promise<void>} logout         - end the session
 * @property {() => AuthAccount | null} getAccount - current account, or null when signed out
 * @property {() => boolean} isSessionExpired - true when an account exists but silent renewal needs interaction (the auth gate shows the login page with an "expired" notice)
 * @property {() => Promise<string | null>} getAuthHeader - Bearer header value or null when no auth
 * @property {(listener: () => void) => () => void} subscribe - auth-state-change subscription (account or expiry); returns unsubscribe
 *
 * Plugin authors: implement these seven methods and export a factory the
 * resolver in ./index.js can call. See noneAuth.js and entraAuth.js.
 */
export {};
