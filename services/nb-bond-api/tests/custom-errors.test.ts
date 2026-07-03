import { Interface } from 'ethers';
import { bondAuctionAbi, bondManagerAbi, tbdAbi } from '../src/abi';
import { decodeCustomError, describeRevert } from '../src/chain';

describe('decodeCustomError', () => {
  const auctionIface = new Interface(bondAuctionAbi);
  const managerIface = new Interface(bondManagerAbi);
  const inBidPhaseData = auctionIface.encodeErrorResult('InBidPhase', []);

  it('decodes a known custom error from the matching interface', () => {
    expect(decodeCustomError({ data: inBidPhaseData }, [auctionIface])).toBe('InBidPhase');
  });

  it('finds the error across multiple interfaces (close reverts bubble from BondAuction)', () => {
    // InBidPhase is defined in BondAuction, not BondManager; the close path
    // calls BondManager.closeAuction but the revert originates in BondAuction,
    // so the decoder must try the auction interface too.
    expect(decodeCustomError({ data: inBidPhaseData }, [managerIface, auctionIface])).toBe(
      'InBidPhase',
    );
  });

  it('reads revert bytes from the nested ethers v6 error shapes', () => {
    expect(decodeCustomError({ info: { error: { data: inBidPhaseData } } }, [auctionIface])).toBe(
      'InBidPhase',
    );
    expect(decodeCustomError({ error: { data: inBidPhaseData } }, [auctionIface])).toBe(
      'InBidPhase',
    );
  });

  it('returns null for an unknown selector or missing/non-hex data', () => {
    expect(decodeCustomError({ data: '0xdeadbeef' }, [auctionIface])).toBeNull();
    expect(decodeCustomError({ data: 'not-hex' }, [auctionIface])).toBeNull();
    expect(decodeCustomError({}, [auctionIface])).toBeNull();
    expect(decodeCustomError(new Error('boom'), [auctionIface])).toBeNull();
  });
});

describe('describeRevert', () => {
  const managerIface = new Interface(bondManagerAbi);
  const tbdIface = new Interface(tbdAbi);

  // Real revert captured from a live coupon payment whose default holder
  // list still included the BondManager itself (treasury-held units after
  // a partial allocation): BondDvP wrapped the government TBD's
  // AllowlistViolation in SettlementFailure's lowLevelData bytes.
  const settlementRevertData =
    '0xc974ce95' +
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000040' +
    '00000000000000000000000000000000000000000000000000000000000000c4' +
    '263ee27b' +
    '0000000000000000000000000000000000000000000000000000000000000060' +
    '000000000000000000000000e61a63ef630b7b6ff9b9e595b61f641171a4eb97' +
    '00000000000000000000000000000000000000000000000000000000000000a0' +
    '000000000000000000000000000000000000000000000000000000000000000a' +
    '544244204e6f7264656100000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000';

  it('describes a SettlementFailure incl. its nested AllowlistViolation', () => {
    const described = describeRevert({ data: settlementRevertData }, [managerIface, tbdIface]);
    expect(described).toContain('SettlementFailure');
    expect(described).toContain('AllowlistViolation');
    expect(described).toContain('TBD Nordea');
    expect(described).toContain('0xe61a63Ef630b7B6FF9b9e595B61f641171a4eB97');
  });

  it('describes a flat error without nesting', () => {
    const flat = tbdIface.encodeErrorResult('AllowlistViolation', [
      'TBD Nordea',
      '0xe61a63Ef630b7B6FF9b9e595B61f641171a4eB97',
      'not allowed',
    ]);
    const described = describeRevert({ data: flat }, [tbdIface]);
    expect(described).toContain('AllowlistViolation');
    expect(described).toContain('not allowed');
  });

  it('returns null when nothing matches', () => {
    expect(describeRevert({ data: '0xdeadbeef' }, [managerIface, tbdIface])).toBeNull();
    expect(describeRevert(new Error('boom'), [managerIface, tbdIface])).toBeNull();
  });
});
