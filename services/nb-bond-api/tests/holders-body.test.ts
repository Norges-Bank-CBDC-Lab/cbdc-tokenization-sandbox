import { holdersBodySchema } from '../src/contracts/bonds';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

describe('holdersBodySchema', () => {
  it('accepts null (resolve every current holder) and a distinct list', () => {
    expect(holdersBodySchema.safeParse({ holders: null }).success).toBe(true);
    expect(holdersBodySchema.safeParse({ holders: [A, B] }).success).toBe(true);
    expect(holdersBodySchema.safeParse({ holders: [] }).success).toBe(true);
  });

  it('rejects a repeated holder, case-insensitively', () => {
    // BondManager would settle the repeat twice while the coverage check still passed.
    expect(holdersBodySchema.safeParse({ holders: [A, A] }).success).toBe(false);
    expect(
      holdersBodySchema.safeParse({ holders: [A, A.toUpperCase().replace('0X', '0x')] }).success,
    ).toBe(false);
  });
});
