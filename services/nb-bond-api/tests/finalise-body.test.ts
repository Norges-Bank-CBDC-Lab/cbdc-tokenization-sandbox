import { finaliseBodySchema } from '../src/schemas';

describe('finaliseBodySchema', () => {
  it('accepts an approve body with winners + expected rate', () => {
    const r = finaliseBodySchema.safeParse({
      approve: true,
      winningBidIndexes: [0, 2, 3],
      expectedClearingRate: '425',
    });
    expect(r.success).toBe(true);
  });

  it('rejects the removed non-durable rejection path', () => {
    expect(finaliseBodySchema.safeParse({ approve: false }).success).toBe(false);
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

  it('requires a non-empty winner selection and expected clearing rate', () => {
    expect(finaliseBodySchema.safeParse({ approve: true }).success).toBe(false);
    expect(
      finaliseBodySchema.safeParse({
        approve: true,
        winningBidIndexes: [],
        expectedClearingRate: '425',
      }).success,
    ).toBe(false);
  });

  it('ignores the removed allocationHash field while validating the current contract', () => {
    // Zod strips unknown keys by default, so a stray allocationHash is harmless.
    expect(
      finaliseBodySchema.safeParse({
        approve: true,
        winningBidIndexes: [0],
        expectedClearingRate: '425',
        allocationHash: '0xdead',
      }).success,
    ).toBe(true);
  });
});
