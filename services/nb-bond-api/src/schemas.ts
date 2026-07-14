/**
 * Compatibility facade for runtime handlers and existing tests.
 *
 * Feature-owned Zod contracts and path fragments live under src/contracts.
 * The OpenAPI document aggregator lives under src/openapi.
 */
export * from './contracts/auctions';
export * from './contracts/banking';
export * from './contracts/bidders';
export * from './contracts/bonds';
export * from './contracts/central-bank';
export * from './contracts/common';
export * from './contracts/health';
export * from './contracts/live-events';
export * from './contracts/mutations';
export * from './contracts/operations';
export * from './openapi/shared-responses';
export { openApiDocument } from './openapi/document';
