/**
 * ConfirmDisableBondModal — destructive-action gate for "Disable bond".
 *
 * Mirrors the ConfirmResyncModal pattern: lays out exactly what changes,
 * what stays, and a type-the-ISIN gate before the destructive submit is
 * enabled. The bond is only disable-able when supply == 0 and no
 * FINALISED or in-flight auction exists; the parent must enforce that
 * gate before opening this modal.
 */
import { useState } from 'react';
import { Button, Input, Modal } from '../components/ui.jsx';

export function ConfirmDisableBondModal({ isin, onCancel, onConfirm }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isinMatches = text.trim().toUpperCase() === isin.toUpperCase();

  async function submit() {
    if (!isinMatches) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // Parent handles the failure toast; just unblock the form.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Disable bond ${isin}`}
      onClose={onCancel}
      maxWidth={620}
      footer={
        <>
          <Button onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} variant="danger" disabled={!isinMatches || submitting}>
            {submitting ? 'Disabling…' : 'Disable bond'}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Disabling is intended for bonds created in error or that turned out not to be needed. The
        action is <strong>terminal</strong>: the ISIN can be re-used later via{' '}
        <code>+ New bond</code>, but the previous bond&apos;s parameters cannot be recovered.
      </p>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>What will happen</h4>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>
          The bond&apos;s ERC-1410 partition is flipped to <code>inactive</code> on-chain and every
          per-partition mapping (offering, maturity, coupon) is cleared.
        </li>
        <li>
          The audit trail is <strong>preserved</strong>: chain events stay immutable and the
          projection keeps the <code>BondDisabled</code> event in the bond&apos;s history.
        </li>
        <li>
          The bond is hidden from the default <strong>Bonds</strong> list. Re-enable the{' '}
          <em>Show disabled</em> filter to see it again.
        </li>
      </ul>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>What stays</h4>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>
          Any cancelled auctions for this ISIN remain in chain history. They are still browsable
          from the Auctions page when <em>Show cancelled</em> is enabled.
        </li>
        <li>Bidders, central-bank state, and WNOK balances are unaffected.</li>
      </ul>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>
        To proceed, type the ISIN: <code>{isin}</code>
      </h4>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isin}
        autoFocus
        aria-label="disable-bond-confirm-isin"
      />
    </Modal>
  );
}
