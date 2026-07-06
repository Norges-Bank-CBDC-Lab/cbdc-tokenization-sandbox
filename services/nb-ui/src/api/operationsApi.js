/**
 * operationsApi — the operator audit trail.
 *
 * Mirrors the `system` /v1/operations endpoint in services/nb-bond-api/openapi.json.
 */
import { HttpClient } from './httpClient.js';

async function listOperations() {
  return HttpClient.get('/v1/operations');
}

export const OperationsApi = {
  listOperations,
};
