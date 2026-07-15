import { z } from 'zod';

import { blockNumberSchema, hexStringSchema } from './common';

export const mutationAcceptedSchema = z
  .object({
    status: z.literal('accepted'),
    projectionPending: z.literal(true),
    transaction: z.object({
      hash: hexStringSchema,
      block: blockNumberSchema.nullable(),
    }),
    resource: z.object({
      type: z.enum(['bond', 'auction']),
      id: z.string().min(1),
    }),
  })
  .meta({
    id: 'MutationAccepted',
    description:
      'The transaction was broadcast or mined, but the read projection did not catch up within ' +
      'the bounded response wait. Re-fetch the identified resource after the next SSE event.',
  });

export type MutationAccepted = z.infer<typeof mutationAcceptedSchema>;
