import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { LIVE_RESOURCE_KEYS } from '../live-event-contract';

export const liveEventStreamSchema = z.string().meta({
  id: 'LiveEventStream',
  description:
    'UTF-8 Server-Sent Events stream. `changed` event data is JSON with one `changed` array. ' +
    'Allowed resource keys are auctions, banking, bidders, bonds, central-bank, operations, ' +
    'and registry. Comment frames are connection/heartbeat signals. No domain data is sent.',
  examples: ['event: changed\ndata: {"changed":["auctions","bonds"]}\n\n'],
});

export const liveEventPaths: ZodOpenApiPathsObject = {
  '/v1/events': {
    get: {
      tags: ['system'],
      operationId: 'subscribeLiveEvents',
      summary: 'Subscribe to authenticated resource invalidations',
      description:
        'Long-lived SSE stream for UI refresh hints. Requires the same authenticated, ' +
        'recognised Entra role as other protected reads. Events contain coarse resource keys ' +
        'only; clients fetch current data through the normal API. There is no event replay.',
      'x-live-resource-keys': LIVE_RESOURCE_KEYS,
      responses: {
        200: {
          description: 'SSE stream opened',
          content: { 'text/event-stream': { schema: liveEventStreamSchema } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        429: { description: 'Too Many Requests — connection attempts exceeded the global limit.' },
        500: { $ref: '#/components/responses/InternalError' },
      },
    },
  },
};
