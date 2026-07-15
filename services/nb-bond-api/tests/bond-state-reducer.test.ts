import { emptyBondState, reduceBondState } from '../src/projection/bond-state';

const ISIN = 'NO0000000001';
const PARTITION = '0x' + 'a'.repeat(64);
const BOND = '0x' + 'b'.repeat(40);

function apply(
  state: ReturnType<typeof emptyBondState>,
  event: Parameters<typeof reduceBondState>[1],
  block: number,
  logIndex = 0,
) {
  return reduceBondState(state, event, { block, logIndex });
}

describe('bond state projection reducer', () => {
  it('derives reproducible issuance and coupon schedule facts', () => {
    let state = emptyBondState(ISIN, PARTITION);
    state = apply(
      state,
      { type: 'created', partition: PARTITION, bondAddress: BOND, maturityDuration: 300n },
      10,
    );
    state = apply(state, { type: 'issued', offering: 1_000n }, 10, 1);
    state = apply(
      state,
      { type: 'enabled', couponDuration: 60n, couponYield: 425n, blockTimestamp: 1_000n },
      20,
    );
    state = apply(state, { type: 'issuance-complete' }, 20, 5);

    expect(state).toMatchObject({
      bondAddress: BOND,
      maturityDuration: '300',
      maturityDate: '1300',
      couponDuration: '60',
      couponYield: '425',
      lastCouponPayment: '1000',
      offering: '1000',
      everIssued: true,
      updatedBlock: 20,
      updatedLogIndex: 5,
    });
  });

  it('uses the highest coupon payment number and its block timestamp', () => {
    let state = emptyBondState(ISIN, PARTITION);
    state = apply(state, { type: 'coupon-paid', paymentNumber: 2n, blockTimestamp: 1_120n }, 30, 2);
    state = apply(state, { type: 'coupon-paid', paymentNumber: 1n, blockTimestamp: 1_060n }, 29, 9);

    expect(state.couponPaymentCount).toBe('2');
    expect(state.lastCouponPayment).toBe('1120');
    expect(state.updatedBlock).toBe(30);
  });

  it('tracks total supply exactly with bigint deltas', () => {
    let state = emptyBondState(ISIN, PARTITION);
    const minted = BigInt(Number.MAX_SAFE_INTEGER) + 99n;
    state = apply(state, { type: 'supply-delta', delta: minted }, 40);
    state = apply(state, { type: 'supply-delta', delta: -10n }, 41);
    expect(state.totalSupply).toBe((minted - 10n).toString());
  });

  it('rejects an impossible negative projected supply', () => {
    const state = emptyBondState(ISIN, PARTITION);
    expect(() => apply(state, { type: 'supply-delta', delta: -1n }, 50)).toThrow(
      `negative projected supply for ${ISIN}`,
    );
  });

  it('tracks maturity, redemption, disable, and re-create transitions', () => {
    let state = emptyBondState(ISIN, PARTITION);
    state = apply(state, { type: 'matured' }, 60);
    state = apply(state, { type: 'redemption-complete' }, 61);
    state = apply(state, { type: 'disabled', disabled: true }, 62);
    state = apply(
      state,
      { type: 'created', partition: PARTITION, bondAddress: BOND, maturityDuration: 300n },
      63,
    );
    expect(state).toMatchObject({
      isMatured: false,
      redemptionComplete: false,
      disabled: false,
    });
  });
});
