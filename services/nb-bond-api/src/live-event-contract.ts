export const LIVE_RESOURCE_KEYS = [
  'auctions',
  'banking',
  'bidders',
  'bonds',
  'central-bank',
  'operations',
  'registry',
] as const;

export type LiveResourceKey = (typeof LIVE_RESOURCE_KEYS)[number];
