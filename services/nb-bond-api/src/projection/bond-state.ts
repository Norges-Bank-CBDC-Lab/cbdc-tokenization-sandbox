export type BondState = {
  isin: string;
  partition: string;
  bondAddress: string | null;
  disabled: boolean;
  maturityDuration: string | null;
  maturityDate: string | null;
  couponDuration: string | null;
  couponYield: string | null;
  lastCouponPayment: string | null;
  couponPaymentCount: string;
  isMatured: boolean;
  totalSupply: string;
  offering: string;
  everIssued: boolean;
  redemptionComplete: boolean;
  updatedBlock: number;
  updatedLogIndex: number;
};

export type BondProjectionEvent =
  | {
      type: 'created';
      partition: string;
      bondAddress: string | null;
      maturityDuration: bigint;
    }
  | { type: 'disabled'; disabled: boolean }
  | { type: 'issued'; offering: bigint }
  | {
      type: 'enabled';
      couponDuration: bigint;
      couponYield: bigint;
      blockTimestamp: bigint;
    }
  | { type: 'offering-changed'; offering: bigint }
  | { type: 'issuance-complete' }
  | { type: 'coupon-paid'; paymentNumber: bigint; blockTimestamp: bigint }
  | { type: 'matured' }
  | { type: 'redemption-complete' }
  | { type: 'supply-delta'; delta: bigint };

export function emptyBondState(isin: string, partition: string): BondState {
  return {
    isin,
    partition: partition.toLowerCase(),
    bondAddress: null,
    disabled: false,
    maturityDuration: null,
    maturityDate: null,
    couponDuration: null,
    couponYield: null,
    lastCouponPayment: null,
    couponPaymentCount: '0',
    isMatured: false,
    totalSupply: '0',
    offering: '0',
    everIssued: false,
    redemptionComplete: false,
    updatedBlock: 0,
    updatedLogIndex: 0,
  };
}

export function reduceBondState(
  current: BondState,
  event: BondProjectionEvent,
  position: { block: number; logIndex: number },
): BondState {
  // Re-creating a previously disabled ISIN begins a new lifecycle. Carrying
  // maturity/redemption flags into the replacement would make replay order
  // dependent and label the new bond as already completed.
  const next =
    event.type === 'created' ? emptyBondState(current.isin, event.partition) : { ...current };

  switch (event.type) {
    case 'created':
      next.partition = event.partition.toLowerCase();
      next.bondAddress = event.bondAddress;
      next.maturityDuration = event.maturityDuration.toString();
      next.disabled = false;
      break;
    case 'disabled':
      next.disabled = event.disabled;
      break;
    case 'issued':
    case 'offering-changed':
      next.offering = event.offering.toString();
      break;
    case 'enabled': {
      next.couponDuration = event.couponDuration.toString();
      next.couponYield = event.couponYield.toString();
      next.lastCouponPayment = event.blockTimestamp.toString();
      const duration = BigInt(next.maturityDuration ?? '0');
      next.maturityDate = (event.blockTimestamp + duration).toString();
      break;
    }
    case 'issuance-complete':
      next.everIssued = true;
      break;
    case 'coupon-paid':
      if (event.paymentNumber > BigInt(next.couponPaymentCount)) {
        next.couponPaymentCount = event.paymentNumber.toString();
        next.lastCouponPayment = event.blockTimestamp.toString();
      }
      break;
    case 'matured':
      next.isMatured = true;
      break;
    case 'redemption-complete':
      next.redemptionComplete = true;
      break;
    case 'supply-delta': {
      const supply = BigInt(next.totalSupply) + event.delta;
      if (supply < 0n) throw new Error(`negative projected supply for ${next.isin}`);
      next.totalSupply = supply.toString();
      break;
    }
  }

  if (
    position.block > next.updatedBlock ||
    (position.block === next.updatedBlock && position.logIndex > next.updatedLogIndex)
  ) {
    next.updatedBlock = position.block;
    next.updatedLogIndex = position.logIndex;
  }
  return next;
}
