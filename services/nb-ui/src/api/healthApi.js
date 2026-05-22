/**
 * healthApi — wrapper for the /v1/health endpoint.
 *
 * The HealthBadge component polls this every few seconds. /v1/health
 * bypasses backend auth (per OpenAPI security: []) so no token is
 * needed. Mock mode returns a static `ok` payload so the badge looks
 * sensible in the storybook-style mock UI.
 */
import { AppConfig } from '../config.js';
import { HttpClient } from './httpClient.js';
import { MockClient } from './mockClient.js';

const isMockMode = () => AppConfig.USE_MOCK;

async function getHealth() {
  if (isMockMode()) return MockClient.getHealth();
  return HttpClient.get('/v1/health');
}

/**
 * Restart the in-process ingestion loop.
 *  - `{}` (default) → non-destructive restart. Projection survives.
 *  - `{ fromBlock: 0 }` → drops the projection (auctions, balances,
 *    bond_events, …) and rebuilds from chain. Bidders are preserved.
 *
 * Returns `{ restarted: boolean, status: HealthIngestion }`. `restarted`
 * is true when the backend confirmed `loopRunning=true` within the
 * server-side 5s timeout; false means the loop is still coming up and
 * the operator UI should keep polling /v1/health.
 */
async function restartIngestion({ fromBlock } = {}) {
  const query = fromBlock === 0 ? { fromBlock: '0' } : undefined;
  if (isMockMode()) return MockClient.restartIngestion({ fromBlock });
  return HttpClient.post('/v1/admin/restart-ingestion', null, { query });
}

export const HealthApi = { getHealth, restartIngestion };
