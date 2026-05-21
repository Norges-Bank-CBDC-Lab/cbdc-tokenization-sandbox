/**
 * AllowlistAddModal — append an address to the WNOK allowlist.
 *
 * The Wnok.add(address) call is idempotent on-chain; we still do a
 * client-side duplicate check for fast feedback.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal } from '../components/ui.jsx';

const ADDR_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function AllowlistAddModal({ existingAddresses, onClose, onAdded }) {
  const [address, setAddress] = useState('');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((addr) => CentralBankApi.addToAllowlist(addr));

  const formatError =
    address && !ADDR_PATTERN.test(address.trim())
      ? 'Must be an EVM address (0x + 40 hex chars).'
      : null;
  const duplicateError =
    address &&
    !formatError &&
    existingAddresses.some((a) => a.toLowerCase() === address.trim().toLowerCase())
      ? 'Address is already on the allowlist.'
      : null;
  const error = formatError || duplicateError;
  const valid = address.trim() !== '' && !error;

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      const ref = await mutation.run(address.trim());
      onAdded(ref);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to add to allowlist.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Adding…' : 'Add to allowlist'}
      </Button>
    </>
  );

  return (
    <Modal title="Add to WNOK allowlist" onClose={onClose} footer={footer}>
      <Field
        label="Address"
        hint="The address will be permitted to send and receive WNOK once added."
        error={error}
      >
        <Input
          mono
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x…"
          maxLength={42}
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
