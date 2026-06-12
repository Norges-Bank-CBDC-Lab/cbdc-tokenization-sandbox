import { beforeEach, describe, expect, it, vi } from 'vitest';

// Feature: the Entra auth provider persists its session in localStorage,
// renews access tokens silently via the cached refresh token, and flips to a
// "session expired" state (instead of silently 401ing) when renewal needs
// interaction. See src/auth/entraAuth.js.

vi.mock('@azure/msal-browser', () => {
  class InteractionRequiredAuthError extends Error {}
  const state = {
    accounts: [],
    redirectResult: null,
    acquireTokenSilentImpl: async () => ({ accessToken: 'test-token' }),
    lastApp: null,
  };
  class PublicClientApplication {
    constructor(config) {
      state.lastApp = this;
      this.config = config;
      this.activeAccount = null;
      this.loginRedirect = vi.fn(async () => {});
      this.logoutRedirect = vi.fn(async () => {});
    }
    async initialize() {}
    async handleRedirectPromise() {
      return state.redirectResult;
    }
    getAllAccounts() {
      return state.accounts;
    }
    setActiveAccount(account) {
      this.activeAccount = account;
    }
    getActiveAccount() {
      return this.activeAccount;
    }
    async acquireTokenSilent(request) {
      return state.acquireTokenSilentImpl(request);
    }
  }
  return { PublicClientApplication, InteractionRequiredAuthError, __msalMockState: state };
});

import { createEntraAuth } from '../src/auth/entraAuth.js';
import { InteractionRequiredAuthError, __msalMockState as msalState } from '@azure/msal-browser';

const CFG = {
  AUTH_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  AUTH_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: 'api://33333333-3333-3333-3333-333333333333/Bond.Operate',
  AUTH_REDIRECT_URI: '',
};

const ACCOUNT = { username: 'operator@example.test', name: 'Operator' };

beforeEach(() => {
  msalState.accounts = [];
  msalState.redirectResult = null;
  msalState.acquireTokenSilentImpl = async () => ({ accessToken: 'test-token' });
  msalState.lastApp = null;
});

describe('entraAuth session model', () => {
  it('configures the MSAL cache in localStorage so sessions survive tabs/restarts', async () => {
    const auth = createEntraAuth(CFG);
    await auth.init();
    expect(msalState.lastApp.config.cache.cacheLocation).toBe('localStorage');
  });

  it('restores a cached account on init and serves a Bearer header silently', async () => {
    msalState.accounts = [ACCOUNT];
    const auth = createEntraAuth(CFG);
    await auth.init();
    expect(auth.getAccount()).toEqual(ACCOUNT);
    expect(auth.isSessionExpired()).toBe(false);
    expect(await auth.getAuthHeader()).toBe('Bearer test-token');
  });

  it('flips to session-expired (and notifies) when silent renewal needs interaction', async () => {
    msalState.accounts = [ACCOUNT];
    const auth = createEntraAuth(CFG);
    await auth.init();

    const listener = vi.fn();
    auth.subscribe(listener);
    msalState.acquireTokenSilentImpl = async () => {
      throw new InteractionRequiredAuthError('refresh token expired');
    };

    expect(await auth.getAuthHeader()).toBeNull();
    expect(auth.isSessionExpired()).toBe(true);
    expect(listener).toHaveBeenCalled();

    // Repeat failures don't re-notify (the state is already expired).
    listener.mockClear();
    expect(await auth.getAuthHeader()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does NOT mark the session expired on transient (non-interaction) failures', async () => {
    msalState.accounts = [ACCOUNT];
    const auth = createEntraAuth(CFG);
    await auth.init();

    msalState.acquireTokenSilentImpl = async () => {
      throw new Error('network down');
    };
    expect(await auth.getAuthHeader()).toBeNull();
    expect(auth.isSessionExpired()).toBe(false);
  });

  it('clears the expired state when a redirect sign-in completes', async () => {
    msalState.accounts = [ACCOUNT];
    const auth = createEntraAuth(CFG);
    await auth.init();
    msalState.acquireTokenSilentImpl = async () => {
      throw new InteractionRequiredAuthError('refresh token expired');
    };
    await auth.getAuthHeader();
    expect(auth.isSessionExpired()).toBe(true);

    // The user signed in again; the redirect callback carries the account.
    msalState.redirectResult = { account: ACCOUNT };
    await auth.init();
    expect(auth.isSessionExpired()).toBe(false);
    expect(auth.getAccount()).toEqual(ACCOUNT);
  });

  it('returns no header (without calling acquireTokenSilent) when signed out', async () => {
    const auth = createEntraAuth(CFG);
    await auth.init();
    const silent = vi.fn();
    msalState.acquireTokenSilentImpl = silent;
    expect(await auth.getAuthHeader()).toBeNull();
    expect(silent).not.toHaveBeenCalled();
  });
});
