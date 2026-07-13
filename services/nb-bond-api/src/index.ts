/** Process composition root for nb-bond-api. */
import { createApp } from './app';
import { envVariables } from './env-vars';
import { logger } from './logger';

const app = createApp();
const port = envVariables.EXPRESS_PORT;

app.listen(port, () => {
  logger.info(`nb-bond-api listening on ${port}`);
});

// Start ingestion in-process (background). The retry wrapper handles
// the case where Besu is briefly unreachable at boot (e.g. after a
// PC/Docker restart) — the loop self-heals once the chain comes back.
// The only "give up" path here is a module-load failure.
import('./ingestion')
  .then(({ startIngestionLoopWithRetry }) => startIngestionLoopWithRetry())
  .catch((err) => logger.error(`ingestion module load failed: ${(err as Error).message}`));
