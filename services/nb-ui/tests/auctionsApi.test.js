import { describe, it, expect } from 'vitest';
import { AuctionsApi } from '../src/api/auctionsApi.js';

describe('AuctionsApi', () => {
  it('does not expose unsupported reopen or reject actions', () => {
    expect(AuctionsApi.reopenAuction).toBeUndefined();
  });
});
