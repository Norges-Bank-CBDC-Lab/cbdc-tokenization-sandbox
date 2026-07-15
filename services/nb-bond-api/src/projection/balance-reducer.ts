export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type TransferBalanceDelta = {
  holder: string;
  delta: bigint;
  kind: 'mint' | 'burn' | 'transfer';
};

/**
 * Convert one canonical ERC-1410 TransferByPartition event into holder
 * deltas. Higher-level mint/redeem events are lifecycle facts only and must
 * never be passed here, because the token emits both event families for the
 * same state transition.
 */
export function reducePartitionTransfer(input: {
  from: string;
  to: string;
  value: bigint;
}): TransferBalanceDelta[] {
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();

  if (from === to) return [];
  if (from === ZERO_ADDRESS) {
    return to === ZERO_ADDRESS ? [] : [{ holder: to, delta: input.value, kind: 'mint' }];
  }
  if (to === ZERO_ADDRESS) {
    return [{ holder: from, delta: -input.value, kind: 'burn' }];
  }
  return [
    { holder: from, delta: -input.value, kind: 'transfer' },
    { holder: to, delta: input.value, kind: 'transfer' },
  ];
}
