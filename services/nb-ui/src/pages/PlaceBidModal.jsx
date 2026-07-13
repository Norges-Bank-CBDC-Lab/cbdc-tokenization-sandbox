/**
 * PlaceBidModal — submit a sealed bid on behalf of a bidder.
 *
 * The auction picker lists every BIDDING-phase auction (`status` ==
 * `open`), but only auctions whose `end` is still in the future are
 * selectable — past-end-time auctions are shown disabled with an
 * inline note, mirroring the chain rule:
 *
 *     submitBid: require(status == BIDDING && block.timestamp <= end)
 *
 * Test mode flips this off: when the top-bar toggle is ON, even
 * expired auctions become selectable so the operator can confirm the
 * chain-level rejection path. Units + rate are sent as BigInt
 * strings; the API constructs the plaintext, signs the EIP-712 bid
 * intent, dual-wraps, and submits on-chain from the bidder's wallet.
 *
 * The `defaultAuctionId` prop lets the AuctionDetailPage launch this
 * modal with the auction pre-locked.
 */
import { useState } from 'react';
import { BiddersApi } from '../api/biddersApi.js';
import { BondsApi } from '../api/bondsApi.js';
import { isAuctionExpired, selectOpenAuctions } from '../api/selectors.js';
import { useMutation } from '../hooks/useApi.js';
import { LiveResource, useLiveQuery } from '../sync/LiveUpdatesProvider.jsx';
import { Fmt } from '../utils/format.js';
import { Button, Field, Input, Modal, Select } from '../components/ui.jsx';
import { getTestMode } from '../utils/debugSettings.js';
import { isPositiveInteger } from '../domain/amounts.js';

