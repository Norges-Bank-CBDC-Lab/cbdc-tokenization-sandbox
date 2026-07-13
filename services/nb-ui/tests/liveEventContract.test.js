import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LIVE_RESOURCE_KEYS } from '../src/sync/liveEventProtocol.js';

describe('live-event API contract', () => {
  it('matches the backend generated OpenAPI resource catalog', () => {
    const openApiPath = resolve(process.cwd(), '../nb-bond-api/openapi.json');
    const document = JSON.parse(readFileSync(openApiPath, 'utf8'));
    const backendKeys = document.paths['/v1/events'].get['x-live-resource-keys'];

    expect(backendKeys).toEqual(LIVE_RESOURCE_KEYS);
  });
});
