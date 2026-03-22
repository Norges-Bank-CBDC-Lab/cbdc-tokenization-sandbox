"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const validation_1 = require("../src/validation");
describe('validateRequest', () => {
    it('coerces and assigns validated body data', () => {
        const schema = zod_1.z.object({ size: zod_1.z.coerce.number().int().positive() });
        const req = { body: { size: '10' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        (0, validation_1.validateRequest)(schema)(req, res, next);
        expect(req.body.size).toBe(10);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    it('returns 400 on invalid payloads', () => {
        const schema = zod_1.z.object({ size: zod_1.z.number() });
        const req = { body: { size: 'nope' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        (0, validation_1.validateRequest)(schema)(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid request', details: expect.any(Object) }));
        expect(next).not.toHaveBeenCalled();
    });
    it('merges validated query params into the existing object', () => {
        const schema = zod_1.z.object({ limit: zod_1.z.coerce.number().int().positive() });
        const req = { query: { limit: '5', extra: 'keep' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        const originalQuery = req.query;
        (0, validation_1.validateRequest)(schema, 'query')(req, res, next);
        expect(req.query).toBe(originalQuery);
        expect(req.query.limit).toBe(5);
        expect(req.query.extra).toBe('keep');
    });
});
//# sourceMappingURL=validation.test.js.map