/**
 * AddBidderModal — generate a fresh keypair or import an existing one.
 *
 * On the server side the API generates a fresh secp256k1 keypair when
 * privateKey is omitted, otherwise it imports and re-derives the
 * address. The form mirrors that choice with a radio.
 */
import { useState } from 'react';
import { BiddersApi } from '../api/biddersApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, RadioGroup } from '../components/ui.jsx';

const PK_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function AddBidderModal({ existingNames, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('generate');
  const [privateKey, setPrivateKey] = useState('');
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((body) => BiddersApi.createBidder(body));

  const nameError = !name.trim()
    ? 'Name is required.'
    : existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())
      ? 'A bidder with this name already exists.'
      : null;
  const pkError =
    mode === 'import' && privateKey && !PK_PATTERN.test(privateKey.trim())
      ? 'Private key must be 0x-prefixed 32-byte hex (64 hex chars).'
      : null;

  const valid = !nameError && (mode === 'generate' || (privateKey.trim() !== '' && !pkError));

  async function submit() {
    if (!valid) return;
    setSubmitErr(null);
    try {
      await mutation.run({
        name: name.trim(),
        privateKey: mode === 'import' ? privateKey.trim() : undefined,
      });
      onCreated();
    } catch (e) {
      setSubmitErr(e.message || 'Failed to add bidder.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Adding…' : 'Add bidder'}
      </Button>
    </>
  );

  return (
    <Modal title="Add bidder" onClose={onClose} footer={footer}>
      <Field label="Name" hint="Human-readable label (e.g. Nordea, DNB)." error={nameError}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nordea" />
      </Field>

      <Field label="Keypair">
        <RadioGroup
          name="add-bidder-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'generate', label: 'Generate new keypair' },
            { value: 'import', label: 'Import existing private key' },
          ]}
        />
      </Field>

      {mode === 'import' && (
        <Field
          label="Private key"
          hint="0x-prefixed 32-byte hex. The address is derived server-side."
          error={pkError}
        >
          <Input
            mono
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="0x…"
            maxLength={66}
          />
        </Field>
      )}

      {submitErr && (
        <div className="error" style={{ marginTop: 8 }}>
          {submitErr}
        </div>
      )}
    </Modal>
  );
}
