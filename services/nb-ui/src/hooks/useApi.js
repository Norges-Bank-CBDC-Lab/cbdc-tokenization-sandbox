/**
 * useApi — tiny data-fetching hook with status flags.
 *
 *   const { data, loading, error, reload } = useApi(() => BondsApi.listBonds(), []);
 *
 * Keeps components free of fetch boilerplate.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const cancelled = useRef(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(fetcher)
      .then((res) => {
        if (cancelled.current) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled.current) return;
        setError(e);
      })
      .finally(() => {
        if (cancelled.current) return;
        setLoading(false);
      });
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
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
