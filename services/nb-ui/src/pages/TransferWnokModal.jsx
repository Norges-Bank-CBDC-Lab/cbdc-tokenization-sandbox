/**
 * TransferWnokModal — Send WNOK from the CB account to a recipient.
 *
 * The WNOK contract enforces allowlist on both sender and recipient.
 * The CB account is the sender; if it's not on its own allowlist, or
 * `to` isn't allowlisted, the on-chain transfer reverts.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, Select } from '../components/ui.jsx';
import { Fmt } from '../utils/format.js';
import { isPositiveInteger } from '../domain/amounts.js';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function TransferWnokModal({ cbAddress, cbBalance, allowlist, onClose, onSubmitted }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('100');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) => CentralBankApi.transferWnok(payload));

  const recipients = allowlist.filter((a) => a.toLowerCase() !== cbAddress.toLowerCase());

  const addrError =
    to && !ADDR_PATTERN.test(to.trim()) ? 'Must be an EVM address (0x + 40 hex chars).' : null;
  const amountError =
    amount && !isPositiveInteger(amount)
      ? 'Amount must be a positive integer (1-NOK units).'
      : null;
  const balanceWarn = isPositiveInteger(amount) && BigInt(amount) > BigInt(cbBalance ?? '0');

  const cbOnAllowlist = allowlist.some((a) => a.toLowerCase() === cbAddress.toLowerCase());

  const valid = ADDR_PATTERN.test(to.trim()) && isPositiveInteger(amount);

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

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Transferring…' : 'Transfer WNOK'}
      </Button>
    </>
  );

  return (
    <Modal title="Transfer WNOK from CB" onClose={onClose} footer={footer}>
      <div className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        From <span className="mono">{Fmt.shortHex(cbAddress, 10, 6)}</span>. CB balance:{' '}
        <span className="mono">{Fmt.formatUnits(cbBalance)}</span>.
      </div>

      {!cbOnAllowlist && (
        <div className="hint" style={{ marginTop: 8 }}>
          The CB account is not on the WNOK allowlist; the transfer will revert. Add the CB address
          on the Central Bank page first, then retry.
        </div>
      )}

      <Field label="Recipient" hint="Must be on the WNOK allowlist." error={addrError}>
        {recipients.length > 0 ? (
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Select from allowlist…</option>
            {recipients.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            mono
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            maxLength={42}
          />
        )}
      </Field>

      <Field
        label="Amount"
        hint="Whole 1-NOK units."
        error={amountError || (balanceWarn ? 'Amount exceeds CB balance.' : null)}
      >
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
