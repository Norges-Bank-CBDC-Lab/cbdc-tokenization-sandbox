import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

import { buildProblem } from './http';

type Location = 'body' | 'params' | 'query';
type RequestWithLocation = Request & Record<Location, unknown>;

export function validateRequest(schema: ZodType, location: Location = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const request = req as RequestWithLocation;
    const result = schema.safeParse(request[location]);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join('.') : location,
        message: issue.message,
      }));
      return res
        .status(400)
        .json(
          buildProblem(req, 400, 'Validation failed', { detail: `Invalid ${location}`, errors }),
        );
    }
    // Some request properties (e.g. req.query in newer Express types) expose only
    // a getter, so merge into the existing object instead of reassigning the
    // property.
    if (location === 'query' && request[location]) {
      Object.assign(request[location] as Record<string, unknown>, result.data);
    } else {
      request[location] = result.data;
    }
    return next();
  };
}
