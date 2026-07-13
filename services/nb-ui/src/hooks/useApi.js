/**
 * useApi — tiny data-fetching hook with status flags.
 *
 *   const { data, loading, error, reload } = useApi(() => BondsApi.listBonds(), []);
 *
 * Keeps components free of fetch boilerplate.
 */
import { useState, useEffect, useCallback } from 'react';

export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const hasData = data !== null;
    // Fetch lifecycle state is intentionally synchronized with the request effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (hasData) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setInitialLoading(true);
      setError(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    Promise.resolve()
      .then(fetcher)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
        setRefreshError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (hasData) setRefreshError(e);
        else setError(e);
      })
      .finally(() => {
        if (cancelled) return;
        setInitialLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return {
    data,
    // Compatibility alias: loaded pages no longer enter their full-screen
    // loading branch during SSE/manual background revalidation.
    loading: initialLoading,
    initialLoading,
    refreshing,
    error,
    refreshError,
    reload,
  };
}

/**
 * useMutation — for write actions (POST/PUT/DELETE).
 */
export function useMutation(fn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const run = useCallback(
    async (...args) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fn(...args);
        setData(res);
        return res;
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  return { run, loading, error, data };
}
