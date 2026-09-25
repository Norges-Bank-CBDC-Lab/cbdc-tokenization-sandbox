/** Process composition root for nb-bond-api. */
import { createApp } from './app';
import { envVariables } from './env-vars';
import { logger } from './logger';
import { installShutdownHandlers } from './shutdown';

const app = createApp();
const port = envVariables.EXPRESS_PORT;

const server = app.listen(port, () => {
  logger.info(`nb-bond-api listening on ${port}`);
});

// Start ingestion in-process (background). The retry wrapper handles
// the case where Besu is briefly unreachable at boot (e.g. after a
// PC/Docker restart) — the loop self-heals once the chain comes back.
// Chain-identity mismatches are also fatal: continuing would expose a
// projection checkpoint produced by a different genesis.
const ingestion = import('./ingestion');
ingestion
  .then(({ startIngestionLoopWithRetry }) => startIngestionLoopWithRetry())
  .catch((err) => {
    logger.error(`fatal ingestion startup failure: ${(err as Error).message}`);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });

installShutdownHandlers({
  server,
  stopIngestion: async () => {
    const { stopIngestionLoop, waitForIngestionIdle } = await ingestion;
    stopIngestionLoop();
    await waitForIngestionIdle();
  },
  exit: (code) => process.exit(code),
});
