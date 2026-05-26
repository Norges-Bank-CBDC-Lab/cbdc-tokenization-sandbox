/**
 * CreateBondModal — pre-stage a new bond, no auction.
 *
 * Per the decoupled-lifecycle flow (operator-ui-backlog item 12): the modal
 * collects only the bond's ISIN and maturity. The first auction is
 * scheduled separately from BondDetailPage afterward — `onCreated` hands
 * the freshly-created Bond DTO back to the parent which navigates to the
 * detail page.
 */
import { useState } from 'react';
import { BondsApi } from '../api/bondsApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';

export function CreateBondModal({ existingIsins, onClose, onCreated }) {
  const [isin, setIsin] = useState('NO00');
  const [maturityYears, setMaturityYears] = useState('5');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => BondsApi.createBond(payload));

  const isinError =
    isin.length < 12
      ? 'ISIN must be at least 12 characters.'
      : existingIsins.includes(isin)
        ? 'An ISIN with this code already exists.'
        : null;

  const valid = !isinError && Number(maturityYears) > 0;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      // maturityDuration is the count of DURATION_SCALAR units (= years
      // on a real chain; 60-second "years" on the local sandbox). The
      // contract multiplies by DURATION_SCALAR to get seconds. Send the
      // year-count verbatim — sending seconds here causes the contract
      // to double-multiply and store an astronomical lifetime.
      const bond = await mutation.run({
        isin,
        maturityDuration: String(Math.round(Number(maturityYears))),
      });
      onCreated(bond);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to create bond.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Creating…' : 'Create bond'}
      </Button>
    </>
  );

  return (
    <Modal title="Create new bond" onClose={onClose} footer={footer}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        A bond is pre-staged with its ISIN and maturity here. Schedule the first issuing auction
        from the bond detail page once you&apos;re ready.
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

      <Field label="Maturity" hint="Years from distribution until the bond matures.">
        <Input
          type="number"
          min="0.25"
          step="0.25"
          value={maturityYears}
          onChange={(e) => setMaturityYears(e.target.value)}
        />
      </Field>

      {submitErr && (
        <div className="error" style={{ marginTop: 8 }}>
          {submitErr}
        </div>
      )}
    </Modal>
  );
}
