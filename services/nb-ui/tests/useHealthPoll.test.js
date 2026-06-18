import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Feature: the /v1/health poll pauses while the tab is hidden and backs off
// while the backend is unreachable, so an idle/background tab stops hammering
// the gateway. useHealthPoll imports healthApi.js at module load, so each case
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
    const { useHealthPoll, DEFAULT_POLL_INTERVAL_MS } = await loadHook(getHealth);

    renderHook(() => useHealthPoll());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getHealth).toHaveBeenCalledTimes(1); // initial probe

    // First interval elapses -> second probe; now backed off to 2x base.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    // One more base interval is NOT enough — the next probe is at 2x base.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(2);

    // Completing the doubled window fires the next probe.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);
    });
    expect(getHealth).toHaveBeenCalledTimes(3);
  });
});
