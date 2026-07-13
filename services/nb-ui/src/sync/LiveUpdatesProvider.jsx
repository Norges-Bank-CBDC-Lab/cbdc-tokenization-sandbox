import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { HttpClient } from '../api/httpClient.js';
import { auth } from '../auth/index.js';
import { AppConfig } from '../config.js';
import { useApi } from '../hooks/useApi.js';

export { LiveResource } from './liveEventProtocol.js';

const LiveUpdatesContext = createContext({ global: 0, resources: {} });

function reconnectDelay(attempt) {
  const bounded = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
  return bounded + Math.floor(Math.random() * Math.max(1, bounded * 0.2));
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function LiveUpdatesProvider({ children, enabled = AppConfig.LIVE_UPDATES }) {
  const [generations, setGenerations] = useState({ global: 0, resources: {} });

  useEffect(() => {
    if (!enabled) return undefined;

    let stopped = false;
    let restartRequested = false;
    let activeController = null;
    const unsubscribeAuth = auth.subscribe(() => {
      restartRequested = true;
      activeController?.abort();
    });

    async function run() {
      let attempt = 0;
      while (!stopped) {
        const controller = new AbortController();
        activeController = controller;
        let openedAt = null;
        try {
          await HttpClient.streamLiveEvents({
            signal: controller.signal,
            onOpen: () => {
              openedAt = Date.now();
              setGenerations((current) => ({ ...current, global: current.global + 1 }));
            },
            onChanged: (changed) => {
              setGenerations((current) => {
                const resources = { ...current.resources };
                for (const key of changed) resources[key] = (resources[key] ?? 0) + 1;
                return { ...current, resources };
              });
            },
          });
        } catch (error) {
          if (stopped) return;
          if (restartRequested) {
            restartRequested = false;
            continue;
          }
          if (error?.status === 401) {
            auth.handleUnauthorized();
            return;
          }
          if (error?.status === 403) return;
        }

        if (stopped) return;
        // A connection that stayed healthy for a while starts a fresh backoff
        // series. A proxy that accepts and immediately closes escalates instead.
        if (openedAt !== null && Date.now() - openedAt >= 30_000) attempt = 0;
        const delayController = new AbortController();
        activeController = delayController;
        await wait(reconnectDelay(attempt), delayController.signal);
        attempt += 1;
        if (restartRequested) restartRequested = false;
      }
    }

    run();
    return () => {
      stopped = true;
      unsubscribeAuth();
      activeController?.abort();
    };
  }, [enabled]);

  const value = useMemo(() => generations, [generations]);
  return <LiveUpdatesContext.Provider value={value}>{children}</LiveUpdatesContext.Provider>;
}

export function useLiveQuery(resourceKeys, fetcher, deps = []) {
  const generations = useContext(LiveUpdatesContext);
  const liveDeps = resourceKeys.map((key) => generations.resources[key] ?? 0);
  return useApi(fetcher, [...deps, generations.global, ...liveDeps]);
}
