import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

type Location = 'body' | 'params' | 'query';
type RequestWithLocation = Request & Record<Location, unknown>;

export function validateRequest(schema: ZodType, location: Location = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const request = req as RequestWithLocation;
    const result = schema.safeParse(request[location]);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.format() });
    }
    // Some request properties (e.g., req.query in newer Express types) expose only a getter,
    // so merge into the existing object instead of reassigning the property.
    if (location === 'query' && request[location]) {
      Object.assign(request[location] as Record<string, unknown>, result.data);
    } else {
      request[location] = result.data;
    }
    return next();
  };
}
