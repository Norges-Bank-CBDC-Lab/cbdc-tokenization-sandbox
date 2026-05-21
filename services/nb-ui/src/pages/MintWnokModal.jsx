/**
 * MintWnokModal — Mint WNOK to an allowlisted address.
 *
 * The WNOK contract reverts on mint-to-non-allowlisted; the API
 * surfaces that as a 500 with the on-chain revert reason in `detail`.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function MintWnokModal({ onClose, onSubmitted }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('1000');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => CentralBankApi.mintWnok(payload));

  const addrError =
    address && !ADDR_PATTERN.test(address.trim())
      ? 'Must be an EVM address (0x + 40 hex chars).'
      : null;
  const amountError =
    amount && (!/^\d+$/.test(amount) || Number(amount) <= 0)
      ? 'Amount must be a positive integer (1-NOK units).'
      : null;
  const valid = ADDR_PATTERN.test(address.trim()) && /^\d+$/.test(amount) && Number(amount) > 0;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const ref = await mutation.run({ address: address.trim(), amount });
      onSubmitted(ref);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to mint.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Minting…' : 'Mint WNOK'}
      </Button>
    </>
  );

  return (
    <Modal title="Mint WNOK" onClose={onClose} footer={footer}>
      <Field
        label="Recipient address"
        hint="Must be on the WNOK allowlist; mint reverts otherwise."
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
