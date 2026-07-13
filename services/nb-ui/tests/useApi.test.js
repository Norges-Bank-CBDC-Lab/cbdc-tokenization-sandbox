import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApi } from '../src/hooks/useApi.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useApi', () => {
  it('distinguishes initial loading from background refresh', async () => {
    const first = deferred();
    const second = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useApi(fetcher, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.initialLoading).toBe(true);
    await act(async () => first.resolve('current'));
    await waitFor(() => expect(result.current.data).toBe('current'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe('current');

    await act(async () => second.resolve('fresh'));
    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(result.current.refreshing).toBe(false);
  });

  it('retains stale data and exposes a background refresh error', async () => {
    const refresh = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce('current').mockReturnValueOnce(refresh.promise);
    const { result } = renderHook(() => useApi(fetcher, []));

    await waitFor(() => expect(result.current.data).toBe('current'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    await act(async () => refresh.reject(new Error('temporary failure')));

    await waitFor(() => expect(result.current.refreshError?.message).toBe('temporary failure'));
    expect(result.current.data).toBe('current');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('ignores an older request that resolves after a reload', async () => {
    const first = deferred();
    const second = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useApi(fetcher, []));

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    act(() => result.current.reload());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve('new'));
    await waitFor(() => expect(result.current.data).toBe('new'));
    await act(async () => first.resolve('stale'));

    expect(result.current.data).toBe('new');
  });
});
