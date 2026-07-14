import { reducePartitionTransfer, ZERO_ADDRESS } from '../src/projection/balance-reducer';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';

describe('canonical partition balance reducer', () => {
  it('credits only the non-zero holder for a mint', () => {
    expect(reducePartitionTransfer({ from: ZERO_ADDRESS, to: ALICE, value: 100n })).toEqual([
      { holder: ALICE, delta: 100n, kind: 'mint' },
    ]);
  });

  it('debits only the non-zero holder for a burn or redemption', () => {
    expect(reducePartitionTransfer({ from: ALICE, to: ZERO_ADDRESS, value: 40n })).toEqual([
      { holder: ALICE, delta: -40n, kind: 'burn' },
    ]);
  });

  it('creates balanced debit and credit deltas for a transfer', () => {
    expect(reducePartitionTransfer({ from: ALICE, to: BOB, value: 25n })).toEqual([
      { holder: ALICE, delta: -25n, kind: 'transfer' },
      { holder: BOB, delta: 25n, kind: 'transfer' },
    ]);
  });

  it('treats a self-transfer as a net-zero balance change', () => {
    expect(reducePartitionTransfer({ from: ALICE, to: ALICE, value: 25n })).toEqual([]);
  });

  it('normalizes addresses and preserves uint256-scale values as bigint', () => {
    const value = BigInt(Number.MAX_SAFE_INTEGER) + 123456789n;
    expect(
      reducePartitionTransfer({ from: ALICE.toUpperCase(), to: BOB.toUpperCase(), value }),
    ).toEqual([
      { holder: ALICE, delta: -value, kind: 'transfer' },
      { holder: BOB, delta: value, kind: 'transfer' },
    ]);
  });

  it('does not create a balance when both sides are the zero address', () => {
    expect(reducePartitionTransfer({ from: ZERO_ADDRESS, to: ZERO_ADDRESS, value: 1n })).toEqual(
      [],
    );
  });
});
