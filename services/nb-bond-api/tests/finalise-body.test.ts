import { finaliseBodySchema } from '../src/schemas';

// Note: the "winners + expectedClearingRate are required when approve=true"
// rule is enforced in the handler (PUT /v1/auctions/:id/finalisation), not the
// schema, so the schema accepts `{ approve: true }` on its own. These tests
// cover the field-level shape the schema is responsible for.
describe('finaliseBodySchema', () => {
  it('accepts an approve body with winners + expected rate', () => {
    const r = finaliseBodySchema.safeParse({
      approve: true,
      winningBidIndexes: [0, 2, 3],
      expectedClearingRate: '425',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a reject body with only approve', () => {
    expect(finaliseBodySchema.safeParse({ approve: false }).success).toBe(true);
  });

  it('rejects a body missing approve', () => {
    expect(finaliseBodySchema.safeParse({ winningBidIndexes: [0] }).success).toBe(false);
  });

  it('rejects negative or non-integer bid indexes', () => {
    expect(
      finaliseBodySchema.safeParse({
        approve: true,
        winningBidIndexes: [-1],
        expectedClearingRate: '425',
      }).success,
    ).toBe(false);
    expect(
      finaliseBodySchema.safeParse({
        approve: true,
        winningBidIndexes: [1.5],
        expectedClearingRate: '425',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-numeric expectedClearingRate', () => {
    expect(
      finaliseBodySchema.safeParse({
        approve: true,
        winningBidIndexes: [0],
        expectedClearingRate: '4.25%',
      }).success,
    ).toBe(false);
  });

  it('ignores the removed allocationHash field (no longer part of the contract)', () => {
    // Zod strips unknown keys by default, so a stray allocationHash is harmless.
    expect(finaliseBodySchema.safeParse({ approve: false, allocationHash: '0xdead' }).success).toBe(
      true,
    );
  });
});
