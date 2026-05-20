import { describe, it, expect, beforeEach, vi } from 'vitest';

// Feature: in mock mode the API surface returns the v2 bulky-tree DTOs
// that the UI expects — Bond[] from listBonds, Auction subtree from
// getAuction, etc. We exercise full flows (list → detail → mutate)
// rather than micro-asserting each field.

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

    const initial = await AuctionsApi.listAuctions();
    expect(Array.isArray(initial)).toBe(true);
    const open = initial.find((a) => a.status === 'open');
    expect(open, 'mock seed should include at least one open auction').toBeTruthy();

    // Detail view returns the full Auction subtree.
    const auction = await AuctionsApi.getAuction(open.id);
    expect(auction).toMatchObject({
      id: open.id,
      isin: open.isin,
      status: 'open',
      md5: expect.any(String),
    });
    expect(Array.isArray(auction.bids)).toBe(true);

    // Close (PATCH) transitions status and yields an allocation.
    const closed = await AuctionsApi.closeAuction(open.id);
    expect(closed.status).toBe('closed');
    expect(closed.allocation.hash).toMatch(/^0x[0-9a-f]+$/);

    // Finalise (approve, PUT) lands it in finalised.
    const finalised = await AuctionsApi.finaliseAuction(
      open.id,
      closed.allocation.hash,
      true,
      [0, 1, 2],
    );
    expect(finalised.status).toBe('finalised');
  });

  it('mock reopen is allowed only from closed state', async () => {
    const { AuctionsApi } = await import('../src/api/auctionsApi.js');
    const auctions = await AuctionsApi.listAuctions();
    const open = auctions.find((a) => a.status === 'open');
    await AuctionsApi.closeAuction(open.id);
    const reopened = await AuctionsApi.reopenAuction(open.id);
    expect(reopened.status).toBe('open');
  });

  it('cancel auction (DELETE) marks it cancelled', async () => {
    const { AuctionsApi } = await import('../src/api/auctionsApi.js');
    const auctions = await AuctionsApi.listAuctions();
    const open = auctions.find((a) => a.status === 'open');
    const cancelled = await AuctionsApi.cancelAuction(open.id);
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('BondsApi (mock mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
  });

  it('listBonds returns Bond[] directly (no envelope)', async () => {
    const { BondsApi } = await import('../src/api/bondsApi.js');
    const bonds = await BondsApi.listBonds();
    expect(Array.isArray(bonds)).toBe(true);
    expect(bonds.length).toBeGreaterThan(0);

    const first = bonds[0];
    expect(first).toMatchObject({
      isin: expect.any(String),
      md5: expect.any(String),
      auctions: expect.any(Array),
      holders: expect.any(Array),
    });
  });

  it('getBond returns the full subtree including auctions and holders', async () => {
    const { BondsApi } = await import('../src/api/bondsApi.js');
    const bonds = await BondsApi.listBonds();
    const detail = await BondsApi.getBond(bonds[0].isin);
    expect(detail.isin).toBe(bonds[0].isin);
    expect(detail.coupon).toBeTruthy();
    expect(detail.maturity).toBeTruthy();
  });
});
