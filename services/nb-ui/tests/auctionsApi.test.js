import { describe, it, expect } from 'vitest';
import { AuctionsApi } from '../src/api/auctionsApi.js';

// AuctionsApi is otherwise a thin pass-through to HttpClient — the
// page-level tests (BondsPage / AuctionDetailPage via vi.mock) cover
// the request/response wiring. The only non-trivial bit left here is
// the client-side NotImplementedError for reopen, which has no real
// backend endpoint.

describe('AuctionsApi', () => {
  it('reopen throws NotImplementedError (no backend endpoint exists)', async () => {
    await expect(AuctionsApi.reopenAuction('0xaaaa')).rejects.toMatchObject({
      name: 'NotImplementedError',
      status: 501,
    });
  });
});
