import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: HealthBadge polls /v1/health, recolours the pill, and opens
// the NetworkHealthModal on click. Polling is paused entirely in mock
// mode (the badge renders a static "MOCK API" pill).

const okPayload = (overrides = {}) => ({
  status: 'ok',
  contracts: { bondManager: '0x1', bondAuction: '0x2', bondToken: '0x3', wnok: null },
  sealingPubKey: '0x04',
  chain: { rpcUrl: 'http://besu:8545', chainId: 1337, head: 100, headReachable: true },
  ingestion: {
    loopRunning: true,
    lastBlockProcessed: 100,
    lag: 0,
    pollIntervalMs: 3000,
    lastTickAt: Date.now(),
    lastEventTxHash: '0xabc',
    consecutiveFailures: 0,
    recentErrors: [],
  },
  ...overrides,
});

const degradedPayload = () =>
  okPayload({
    status: 'degraded',
    ingestion: {
      loopRunning: true,
      lastBlockProcessed: 90,
      lag: 10,
      pollIntervalMs: 3000,
      lastTickAt: Date.now(),
      lastEventTxHash: '0xabc',
      consecutiveFailures: 0,
      recentErrors: [],
    },
  });

const downPayload = () =>
  okPayload({
    status: 'down',
    chain: { rpcUrl: 'http://besu:8545', chainId: null, head: null, headReachable: false },
    ingestion: {
      loopRunning: true,
      lastBlockProcessed: 90,
      lag: null,
      pollIntervalMs: 3000,
      lastTickAt: Date.now(),
      lastEventTxHash: null,
      consecutiveFailures: 5,
      recentErrors: [],
    },
  });

async function loadBadge(payload, { restartIngestionImpl } = {}) {
  vi.resetModules();
  window.__APP_CONFIG__.USE_MOCK = false;
  const restartIngestion =
    restartIngestionImpl ??
    vi.fn().mockResolvedValue({ restarted: true, status: payload.ingestion });
  vi.doMock('../src/api/healthApi.js', () => ({
    HealthApi: {
      getHealth: vi.fn().mockResolvedValue(payload),
      restartIngestion,
    },
  }));
  const [{ HealthBadge }, { ToastProvider }] = await Promise.all([
    import('../src/components/HealthBadge.jsx'),
    import('../src/components/ui.jsx'),
  ]);
  return { HealthBadge, ToastProvider, restartIngestion };
}

function renderBadge(Badge, ToastProvider) {
  return render(
    <ToastProvider>
      <Badge />
    </ToastProvider>,
  );
}

describe('HealthBadge', () => {
  beforeEach(() => {
    window.__APP_CONFIG__.USE_MOCK = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/api/healthApi.js');
  });

  it('renders LIVE with the green border when the backend returns ok', async () => {
    const { HealthBadge, ToastProvider } = await loadBadge(okPayload());
    renderBadge(HealthBadge, ToastProvider);
    await waitFor(() => {
      const badge = screen.getByRole('button');
      expect(badge.getAttribute('data-status')).toBe('ok');
    });
    const badge = screen.getByRole('button');
    expect(badge).toHaveTextContent('LIVE');
    expect(badge.style.border).toContain('rgb(16, 185, 129)');
    expect(badge.getAttribute('title')).toBe(
      'Network healthy — chain head 100, ingestion up to date',
    );
  });

  it('renders LIVE with the yellow border on degraded + concrete tooltip', async () => {
    const { HealthBadge, ToastProvider } = await loadBadge(degradedPayload());
    renderBadge(HealthBadge, ToastProvider);
    await waitFor(() => {
      expect(screen.getByRole('button').getAttribute('data-status')).toBe('degraded');
    });
    const badge = screen.getByRole('button');
    expect(badge.style.border).toContain('rgb(245, 158, 11)');
    expect(badge.getAttribute('title')).toBe('On-chain healthy, ingestion 10 blocks behind');
  });

  it('renders DOWN with the red border + chain-unreachable tooltip', async () => {
    const { HealthBadge, ToastProvider } = await loadBadge(downPayload());
    renderBadge(HealthBadge, ToastProvider);
    await waitFor(() => {
      expect(screen.getByRole('button').getAttribute('data-status')).toBe('down');
    });
    const badge = screen.getByRole('button');
    expect(badge).toHaveTextContent('DOWN');
    expect(badge.style.border).toContain('rgb(239, 68, 68)');
    expect(badge.getAttribute('title')).toBe("Backend can't reach chain");
  });

  it('renders MOCK API in mock mode and skips polling', async () => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
    const getHealth = vi.fn();
    vi.doMock('../src/api/healthApi.js', () => ({
      HealthApi: { getHealth, restartIngestion: vi.fn() },
    }));
    const [{ HealthBadge }, { ToastProvider }] = await Promise.all([
      import('../src/components/HealthBadge.jsx'),
      import('../src/components/ui.jsx'),
    ]);
    render(
      <ToastProvider>
        <HealthBadge />
      </ToastProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('MOCK API');
    expect(screen.getByRole('button').getAttribute('title')).toBe(
      'Mock API — no real backend connected',
    );
    // Polling is disabled (`enabled: !isMock`); getHealth never fires.
    expect(getHealth).not.toHaveBeenCalled();
  });

  it('opens the NetworkHealthModal on click and closes via the header ×', async () => {
    const { HealthBadge, ToastProvider } = await loadBadge(okPayload());
    const user = userEvent.setup();
    renderBadge(HealthBadge, ToastProvider);
    await waitFor(() => {
      expect(screen.getByRole('button').getAttribute('data-status')).toBe('ok');
    });
    await user.click(screen.getByRole('button', { name: /Network status/ }));
    expect(screen.getByRole('heading', { name: 'Network Health' })).toBeInTheDocument();
    // The header × carries aria-label="Close"; the NetworkHealthModal's
    // footer has Refresh / Reconnect / Resync — none labelled Close.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Network Health' })).not.toBeInTheDocument();
    });
  });

  it('polls again after the configured interval', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = false;
    const getHealth = vi.fn().mockResolvedValue(okPayload());
    vi.doMock('../src/api/healthApi.js', () => ({
      HealthApi: { getHealth, restartIngestion: vi.fn() },
    }));
    const [{ HealthBadge }, { ToastProvider }] = await Promise.all([
      import('../src/components/HealthBadge.jsx'),
      import('../src/components/ui.jsx'),
    ]);
    render(
      <ToastProvider>
        <HealthBadge />
      </ToastProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);
  });

  it('cleans up the polling timer on unmount', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = false;
    const getHealth = vi.fn().mockResolvedValue(okPayload());
    vi.doMock('../src/api/healthApi.js', () => ({
      HealthApi: { getHealth, restartIngestion: vi.fn() },
    }));
    const [{ HealthBadge }, { ToastProvider }] = await Promise.all([
      import('../src/components/HealthBadge.jsx'),
      import('../src/components/ui.jsx'),
    ]);
    const { unmount } = render(
      <ToastProvider>
        <HealthBadge />
      </ToastProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(getHealth).toHaveBeenCalledTimes(1);
  });
});
