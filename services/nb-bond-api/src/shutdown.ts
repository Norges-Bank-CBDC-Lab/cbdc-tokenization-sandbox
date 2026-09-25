/**
 * Graceful shutdown on SIGTERM / SIGINT.
 *
 * In the container, `node` runs as PID 1, and PID 1 ignores SIGTERM unless it
 * installs a handler, so without this every pod stop ended in SIGKILL after the
 * grace period. The handler stops accepting requests, drops open connections
 * (SSE clients would otherwise keep the server open), lets queued ingestion work
 * settle within a bound below the pod's 30-second grace period, and exits. A
 * second signal exits at once.
 */
import type { Server } from 'node:http';
import { logger } from './logger';

export interface ShutdownDependencies {
  server: Pick<Server, 'close' | 'closeAllConnections'>;
  /** Stops the ingestion loop and resolves once its in-flight work has settled. */
  stopIngestion: () => Promise<void>;
  exit: (code: number) => void;
  timeoutMs?: number;
}

export function createShutdownHandler(
  deps: ShutdownDependencies,
): (signal: NodeJS.Signals) => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  let shuttingDown = false;

  return async (signal) => {
    if (shuttingDown) {
      logger.warn(`received ${signal} again during shutdown; exiting now`);
      deps.exit(1);
      return;
    }
    shuttingDown = true;
    logger.info(`received ${signal}; shutting down`);

    deps.server.close();
    deps.server.closeAllConnections();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const stopped = deps
      .stopIngestion()
      .then(() => 'stopped' as const)
      .catch(() => 'stopped' as const);
    const outcome = await Promise.race([stopped, timedOut]);
    clearTimeout(timer);

    if (outcome === 'timeout') {
      logger.warn(`ingestion did not settle within ${timeoutMs}ms; exiting anyway`);
    }
    logger.info('shutdown complete');
    deps.exit(0);
  };
}

export function installShutdownHandlers(deps: ShutdownDependencies): void {
  const handler = createShutdownHandler(deps);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, (received) => void handler(received));
  }
}
