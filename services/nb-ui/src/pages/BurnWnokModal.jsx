/**
 * BurnWnokModal — Burn WNOK from an allowlisted address.
 *
 * Reverts on-chain if `address` isn't allowlisted or holds less than
 * `amount`. The CB has BURNER_ROLE in the local sandbox; this surface
 * is sandbox-only and does not require the bidder's signature.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';
import { isPositiveInteger } from '../domain/amounts.js';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function BurnWnokModal({ onClose, onSubmitted }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('1000');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => CentralBankApi.burnWnok(payload));

  const addrError =
    address && !ADDR_PATTERN.test(address.trim())
      ? 'Must be an EVM address (0x + 40 hex chars).'
      : null;
  const amountError =
    amount && !isPositiveInteger(amount)
      ? 'Amount must be a positive integer (1-NOK units).'
      : null;
  const valid = ADDR_PATTERN.test(address.trim()) && isPositiveInteger(amount);

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const ref = await mutation.run({ address: address.trim(), amount });
      onSubmitted(ref);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to burn.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="danger" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Burning…' : 'Burn WNOK'}
      </Button>
    </>
  );

  return (
    <Modal title="Burn WNOK" onClose={onClose} footer={footer}>
      <Field
        label="From address"
        hint="The address whose WNOK balance is reduced. Must be allowlisted."
        error={addrError}
      >
        <Input
          mono
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x…"
          maxLength={42}
        />
      </Field>
      <Field label="Amount" hint="Whole 1-NOK units." error={amountError}>
        <Input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
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
