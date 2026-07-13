/**
 * noneAuth — no-op auth plugin.
 *
 * Used in any deployment where the backend is unauthenticated (the local
 * sandbox today, per docs/ARCHITECTURE.md "Trust Boundaries And Security Notes").
 * Every method is a no-op; getAuthHeader returns null so HttpClient sends no
 * Authorization header.
 */
export function createNoneAuth() {
  return {
    async init() {},
    async login() {},
    async logout() {},
    getAccount() {
      return null;
    },
    isSessionExpired() {
      return false;
    },
    async getAuthHeader() {
      return null;
    },
    handleUnauthorized() {},
    subscribe() {
      return () => {};
    },
  };
}
