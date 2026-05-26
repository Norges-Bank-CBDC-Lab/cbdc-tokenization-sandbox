/**
 * CreateAuctionModal — schedule an auction for an existing bond.
 *
 * - When invoked without `lockIsin` (e.g. from AuctionsPage), the operator
 *   picks a bond from a dropdown of non-disabled bonds.
 * - When invoked with `lockIsin` (e.g. from BondDetailPage), the bond is
 *   fixed.
 * - The auction-type radio gates RATE / PRICE / BUYBACK against the
 *   selected bond's prior auction history: the contract requires the
 *   first auction for an ISIN to be RATE, and every subsequent auction to
 *   be PRICE or BUYBACK (per BondAuction.createAuction).
 */
import { useMemo, useState } from 'react';
import { AuctionsApi } from '../api/auctionsApi.js';
import { BondsApi } from '../api/bondsApi.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, RadioGroup, Select } from '../components/ui.jsx';

export function CreateAuctionModal({ defaultIsin = '', lockIsin = false, onClose, onCreated }) {
  const [isin, setIsin] = useState(defaultIsin);
  const [auctionType, setAuctionType] = useState('RATE');
  const [size, setSize] = useState('1000000');
  const [endDays, setEndDays] = useState('3');
  const [submitErr, setSubmitErr] = useState(null);

  // The dropdown needs the full bond list to determine each bond's auction
  // history. We pull non-disabled bonds; the gate is computed locally.
  const bondsQ = useApi(() => BondsApi.listBonds(), []);
  const bonds = useMemo(() => bondsQ.data ?? [], [bondsQ.data]);

  // Determine which auction types are valid for the currently-selected
  // bond. First auction must be RATE; any subsequent must be PRICE or
  // BUYBACK. BUYBACK additionally needs minted supply, but we leave that
  // contract-side — the operator sees the chain revert if they pick a
  // bond with no supply.
  const selectedBond = useMemo(() => bonds.find((b) => b.isin === isin), [bonds, isin]);
  const auctionsCount = selectedBond?.auctions?.length ?? 0;
  const isFirstAuction = !!selectedBond && auctionsCount === 0;
  const rateAvailable = isFirstAuction;
  const priceAvailable = !isFirstAuction && auctionsCount > 0;
  const buybackAvailable = !isFirstAuction && auctionsCount > 0;

  // Bond-change handler auto-corrects the picked auction type so the
  // user never has to manually flip RATE↔PRICE when changing bonds.
  function pickIsin(nextIsin) {
    setIsin(nextIsin);
    const next = bonds.find((b) => b.isin === nextIsin);
    if (!next) return;
    const nextCount = next.auctions?.length ?? 0;
    if (nextCount === 0) setAuctionType('RATE');
    else if (auctionType === 'RATE') setAuctionType('PRICE');
  }

  const mutation = useMutation((p) => AuctionsApi.createAuction(p.isin, p.body));

  const isinError =
    isin.length < 12
      ? 'ISIN must be at least 12 characters.'
      : selectedBond
        ? null
        : 'Pick a bond.';
  const valid = !isinError && Number(size) > 0 && Number(endDays) > 0;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const body = {
        type: auctionType,
        end: String(now + Math.round(Number(endDays) * 86400)),
        size: String(Math.round(Number(size))),
        // RATE on a pre-staged bond doesn't need a fresh maturity — the
        // bond already carries it from deployBond. The API tolerates
        // null in this path.
        maturityDuration: null,
      };
      const res = await mutation.run({ isin, body });
      onCreated(res);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to create auction.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Creating…' : 'Create auction'}
      </Button>
    </>
  );

  return (
    <Modal title="New auction" onClose={onClose} footer={footer}>
      <Field
        label="Bond"
        hint={
          lockIsin
            ? 'Auction will be created for this bond.'
            : 'Pick the bond this auction issues against. Disabled bonds are hidden.'
        }
        error={isinError}
      >
        {lockIsin ? (
          <Input mono disabled value={isin} />
        ) : (
          <Select value={isin} onChange={(e) => pickIsin(e.target.value)}>
            <option value="">— select bond —</option>
            {bonds.map((b) => {
              const auctions = b.auctions?.length ?? 0;
              return (
                <option key={b.isin} value={b.isin}>
                  {b.isin} ({auctions === 0 ? 'no auctions yet' : `${auctions} prior`})
                </option>
              );
            })}
          </Select>
        )}
      </Field>

      <Field
        label="Auction type"
        hint={
          isFirstAuction
            ? 'First auction for this bond. Must be RATE (the contract enforces it).'
            : auctionType === 'PRICE'
              ? 'Bidders bid a price; highest prices win. Issues new units.'
              : auctionType === 'BUYBACK'
                ? 'Treasury repurchases outstanding bonds from holders.'
                : 'RATE is unavailable: this bond already has a RATE auction.'
        }
      >
        <RadioGroup
          name="auction-type"
          value={auctionType}
          onChange={setAuctionType}
          options={[
            {
              value: 'RATE',
              label: 'RATE',
              disabled: !rateAvailable,
              title: rateAvailable
                ? 'Initial issuing auction. Sets the bond coupon yield from the clearing rate.'
                : 'RATE is only valid for the first auction. This bond already has prior auctions.',
            },
            {
              value: 'PRICE',
              label: 'PRICE',
              disabled: !priceAvailable,
              title: priceAvailable
                ? 'Extension auction. Issues additional units at a uniform price.'
                : 'PRICE auctions require a prior RATE auction. Pick RATE for the first auction.',
            },
            {
              value: 'BUYBACK',
              label: 'BUYBACK',
              disabled: !buybackAvailable,
              title: buybackAvailable
                ? 'Repurchase outstanding bonds from holders.'
                : 'BUYBACK auctions require a prior RATE auction. Pick RATE for the first auction.',
            },
          ]}
        />
      </Field>

      <div className="field-row">
        <Field label="Size" hint="Whole 1,000 NOK units.">
          <Input
            type="number"
            min="1"
            step="1"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </Field>
        <Field label="Ends in (days)">
          <Input
            type="number"
            min="0.1"
            step="0.5"
            value={endDays}
            onChange={(e) => setEndDays(e.target.value)}
          />
        </Field>
      </div>

      {submitErr && <div className="error">{submitErr}</div>}
    </Modal>
  );
}
