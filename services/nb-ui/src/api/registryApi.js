/**
 * registryApi — the on-chain GlobalRegistry inventory.
 *
 * Mirrors the `system` /v1/registry endpoint in services/nb-bond-api/openapi.json.
 */
import { HttpClient } from './httpClient.js';

async function listRegistry() {
  return HttpClient.get('/v1/registry');
}

export const RegistryApi = {
  listRegistry,
};
