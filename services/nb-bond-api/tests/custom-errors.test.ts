import { Interface } from 'ethers';
import { bondAuctionAbi, bondManagerAbi } from '../src/abi';
import { decodeCustomError } from '../src/chain';

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
