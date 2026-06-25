/**
 * TransferTbdModal — transfer TBD from the owning bank's account to an
 * allowlisted recipient. Both parties must be allowlisted or the transfer
 * reverts; the API surfaces the revert reason.
 */
import { useState } from 'react';
import { BankingApi } from '../api/bankingApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function TransferTbdModal({ tbdAddress, symbol, bankName, onClose, onSubmitted }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => BankingApi.transfer(tbdAddress, payload));

  const toError =
    to && !ADDR_PATTERN.test(to.trim()) ? 'Must be an EVM address (0x + 40 hex chars).' : null;
  const amountError =
    amount && (!/^\d+$/.test(amount) || Number(amount) <= 0)
      ? 'Amount must be a positive whole number.'
      : null;
  const valid = ADDR_PATTERN.test(to.trim()) && /^\d+$/.test(amount) && Number(amount) > 0;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const ref = await mutation.run({ to: to.trim(), amount });
      onSubmitted(ref);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to transfer.');
    }
  }

  const label = symbol || 'TBD';
  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Transferring…' : `Transfer ${label}`}
      </Button>
    </>
  );

  return (
    <Modal title={`Transfer ${label}`} onClose={onClose} footer={footer}>
      <Field
        label="Recipient address"
        hint={`Sent from ${bankName || 'the owning bank'}'s account to an allowlisted recipient.`}
        error={toError}
      >
        <Input
          mono
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x…"
          maxLength={42}
        />
      </Field>
      <Field label="Amount" hint="Whole TBD units (decimals = 0)." error={amountError}>
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
