/**
 * CreateBondModal — issue a new bond.
 *
 * The API has no "create bond" endpoint. A bond is created on-chain by its
 * first issuing auction (POST /v1/bonds/{isin}/auctions with maturityDuration).
 * This form captures both the bond's maturity and the issuing-auction
 * parameters in one step.
 */
import { useState } from 'react';
import { AuctionsApi } from '../api/auctionsApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, RadioGroup } from '../components/ui.jsx';

const YEAR_SECS = 365 * 86400;

export function CreateBondModal({ existingIsins, onClose, onCreated }) {
  const [isin, setIsin] = useState('NO00');
  const [maturityYears, setMaturityYears] = useState('5');
  const [auctionType, setAuctionType] = useState('RATE');
  const [size, setSize] = useState('1000000');
  const [endDays, setEndDays] = useState('7');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => AuctionsApi.createAuction(payload.isin, payload.body));

  const isinError =
    isin.length < 12
      ? 'ISIN must be at least 12 characters.'
      : existingIsins.includes(isin)
        ? 'An ISIN with this code already exists.'
        : null;

  const valid = !isinError && Number(maturityYears) > 0 && Number(size) > 0 && Number(endDays) > 0;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const body = {
        type: auctionType,
        end: now + Math.round(Number(endDays) * 86400),
        size: Math.round(Number(size)),
        maturityDuration: Math.round(Number(maturityYears) * YEAR_SECS),
      };
      const res = await mutation.run({ isin, body });
      onCreated(res);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to issue bond.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Issuing…' : 'Issue bond'}
      </Button>
    </>
  );

  return (
    <Modal title="Issue new bond" onClose={onClose} footer={footer}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        A bond is created on-chain by its first issuing auction. Set the bond&apos;s maturity and
        the parameters for the auction that issues it.
      </p>

      <Field
        label="ISIN"
        hint="12-character international security identifier (e.g. NO0012345678)."
        error={isinError}
      >
        <Input
          mono
          value={isin}
          onChange={(e) => setIsin(e.target.value.toUpperCase())}
          placeholder="NO0012345678"
          maxLength={20}
        />
      </Field>

      <Field label="Maturity" hint="Years from issuance until the bond matures.">
        <Input
          type="number"
          min="0.25"
          step="0.25"
          value={maturityYears}
          onChange={(e) => setMaturityYears(e.target.value)}
        />
      </Field>

      <div className="divider" />
      <div
        className="muted"
        style={{
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        Issuing auction
      </div>

      <Field label="Auction type">
        <RadioGroup
          name="auction-type"
          value={auctionType}
          onChange={setAuctionType}
          options={[
            { value: 'RATE', label: 'RATE' },
            { value: 'PRICE', label: 'PRICE' },
            { value: 'BUYBACK', label: 'BUYBACK' },
          ]}
        />
      </Field>

      <div className="field-row">
        <Field label="Offering size" hint="In whole 1,000 NOK units.">
          <Input
            type="number"
            min="1"
            step="1"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </Field>
        <Field label="Ends in" hint="Days from now until auction closes.">
          <Input
            type="number"
            min="0.1"
            step="0.5"
            value={endDays}
            onChange={(e) => setEndDays(e.target.value)}
          />
        </Field>
      </div>

      {submitErr && (
        <div className="error" style={{ marginTop: 8 }}>
          {submitErr}
        </div>
      )}
    </Modal>
  );
}
