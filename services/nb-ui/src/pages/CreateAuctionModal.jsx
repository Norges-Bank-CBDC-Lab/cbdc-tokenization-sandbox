/**
 * CreateAuctionModal — start a new auction on an existing bond.
 *
 * PRICE auctions issue new units at a uniform price; BUYBACK auctions
 * retire them. RATE auctions are intentionally NOT offered here — the
 * backend rejects RATE for any ISIN that already has an auction
 * ("subsequent auctions cannot be RATE"), and RATE is the bond-issuance
 * path which lives in CreateBondModal.
 */
import { useState } from 'react';
import { AuctionsApi } from '../api/auctionsApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, RadioGroup } from '../components/ui.jsx';

export function CreateAuctionModal({ defaultIsin = '', lockIsin = false, onClose, onCreated }) {
  const [isin, setIsin] = useState(defaultIsin);
  const [auctionType, setAuctionType] = useState('PRICE');
  const [size, setSize] = useState('1000000');
  const [endDays, setEndDays] = useState('3');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((p) => AuctionsApi.createAuction(p.isin, p.body));

  const isinError = isin.length < 12 ? 'ISIN must be at least 12 characters.' : null;
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
        label="Bond ISIN"
        hint={
          lockIsin ? 'Auction will be created for this bond.' : 'ISIN of the bond being auctioned.'
        }
        error={isinError}
      >
        <Input
          mono
          disabled={lockIsin}
          value={isin}
          onChange={(e) => setIsin(e.target.value.toUpperCase())}
          placeholder="NO0012345678"
          maxLength={20}
        />
      </Field>

      <Field
        label="Auction type"
        hint={
          auctionType === 'PRICE'
            ? 'Bidders bid a price; highest prices win. Issues new units.'
            : 'Treasury repurchases outstanding bonds from holders.'
        }
      >
        <RadioGroup
          name="auction-type"
          value={auctionType}
          onChange={setAuctionType}
          options={[
            { value: 'PRICE', label: 'PRICE' },
            { value: 'BUYBACK', label: 'BUYBACK' },
          ]}
        />
      </Field>
      <div className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 8 }}>
        To issue a new bond (RATE auction), use the <strong>+ New bond</strong> action on the Bonds
        page.
      </div>

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
