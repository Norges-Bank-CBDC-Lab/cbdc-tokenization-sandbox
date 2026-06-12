import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: the auth gate in App.jsx. In entra mode a signed-out user sees
// ONLY the login page (no nav, no pages, no API calls); a signed-in user
// gets the full app (with the existing user badge + Sign out chrome); the
// none mode is never gated (the local sandbox must keep working); and a
// silent-renewal expiry mid-session swaps the app for the login page with
// the "session expired" notice.

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

const ACCOUNT = { username: 'operator@example.test', name: 'Operator' };

// Reset the module graph, point runtime config at the requested auth mode,
// prime the MSAL mock, and import a fresh App against all of it.
async function loadApp({ authMode = 'entra', accounts = [], silentImpl } = {}) {
  vi.resetModules();
  window.__APP_CONFIG__ = {
    API_BASE_URL: 'http://test.local',
    AUTH_MODE: authMode,
    AUTH_TENANT_ID: authMode === 'entra' ? '11111111-1111-1111-1111-111111111111' : '',
    AUTH_CLIENT_ID: authMode === 'entra' ? '22222222-2222-2222-2222-222222222222' : '',
    AUTH_AUTHORITY: '',
    AUTH_SCOPES: authMode === 'entra' ? 'api://33333333-3333-3333-3333-333333333333/op' : '',
    AUTH_REDIRECT_URI: '',
  };
  const msal = await import('@azure/msal-browser');
  msal.__msalMockState.accounts = accounts;
  msal.__msalMockState.redirectResult = null;
  if (silentImpl) msal.__msalMockState.acquireTokenSilentImpl = silentImpl;
  const { App } = await import('../src/App.jsx');
  return { App, msal };
}

let fetchMock;

beforeEach(() => {
  // No test in this file should depend on API data; pages render their
  // error/loading states when fetch rejects, which is enough to assert the
  // shell is (or is not) mounted.
  fetchMock = vi.fn(async () => {
    throw new TypeError('network disabled in this test');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth gate (entra mode)', () => {
  it('renders ONLY the login page when signed out — no nav, no API calls', async () => {
    const { App } = await loadApp({ accounts: [] });
    render(<App />);

    expect(await screen.findByText('You are signed out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    // None of the app shell is mounted...
    expect(screen.queryByText('Auctions')).not.toBeInTheDocument();
    expect(screen.queryByText('Central Bank')).not.toBeInTheDocument();
    // ...and nothing has talked to the API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts the redirect sign-in when the login button is clicked', async () => {
    const { App, msal } = await loadApp({ accounts: [] });
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Sign in' });
    await userEvent.click(button);
    expect(msal.__msalMockState.lastApp.loginRedirect).toHaveBeenCalledTimes(1);
  });

  it('renders the full app (with user badge and Sign out) when signed in', async () => {
    const { App } = await loadApp({ accounts: [ACCOUNT] });
    render(<App />);

    expect(await screen.findByText('Operator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('Auctions')).toBeInTheDocument();
    expect(screen.queryByText('You are signed out.')).not.toBeInTheDocument();
  });

  it('swaps the app for the login page with an expired notice when silent renewal needs interaction', async () => {
    const { App, msal } = await loadApp({ accounts: [ACCOUNT] });
    msal.__msalMockState.acquireTokenSilentImpl = async () => {
      throw new msal.InteractionRequiredAuthError('refresh token expired');
    };

    render(<App />);

    // Mounting pages triggers API calls -> getAuthHeader -> expiry signal.
    expect(
      await screen.findByText('Your session has expired — please sign in again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Auctions')).not.toBeInTheDocument();
  });
});

describe('auth gate (none mode)', () => {
  it('never gates the local sandbox — the app renders with no login page', async () => {
    const { App } = await loadApp({ authMode: 'none' });
    render(<App />);

    expect(await screen.findByText('Auctions')).toBeInTheDocument();
    expect(screen.queryByText('You are signed out.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
