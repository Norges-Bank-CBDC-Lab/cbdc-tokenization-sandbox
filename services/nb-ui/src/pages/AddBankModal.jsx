/**
 * AddBankModal — create a commercial bank with a fresh (or imported)
 * keypair. Mirrors AddBidderModal: the server generates a secp256k1
 * keypair when privateKey is omitted, deploys a fresh TBD contract signed
 * by the bank's own key, registers "TBD <name>" in GlobalRegistry, and
 * (optionally) adds the bank to the WNOK allowlist for settlement.
 */
import { useState } from 'react';
import { BankingApi } from '../api/bankingApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Button, Field, Input, Modal, RadioGroup } from '../components/ui.jsx';

const PK_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function AddBankModal({ existingNames, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('generate');
  const [privateKey, setPrivateKey] = useState('');
  const [enableWnokSettlement, setEnableWnokSettlement] = useState(true);
  const [submitErr, setSubmitErr] = useState(null);

  const mutation = useMutation((body) => BankingApi.createBank(body));

  const nameError = !name.trim()
    ? 'Name is required.'
    : existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())
      ? 'A bank with this name already exists.'
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
      const created = await mutation.run({
        name: name.trim(),
        privateKey: mode === 'import' ? privateKey.trim() : undefined,
        enableWnokSettlement,
      });
      onCreated(created);
    } catch (e) {
      setSubmitErr(e.message || 'Failed to add bank.');
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost">
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={!valid || mutation.loading}>
        {mutation.loading ? 'Adding…' : 'Add bank'}
      </Button>
    </>
  );

  return (
    <Modal title="Add bank" onClose={onClose} footer={footer}>
      <Field
        label="Name"
        hint='The TBD contract is registered as "TBD <name>" in GlobalRegistry.'
        error={nameError}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sparebanken Norge"
        />
      </Field>

      <Field label="Keypair">
        <RadioGroup
          name="add-bank-mode"
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

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={enableWnokSettlement}
          onChange={(e) => setEnableWnokSettlement(e.target.checked)}
        />
        <span>Enable WNOK settlement (adds the bank to the WNOK allowlist)</span>
      </label>

      {submitErr && (
        <div className="error" style={{ marginTop: 8 }}>
          {submitErr}
        </div>
      )}
    </Modal>
  );
}