export function PlaceBidModal({
  bidder = null,
  bidders = null,
  defaultAuctionId = null,
  onClose,
  onSubmitted,
}) {
  const bondsQ = useLiveQuery(
    [LiveResource.BONDS, LiveResource.AUCTIONS],
    () => BondsApi.listBonds(),
    [],
  );
  const openAuctions = selectOpenAuctions(bondsQ.data ?? []);
  const testMode = getTestMode();
  // Decorate each option with `expired` (status open AND end <= now).
  // Test mode lets the operator pick expired anyway — the chain will
  // still reject with NotInBidPhase(), but the API skips its pre-check
  // so the operator sees the chain's "no" directly.
  const auctionOptions = openAuctions.map((a) => ({ ...a, expired: isAuctionExpired(a) }));
  const acceptingCount = auctionOptions.filter((a) => !a.expired).length;
  const firstAcceptingId = auctionOptions.find((a) => !a.expired)?.id ?? '';

  const [selectedAuctionId, setSelectedAuctionId] = useState(defaultAuctionId ?? '');
  const [selectedBidderAddress, setSelectedBidderAddress] = useState('');
  const [units, setUnits] = useState('100');
  const [rate, setRate] = useState('425');
  const [submitErr, setSubmitErr] = useState(null);

  // Resolve the effective bidder during render — either the locked-in
  // prop, the operator's pick from the dropdown, or the first available.
  const candidateBidders = bidders ?? (bidder ? [bidder] : []);
  const effectiveBidderAddress = bidder
    ? bidder.address
    : selectedBidderAddress || candidateBidders[0]?.address || '';
  const effectiveBidder =
    bidder ??
    candidateBidders.find(
      (b) => b.address.toLowerCase() === effectiveBidderAddress.toLowerCase(),
    ) ??
    null;

  const mutation = useMutation((payload) => BiddersApi.placeBid(effectiveBidder.address, payload));

  // Effective auction id is derived from state + open auctions during
  // render (no effect / no cascading renders). When the user hasn't
  // picked one yet, fall back to the first auction that's actually
  // accepting bids — never default to an expired one.
  const auctionId = selectedAuctionId || firstAcceptingId;
  const auction = auctionOptions.find((a) => a.id === auctionId) ?? null;
  const auctionExpired = Boolean(auction?.expired);
  const unitsValid = isPositiveInteger(units);
  const rateValid = isPositiveInteger(rate);
  // Submit is allowed when the selection is currently accepting bids,
  // OR when Test mode is ON (operator wants the chain rejection).
  const auctionAllowed = !auctionExpired || testMode;
  const valid = effectiveBidder && auctionId && auctionAllowed && unitsValid && rateValid;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      await mutation.run({ auctionId, units, rate });
      onSubmitted();
    } catch (e) {
      setSubmitErr(e.message || 'Failed to submit bid.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Sealing & submitting…' : 'Submit sealed bid'}
      </Button>
    </>
  );

  return (
    <Modal
      title={effectiveBidder ? `Place bid as ${effectiveBidder.name}` : 'Place bid'}
      onClose={onClose}
      footer={footer}
    >
      <div className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {effectiveBidder ? (
          <>
            Bidder <span className="mono">{Fmt.shortHex(effectiveBidder.address)}</span>. The server
            signs the EIP-712 bid intent with this bidder’s key and submits the sealed ciphertext
            on-chain. The auctioneer will unseal it when the auction closes.
          </>
        ) : (
          'Pick a bidder, then submit a sealed bid for the chosen auction.'
        )}
      </div>

      {!bidder && candidateBidders.length > 0 && (
        <Field label="Bidder" hint="The API holds this bidder’s key and signs on their behalf.">
          <Select
            value={effectiveBidder?.address ?? ''}
            onChange={(e) => setSelectedBidderAddress(e.target.value)}
          >
            {candidateBidders.map((b) => (
              <option key={b.address} value={b.address}>
                {b.name} — {Fmt.shortHex(b.address)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Auction"
        hint={
          auctionOptions.length === 0
            ? 'No auctions are in the BIDDING phase. Create or wait for one.'
            : acceptingCount === 0
              ? testMode
                ? 'All open auctions have passed their end timestamp. Test mode lets you submit anyway — the chain will reject with InBidPhase().'
                : 'All open auctions have passed their end timestamp. Close them or wait for a new one.'
              : `${acceptingCount} of ${auctionOptions.length} open auction${auctionOptions.length === 1 ? '' : 's'} accepting bids.`
        }
        error={
          auctionExpired && !testMode
            ? `Auction ended ${Fmt.formatRelative(auction.end)}. Chain refuses bids after end. Enable Test mode in the top bar to attempt anyway.`
            : null
        }
      >
        <Select
          value={auctionId}
          onChange={(e) => setSelectedAuctionId(e.target.value)}
          disabled={Boolean(defaultAuctionId) || auctionOptions.length === 0}
        >
          {auctionOptions.length === 0 && <option value="">Select auction…</option>}
          {auctionOptions.map((a) => (
            <option key={a.id} value={a.id} disabled={a.expired && !testMode}>
              {a.isin} — {a.type} — {Fmt.shortHex(a.id, 8, 6)}
              {a.expired ? ` — ended ${Fmt.formatRelative(a.end)}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="field-row">
        <Field
          label="Units"
          hint="Bid quantity in whole 1,000 NOK units."
          error={!unitsValid && units !== '' ? 'Units must be a positive integer.' : null}
        >
          <Input
            type="number"
            min="1"
            step="1"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
          />
        </Field>
        <Field
          label="Rate (bps)"
          hint={
            auction?.type === 'RATE'
              ? 'Yield in basis points (e.g. 425 = 4.25%).'
              : 'Price per 100 nominal in bps (e.g. 9875 = 98.75).'
          }
          error={!rateValid && rate !== '' ? 'Rate must be a positive integer (bps).' : null}
        >
          <Input
            type="number"
            min="1"
            step="1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
      </div>

      {bondsQ.error && (
        <div className="error" style={{ marginTop: 8 }}>
          Failed to load auctions: {bondsQ.error.message}
        </div>
      )}
      {submitErr && (
        <div className="error" style={{ marginTop: 8 }}>
          {submitErr}
        </div>
      )}
    </Modal>
  );
}
