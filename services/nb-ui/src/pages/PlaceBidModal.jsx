/**
 * PlaceBidModal — submit a sealed bid on behalf of a bidder.
 *
 * The auction picker is filtered to BIDDING-phase auctions only; the
 * server-side endpoint enforces the same constraint and surfaces a
 * 409 if the auction has since closed. Units + rate are sent as
 * BigInt strings; the API constructs the plaintext, signs the
 * EIP-712 intent, dual-wraps, and submits on-chain from the bidder's
 * wallet.
 *
 * The `defaultAuctionId` prop lets the AuctionDetailPage launch this
 * modal with the auction pre-locked.
 */
import { useState } from 'react';
import { BiddersApi } from '../api/biddersApi.js';
import { BondsApi } from '../api/bondsApi.js';
import { selectOpenAuctions } from '../api/selectors.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import { Button, Field, Input, Modal, Select } from '../components/ui.jsx';

export function PlaceBidModal({
  bidder = null,
  bidders = null,
  defaultAuctionId = null,
  onClose,
  onSubmitted,
}) {
  const bondsQ = useApi(() => BondsApi.listBonds(), []);
  const openAuctions = selectOpenAuctions(bondsQ.data ?? []);

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

  // Effective auction id is derived from state + open auctions during render
  // (no effect / no cascading renders). When the user hasn't picked one yet
  // and at least one auction is open, fall back to the first one.
  const auctionId = selectedAuctionId || (openAuctions.length > 0 ? openAuctions[0].id : '');
  const auction = openAuctions.find((a) => a.id === auctionId) ?? null;
  const unitsValid = Number(units) > 0 && /^\d+$/.test(units);
  const rateValid = /^\d+$/.test(rate) && Number(rate) > 0;
  const valid = effectiveBidder && auctionId && unitsValid && rateValid;

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
          openAuctions.length === 0
            ? 'No auctions are in the BIDDING phase. Create or wait for one.'
            : `${openAuctions.length} auction${openAuctions.length === 1 ? '' : 's'} accepting bids.`
        }
      >
        <Select
          value={auctionId}
          onChange={(e) => setSelectedAuctionId(e.target.value)}
          disabled={Boolean(defaultAuctionId) || openAuctions.length === 0}
        >
          {openAuctions.length === 0 && <option value="">Select auction…</option>}
          {openAuctions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.isin} — {a.type} — {Fmt.shortHex(a.id, 8, 6)}
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
