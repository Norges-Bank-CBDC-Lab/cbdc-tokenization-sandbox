import { z } from 'zod';
import { validateRequest } from '../src/validation';
import { Request, Response } from 'express';

describe('validateRequest', () => {
  it('coerces and assigns validated body data', () => {
    const schema = z.object({ size: z.coerce.number().int().positive() });
    const req = { body: { size: '10' } } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    validateRequest(schema)(req, res, next);

    expect(req.body.size).toBe(10);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid payloads', () => {
    const schema = z.object({ size: z.number() });
    const req = { body: { size: 'nope' } } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    validateRequest(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid request', details: expect.any(Object) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('merges validated query params into the existing object', () => {
    const schema = z.object({ limit: z.coerce.number().int().positive() });
    const req = { query: { limit: '5', extra: 'keep' } } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    const originalQuery = req.query;

    validateRequest(schema, 'query')(req, res, next);

    expect(req.query).toBe(originalQuery);
    expect(req.query.limit).toBe(5);
    expect(req.query.extra).toBe('keep');
  });
});
