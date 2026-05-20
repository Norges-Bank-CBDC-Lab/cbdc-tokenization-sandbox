import { Request, Response } from 'express';

import {
  buildProblem,
  computeMd5,
  okResponse,
  withMd5,
} from '../src/http';

function mockRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    end: jest.fn(),
    _headers: headers,
  };
  return res as unknown as Response & { _headers: Record<string, string>; setHeader: jest.Mock; status: jest.Mock; json: jest.Mock; end: jest.Mock };
}

function mockReq(opts: { ifNoneMatch?: string; originalUrl?: string } = {}): Request {
  return {
    header: (name: string) => (name.toLowerCase() === 'if-none-match' ? opts.ifNoneMatch : undefined),
    originalUrl: opts.originalUrl ?? '/v1/test',
  } as unknown as Request;
}

describe('computeMd5', () => {
  it('produces a stable hash regardless of key order', () => {
    const a = { isin: 'NO0001', status: 'open', size: '100' };
    const b = { size: '100', status: 'open', isin: 'NO0001' };
    expect(computeMd5(a)).toBe(computeMd5(b));
  });

  it('differs when nested values change', () => {
    const a = { isin: 'NO0001', auctions: [{ id: 'x', bids: [] }] };
    const b = { isin: 'NO0001', auctions: [{ id: 'y', bids: [] }] };
    expect(computeMd5(a)).not.toBe(computeMd5(b));
  });

  it('treats arrays as order-sensitive', () => {
    expect(computeMd5([1, 2, 3])).not.toBe(computeMd5([3, 2, 1]));
  });

  it('handles null and undefined consistently', () => {
    expect(computeMd5(null)).toBe(computeMd5(null));
    expect(computeMd5({ x: null })).toBe(computeMd5({ x: null }));
  });
});

describe('withMd5', () => {
  it('stamps an md5 field over the rest of the dto', () => {
    const out = withMd5({ a: 1, b: 'two' });
    expect(out.md5).toBe(computeMd5({ a: 1, b: 'two' }));
    expect(out.a).toBe(1);
    expect(out.b).toBe('two');
  });

  it('ignores any existing md5 in the input when computing', () => {
    const out = withMd5({ a: 1, md5: 'stale' });
    expect(out.md5).toBe(computeMd5({ a: 1 }));
    expect(out.md5).not.toBe('stale');
  });
});

describe('okResponse', () => {
  it('returns 200 with ETag and body on a fresh request', () => {
    const req = mockReq();
    const res = mockRes();
    const body = { isin: 'NO0001', md5: 'x' };

    okResponse(req, res, body);

    expect(res.setHeader).toHaveBeenCalledWith('ETag', expect.stringMatching(/^".*"$/));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, must-revalidate');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(body);
    expect(res.end).not.toHaveBeenCalled();
  });

  it('returns 304 with no body when If-None-Match matches the ETag', () => {
    const body = { isin: 'NO0001' };
    const etag = `"${computeMd5(body)}"`;
    const req = mockReq({ ifNoneMatch: etag });
    const res = mockRes();

    okResponse(req, res, body);

    expect(res.setHeader).toHaveBeenCalledWith('ETag', etag);
    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 200 (not 304) when If-None-Match has a stale value', () => {
    const req = mockReq({ ifNoneMatch: '"stale-etag"' });
    const res = mockRes();
    okResponse(req, res, { isin: 'NO0001' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
  });
});

describe('buildProblem', () => {
  it('returns RFC 7807 shape with defaults', () => {
    const req = mockReq({ originalUrl: '/v1/bonds/X' });
    const p = buildProblem(req, 404, 'Not Found');
    expect(p).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: null,
      instance: '/v1/bonds/X',
      errors: null,
    });
  });

  it('includes detail + errors when provided', () => {
    const req = mockReq();
    const p = buildProblem(req, 400, 'Validation failed', {
      detail: 'Invalid body',
      errors: [{ field: 'isin', message: 'required' }],
    });
    expect(p.detail).toBe('Invalid body');
    expect(p.errors).toEqual([{ field: 'isin', message: 'required' }]);
  });
});
