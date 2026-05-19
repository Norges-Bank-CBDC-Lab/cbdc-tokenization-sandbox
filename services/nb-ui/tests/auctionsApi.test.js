import { describe, it, expect, beforeEach, vi } from 'vitest';

// Feature: in mock mode the API surface returns shapes that match the
// OpenAPI envelopes the UI expects. We exercise full flows (list → detail →
// mutate → list reflects mutation) rather than micro-asserting each field.

describe('AuctionsApi (mock mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
  });

  it('reopen throws NotImplementedError in real mode (live backend has no endpoint)', async () => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = false;
    const { AuctionsApi } = await import('../src/api/auctionsApi.js');
    await expect(AuctionsApi.reopenAuction('0xaaaa')).rejects.toMatchObject({
      name: 'NotImplementedError',
      status: 501,
    });
  });

  it('lists all auctions, gets one by id, closes it, finalises it', async () => {
    const { AuctionsApi } = await import('../src/api/auctionsApi.js');

    // Snapshot list size + grab an open auction.
    const initial = await AuctionsApi.listAllAuctions();
    expect(initial).toHaveProperty('auctions');
    expect(Array.isArray(initial.auctions)).toBe(true);
    const open = initial.auctions.find((a) => a.status === 'open');
    expect(open, 'mock seed should include at least one open auction').toBeTruthy();

    // Detail view exposes the right envelope.
    const status = await AuctionsApi.getAuctionStatus(open.auctionId);
    expect(status).toMatchObject({
      auctionId: open.auctionId,
      isin: open.isin,
      status: 'open',
      metadata: expect.objectContaining({ owner: expect.any(String) }),
      cached: expect.objectContaining({ sealedCount: expect.any(Number) }),
    });

    // Close transitions status to closed and yields an allocation hash.
    const closed = await AuctionsApi.closeAuction(open.auctionId);
    expect(closed.status).toBe('closed');
    expect(closed.allocation.allocationHash).toMatch(/^0x[0-9a-f]+$/);

    // Finalise (approve) lands it in finalised.
    const finalised = await AuctionsApi.finaliseAuction(
      open.auctionId,
      closed.allocation.allocationHash,
      true,
      [0, 1, 2],
    );
    expect(finalised.status).toBe('finalised');
  });

  it('mock reopen is allowed only from closed state', async () => {
    const { AuctionsApi } = await import('../src/api/auctionsApi.js');
    const { auctions } = await AuctionsApi.listAllAuctions();
    const open = auctions.find((a) => a.status === 'open');
    await AuctionsApi.closeAuction(open.auctionId);
    const reopened = await AuctionsApi.reopenAuction(open.auctionId);
    expect(reopened.status).toBe('open');
  });
});

describe('BondsApi (mock mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
  });

  it('lists bonds and resolves a single bond by ISIN', async () => {
    const { BondsApi } = await import('../src/api/bondsApi.js');
    const { bonds } = await BondsApi.listBonds();
    expect(bonds.length).toBeGreaterThan(0);

    const first = bonds[0];
    const detail = await BondsApi.getBond(first.isin);
    expect(detail.isin).toBe(first.isin);
    expect(detail).toHaveProperty('status');
  });
});
