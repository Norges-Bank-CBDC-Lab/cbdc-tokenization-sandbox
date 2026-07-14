import { z } from 'zod';

import { mutationAcceptedSchema } from '../contracts/mutations';

export const problemFieldErrorSchema = z
  .object({
    field: z.string(),
    message: z.string(),
  })
  .meta({ id: 'ProblemFieldError', description: 'Per-field validation error' });

export const problemDetailsSchema = z
  .object({
    type: z.string().meta({
      description: 'URI reference categorising the error',
      examples: ['about:blank'],
    }),
    title: z.string().meta({ description: 'Short, human-readable summary' }),
    status: z.number().int().meta({ description: 'HTTP status code' }),
    detail: z.string().nullable().meta({ description: 'Human-readable explanation' }),
    instance: z.string().nullable().meta({ description: 'Path that produced the error' }),
    errors: z.array(problemFieldErrorSchema).nullable().meta({
      description: 'Populated for 400 validation failures; null otherwise',
    }),
  })
  .meta({
    id: 'ProblemDetails',
    description: 'RFC 7807 error body. Returned for every 4xx/5xx response.',
  });

export const etagHeader = {
  ETag: {
    description: 'MD5 of the response body. Reuse via If-None-Match for cache revalidation.',
    schema: { type: 'string' as const },
  },
};

export const projectionHeaders = {
  ...etagHeader,
  'X-Projection-Block': {
    description: 'Highest chain block included in the SQLite projection used for this response.',
    schema: { type: 'integer' as const, minimum: 0 },
  },
};

export const successJson = (description: string, schema: z.ZodTypeAny, projection = false) => ({
  description,
  headers: projection ? projectionHeaders : etagHeader,
  content: { 'application/json': { schema } },
});

export const mutationAcceptedJson = {
  description:
    'Transaction accepted, but the resource projection is still catching up. This is not a ' +
    'failed mutation and must not be retried blindly.',
  headers: { 'X-Projection-Block': projectionHeaders['X-Projection-Block'] },
  content: { 'application/json': { schema: mutationAcceptedSchema } },
};

const notModified = {
  description: 'Not Modified — If-None-Match matched current ETag; cached body still valid.',
};

export const errorRefs = {
  read: {
    304: notModified,
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    404: { $ref: '#/components/responses/NotFound' },
    503: { $ref: '#/components/responses/ServiceUnavailable' },
    500: { $ref: '#/components/responses/InternalError' },
  },
  mutate: {
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    404: { $ref: '#/components/responses/NotFound' },
    409: { $ref: '#/components/responses/Conflict' },
    503: { $ref: '#/components/responses/ServiceUnavailable' },
    500: { $ref: '#/components/responses/InternalError' },
  },
};

export const noContent204 = {
  description: 'No Content — operation succeeded; response body intentionally empty.',
};

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
