import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: NetworkHealthModal pretty-prints /v1/health, surfaces recent
// errors, and exposes Reconnect + Resync-from-block-0 actions. The
// destructive Resync is gated behind a type-to-confirm phrase.

const okHealth = (overrides = {}) => ({
  status: 'ok',
  contracts: { bondManager: '0x1', bondAuction: '0x2', bondToken: '0x3', wnok: null },
  sealingPubKey: '0x04',
  chain: { rpcUrl: 'http://besu:8545', chainId: 1337, head: 42, headReachable: true },
  ingestion: {
    loopRunning: true,
    lastBlockProcessed: 42,
    lag: 0,
    pollIntervalMs: 3000,
    lastTickAt: Date.now() - 2000,
    lastEventTxHash: '0xabcdef0123456789' + '0'.repeat(48),
    consecutiveFailures: 0,
    recentErrors: [],
  },
  ...overrides,
});

async function loadModal({ restartIngestion } = {}) {
  vi.resetModules();
  window.__APP_CONFIG__.USE_MOCK = false;
  const restart = restartIngestion ?? vi.fn().mockResolvedValue({ restarted: true });
  vi.doMock('../src/api/healthApi.js', () => ({
    HealthApi: {
      getHealth: vi.fn().mockResolvedValue(okHealth()),
      restartIngestion: restart,
    },
  }));
  const [{ NetworkHealthModal }, { ToastProvider }] = await Promise.all([
    import('../src/pages/NetworkHealthModal.jsx'),
    import('../src/components/ui.jsx'),
  ]);
  return { NetworkHealthModal, ToastProvider, restart };
}

function renderModal(NetworkHealthModal, ToastProvider, health, overrides = {}) {
  return render(
    <ToastProvider>
      <NetworkHealthModal
        health={health}
        onReload={overrides.onReload ?? vi.fn().mockResolvedValue(undefined)}
        onClose={overrides.onClose ?? vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('NetworkHealthModal', () => {
  beforeEach(() => {
    window.__APP_CONFIG__.USE_MOCK = false;
  });

  afterEach(() => {
    vi.doUnmock('../src/api/healthApi.js');
  });

  it('renders chain + ingestion + empty-recent-errors sections', async () => {
    const { NetworkHealthModal, ToastProvider } = await loadModal();
    renderModal(NetworkHealthModal, ToastProvider, okHealth());

    expect(screen.getByRole('heading', { name: 'Network Health' })).toBeInTheDocument();
    expect(screen.getByText('http://besu:8545')).toBeInTheDocument();
    expect(screen.getByText('1337')).toBeInTheDocument();
    // Head block number and 'Last block processed' both render '42' as
    // their value cell — assert at least two such cells exist.
    expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('No recent ingestion errors recorded.')).toBeInTheDocument();
  });

  it('renders the recent-errors table when entries are present', async () => {
    const { NetworkHealthModal, ToastProvider } = await loadModal();
    const health = okHealth({
      status: 'degraded',
      ingestion: {
        ...okHealth().ingestion,
        consecutiveFailures: 2,
        recentErrors: [
          { ts: Date.now() - 10_000, message: 'rpc timeout', code: 'TIMEOUT' },
          { ts: Date.now() - 60_000, message: 'getaddrinfo EAI_AGAIN', code: 'EAI_AGAIN' },
        ],
      },
    });
    renderModal(NetworkHealthModal, ToastProvider, health);
    expect(screen.getByText('rpc timeout')).toBeInTheDocument();
    expect(screen.getByText('TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('getaddrinfo EAI_AGAIN')).toBeInTheDocument();
  });

  it('Reconnect button calls HealthApi.restartIngestion() and reloads', async () => {
    const restart = vi.fn().mockResolvedValue({ restarted: true });
    const onReload = vi.fn().mockResolvedValue(undefined);
    const { NetworkHealthModal, ToastProvider } = await loadModal({ restartIngestion: restart });
    const user = userEvent.setup();
    renderModal(NetworkHealthModal, ToastProvider, okHealth(), { onReload });
    await user.click(screen.getByRole('button', { name: /Reconnect/ }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(restart).toHaveBeenCalledWith();
    expect(onReload).toHaveBeenCalled();
  });

  it('Resync requires the confirmation phrase and posts fromBlock=0', async () => {
    const restart = vi.fn().mockResolvedValue({ restarted: true });
    const { NetworkHealthModal, ToastProvider } = await loadModal({ restartIngestion: restart });
    const user = userEvent.setup();
    renderModal(NetworkHealthModal, ToastProvider, okHealth());

    await user.click(screen.getByRole('button', { name: /Resync from block 0/ }));

    // ConfirmResyncModal opened — the destructive submit is disabled.
    const confirmModal = screen.getByRole('heading', { name: 'Confirm resync from block 0' });
    expect(confirmModal).toBeInTheDocument();

    // The confirm modal is the second modal in the DOM; scope queries to it.
    const allModals = document.querySelectorAll('.modal');
    const confirmModalEl = allModals[allModals.length - 1];
    const confirmScope = within(confirmModalEl);

    const submit = confirmScope.getByRole('button', { name: /Resync from block 0/ });
    expect(submit).toBeDisabled();

    // Wrong phrase keeps it disabled.
    const input = confirmScope.getByLabelText('resync-confirm-phrase');
    await user.type(input, 'go ahead');
    expect(submit).toBeDisabled();

    // Clear then enter the exact phrase (case-insensitive).
    await user.clear(input);
    await user.type(input, 'RESYNC FROM BLOCK 0');
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(restart).toHaveBeenCalledWith({ fromBlock: 0 });
  });

  it('Resync leaves the confirm modal open when the API fails', async () => {
    const restart = vi.fn().mockRejectedValue(new Error('500 boom'));
    const { NetworkHealthModal, ToastProvider } = await loadModal({ restartIngestion: restart });
    const user = userEvent.setup();
    renderModal(NetworkHealthModal, ToastProvider, okHealth());

    await user.click(screen.getByRole('button', { name: /Resync from block 0/ }));
    const allModals = document.querySelectorAll('.modal');
    const confirmModalEl = allModals[allModals.length - 1];
    const confirmScope = within(confirmModalEl);

    await user.type(confirmScope.getByLabelText('resync-confirm-phrase'), 'resync from block 0');
    await user.click(confirmScope.getByRole('button', { name: /Resync from block 0/ }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));

    // Modal still open so the operator can read the toast in context.
    expect(
      screen.getByRole('heading', { name: 'Confirm resync from block 0' }),
    ).toBeInTheDocument();
  });
});
