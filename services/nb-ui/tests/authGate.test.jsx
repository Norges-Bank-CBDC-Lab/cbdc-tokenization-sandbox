import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: the auth gate in App.jsx. In entra mode a signed-out user sees ONLY
// the login page; a signed-in user with a recognised role gets the app
// (operators also see the Central Bank tab; testers do not, and the route is
// guarded); a signed-in user with no recognised role sees the access-denied
// page; none mode is never gated; and a silent-renewal expiry mid-session
// swaps the app for the login page with the "session expired" notice. Roles
// come from the account's ID-token claims — see src/auth/entraAuth.js and
// src/auth/capabilities.js.

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

// Accounts carry their App Roles in idTokenClaims.roles — the source the
// provider reads first (resolveRoles in src/auth/entraAuth.js).
const operatorAccount = {
  username: 'operator@example.test',
  name: 'Operator',
  idTokenClaims: { roles: ['Sandbox.Operator'] },
};
const testerAccount = {
  username: 'tester@example.test',
  name: 'Tester',
  idTokenClaims: { roles: ['Sandbox.Tester'] },
};
const noRoleAccount = {
  username: 'stranger@example.test',
  name: 'Stranger',
  idTokenClaims: { roles: [] },
};

// Reset the module graph, point runtime config at the requested auth mode +
// role lists, prime the MSAL mock, and import a fresh App against all of it.
async function loadApp({ authMode = 'entra', accounts = [], silentImpl } = {}) {
  vi.resetModules();
  window.location.hash = '';
  window.__APP_CONFIG__ = {
    API_BASE_URL: 'http://test.local',
    AUTH_MODE: authMode,
    AUTH_TENANT_ID: authMode === 'entra' ? '11111111-1111-1111-1111-111111111111' : '',
    AUTH_CLIENT_ID: authMode === 'entra' ? '22222222-2222-2222-2222-222222222222' : '',
    AUTH_AUTHORITY: '',
    AUTH_SCOPES: authMode === 'entra' ? 'api://33333333-3333-3333-3333-333333333333/op' : '',
    AUTH_REDIRECT_URI: '',
    AUTH_OPERATOR_ROLES: 'Sandbox.Operator',
    AUTH_TESTER_ROLES: 'Sandbox.Tester',
  };
  const msal = await import('@azure/msal-browser');
  msal.__msalMockState.accounts = accounts;
  msal.__msalMockState.redirectResult = null;
  msal.__msalMockState.acquireTokenSilentImpl =
    silentImpl || (async () => ({ accessToken: 'test-token' }));
  const { App } = await import('../src/App.jsx');
  return { App, msal };
}

let fetchMock;

beforeEach(() => {
  // No test here depends on API data; pages render error/loading states when
  // fetch rejects, which is enough to assert the shell is (or isn't) mounted.
  fetchMock = vi.fn(async () => {
    throw new TypeError('network disabled in this test');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('auth gate (entra mode)', () => {
  it('renders ONLY the login page when signed out — no nav, no API calls', async () => {
    const { App } = await loadApp({ accounts: [] });
    render(<App />);

    expect(await screen.findByText('You are signed out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Securities/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts the redirect sign-in when the login button is clicked', async () => {
    const { App, msal } = await loadApp({ accounts: [] });
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Sign in' });
    await userEvent.click(button);
    expect(msal.__msalMockState.lastApp.loginRedirect).toHaveBeenCalledTimes(1);
  });

  it('renders the full app incl. the Central Bank tab for an operator', async () => {
    const { App } = await loadApp({ accounts: [operatorAccount] });
    render(<App />);

    expect(await screen.findByText('Operator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Securities/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Central Bank/ })).toBeInTheDocument();
    expect(screen.queryByText('You are signed out.')).not.toBeInTheDocument();
  });

  it('hides the Central Bank tab for a tester and guards the route', async () => {
    const { App } = await loadApp({ accounts: [testerAccount] });
    window.location.hash = '#/central-bank';
    render(<App />);

    expect(await screen.findByRole('button', { name: /Securities/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Central Bank/ })).not.toBeInTheDocument();
    // Banking is tester-accessible — Central Bank is the only
    // operator-locked surface.
    expect(screen.getByRole('button', { name: /Banking/ })).toBeInTheDocument();
    // Manually hitting the route shows the not-authorised panel, not the CB surface.
    expect(await screen.findByText('Not authorised')).toBeInTheDocument();
    expect(screen.queryByText('WNOK actions')).not.toBeInTheDocument();
  });

  it('shows the access-denied page for a signed-in user with no recognised role', async () => {
    const { App } = await loadApp({ accounts: [noRoleAccount] });
    render(<App />);

    expect(
      await screen.findByText('Stranger is not authorised for this application.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Securities/ })).not.toBeInTheDocument();
  });

  it('swaps the app for the login page with an expired notice when silent renewal needs interaction', async () => {
    const { App, msal } = await loadApp({ accounts: [operatorAccount] });
    msal.__msalMockState.acquireTokenSilentImpl = async () => {
      throw new msal.InteractionRequiredAuthError('refresh token expired');
    };

    render(<App />);

    // Roles resolve from the ID token (no token call), so the operator app
    // mounts; mounting pages then calls getAuthHeader -> acquireTokenSilent
    // -> the expiry signal.
    expect(
      await screen.findByText('Your session has expired — please sign in again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Securities/ })).not.toBeInTheDocument();
  });
});

describe('auth gate (none mode)', () => {
  it('never gates the local sandbox — the app renders with no login page', async () => {
    const { App } = await loadApp({ authMode: 'none' });
    render(<App />);

    expect(await screen.findByRole('button', { name: /Securities/ })).toBeInTheDocument();
    expect(screen.queryByText('You are signed out.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('groups nav into dropdown categories; opening Securities reveals its pages', async () => {
    const { App } = await loadApp({ authMode: 'none' });
    render(<App />);
    // Category triggers are visible; the sub-page links live inside a closed menu.
    expect(await screen.findByRole('button', { name: /Securities/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Central Bank/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Banking/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Auctions' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Securities/ }));
    expect(screen.getByRole('menuitem', { name: 'Bonds' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Auctions' })).toBeInTheDocument();
  });
});
