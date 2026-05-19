/**
 * Regenerate services/nb-bond-api/openapi.json from src/schemas.ts.
 *
 * Run with: npm run regen:openapi
 *
 * The runtime service serves the same document from `/v1/openapi.json` and
 * `/docs`, so the on-disk file is a snapshot for tooling that reads the spec
 * without a running service. Keep them in sync after any schema change.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openApiDocument } from '../src/schemas';

const target = resolve(__dirname, '..', 'openapi.json');
writeFileSync(target, JSON.stringify(openApiDocument, null, 2) + '\n', 'utf8');
console.log(`Wrote ${target}`);
