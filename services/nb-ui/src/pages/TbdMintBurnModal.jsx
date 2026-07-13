/**
 * TbdMintBurnModal — mint TBD to, or burn TBD from, an allowlisted address.
 *
 * One modal, two modes. The TBD contract reverts on a non-allowlisted target;
 * the API surfaces that revert reason in the error detail. Signed server-side
 * by the token's owning bank.
 */
import { useState } from 'react';
import { BankingApi } from '../api/bankingApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';
import { isPositiveInteger } from '../domain/amounts.js';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function TbdMintBurnModal({ mode, tbdAddress, symbol, onClose, onSubmitted }) {
  const isMint = mode === 'mint';
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState(isMint ? '100' : '');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((payload) =>
    isMint ? BankingApi.mint(tbdAddress, payload) : BankingApi.burn(tbdAddress, payload),
  );

  const addrError =
    address && !ADDR_PATTERN.test(address.trim())
      ? 'Must be an EVM address (0x + 40 hex chars).'
      : null;
  const amountError =
    amount && !isPositiveInteger(amount) ? 'Amount must be a positive whole number.' : null;
  const valid = ADDR_PATTERN.test(address.trim()) && isPositiveInteger(amount);

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const ref = await mutation.run({ address: address.trim(), amount });
      onSubmitted(ref);
    } catch (e) {
      setSubmitErr(e.message || `Failed to ${mode}.`);
    }
  }

  const verb = isMint ? 'Mint' : 'Burn';
  const label = symbol || 'TBD';
  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button
        onClick={submit}
        variant={isMint ? 'primary' : 'danger'}
        disabled={!valid || mutation.loading}
      >
        {mutation.loading ? `${verb}ing…` : `${verb} ${label}`}
      </Button>
    </>
  );

  return (
    <Modal title={`${verb} ${label}`} onClose={onClose} footer={footer}>
      <Field
        label={isMint ? 'Recipient address' : 'Account to burn from'}
        hint={
          isMint
            ? 'Must be on the TBD allowlist; mint reverts otherwise.'
            : 'Tokens are removed from this allowlisted account.'
        }
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
