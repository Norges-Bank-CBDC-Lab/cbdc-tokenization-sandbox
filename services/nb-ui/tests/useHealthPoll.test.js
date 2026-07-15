import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Feature: the /v1/health poll pauses while the tab is hidden, uses a slow
// healthy cadence, watches degraded recovery more closely, and backs off while
// unreachable. useHealthPoll imports healthApi.js at module load, so each case
// re-mocks it and dynamically imports the hook (mirrors HealthBadge.test.jsx).

async function loadHook(getHealth) {
  vi.resetModules();
  vi.doMock('../src/api/healthApi.js', () => ({
    HealthApi: { getHealth, restartIngestion: vi.fn() },
  }));
  return import('../src/hooks/useHealthPoll.js');
}

function defineVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
}

function emitVisibility(state) {
  defineVisibility(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useHealthPoll traffic shaping', () => {
  afterEach(() => {
    defineVisibility('visible');
    vi.useRealTimers();
    vi.doUnmock('../src/api/healthApi.js');
  });

  it('does not poll while the tab is hidden and probes immediately on focus', async () => {
    vi.useFakeTimers();
    defineVisibility('hidden');
    const getHealth = vi.fn().mockResolvedValue({ status: 'ok' });
    const { useHealthPoll } = await loadHook(getHealth);

    renderHook(() => useHealthPoll());
    // Hidden at mount: no initial probe and no armed timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getHealth).not.toHaveBeenCalled();

    // Focusing the tab probes once immediately and resumes the loop.
    emitVisibility('visible');
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it('backs off the auto-poll while the backend is unreachable', async () => {
    vi.useFakeTimers();
    defineVisibility('visible');
    const getHealth = vi.fn().mockRejectedValue(new Error('unreachable'));
    const { useHealthPoll, DEGRADED_POLL_INTERVAL_MS } = await loadHook(getHealth);

    renderHook(() => useHealthPoll());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1); // initial probe

    // First failure retries at the degraded cadence, then backs off to 2x.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    // One degraded interval is not enough — the next probe is at 2x.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    // Completing the doubled window fires the next probe.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(3);
  });

  it('checks degraded state more frequently than healthy state', async () => {
    vi.useFakeTimers();
    defineVisibility('visible');
    const getHealth = vi
      .fn()
      .mockResolvedValueOnce({ status: 'degraded' })
      .mockResolvedValue({ status: 'ok' });
    const { useHealthPoll, DEFAULT_POLL_INTERVAL_MS, DEGRADED_POLL_INTERVAL_MS } =
      await loadHook(getHealth);

    renderHook(() => useHealthPoll());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS - 1);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getHealth).toHaveBeenCalledTimes(3);
  });
});
