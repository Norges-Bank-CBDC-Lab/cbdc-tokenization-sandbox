/**
 * ConfirmResyncModal — destructive-action gate for "Resync from block 0".
 *
 * Three plain-language sections (what / how long / while running) so
 * the operator can't miss what they're confirming, plus a type-to-confirm
 * input. The destructive submit is only enabled when the operator types
 * the exact confirmation phrase. We also block submission if `onConfirm`
 * throws (the parent modal stays open so the toast is in context).
 */
import { useState } from 'react';
import { Button, Input, Modal } from '../components/ui.jsx';

const CONFIRMATION_PHRASE = 'resync from block 0';

export function ConfirmResyncModal({ onCancel, onConfirm }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const phraseMatches = text.trim().toLowerCase() === CONFIRMATION_PHRASE;

  async function submit() {
    if (!phraseMatches) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // The parent modal pushes the toast; we just unblock the form.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Confirm resync from block 0"
      onClose={onCancel}
      maxWidth={620}
      footer={
        <>
          <Button onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} variant="danger" disabled={!phraseMatches || submitting}>
            {submitting ? 'Submitting…' : 'Resync from block 0'}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This is a <strong>destructive</strong> sandbox action. The on-chain state is unaffected —
        the chain remains the source of truth — but every local projection is dropped and rebuilt
        from chain logs.
      </p>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>What will happen</h4>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>
          The local projection will be <strong>DROPPED</strong>: <code>auctions</code>,{' '}
          <code>auction_events</code>, <code>bond_events</code>, <code>balance_events</code>,{' '}
          <code>balances</code>, <code>partitions</code>, <code>ingestion_state</code>.
        </li>
        <li>
          The bidder roster is <strong>PRESERVED</strong>: the <code>bidders</code> table is a
          system-of-record (sandbox impersonation keypairs) and is excluded from the reset.
        </li>
        <li>
          On-chain state is <strong>NOT AFFECTED</strong>: bonds, auctions, bids, allocations on
          chain stay exactly where they are.
        </li>
        <li>
          The ingestion loop restarts from block 0 (or the configured <code>START_BLOCK</code>) and
          rebuilds the projection by replaying every chain log.
        </li>
      </ul>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>Expected duration</h4>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>Today&apos;s sandbox (≤ a few hundred blocks): a few seconds.</li>
        <li>
          Rebuild time is roughly linear in chain block count + number of log-bearing blocks. A
          long-running sandbox (10k+ blocks) could take a minute or two.
        </li>
        <li>
          The <code>HealthBadge</code> colour acts as the readiness signal: yellow while rebuilding,
          green when caught up.
        </li>
      </ul>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>While the rebuild is running</h4>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>
          GET endpoints (<code>/v1/bonds</code>, <code>/v1/auctions</code>,{' '}
          <code>/v1/auctions/&#123;id&#125;</code>, <code>/v1/bonds/&#123;isin&#125;</code>) return{' '}
          <strong>PARTIAL</strong> data — only what&apos;s been re-ingested so far.
        </li>
        <li>
          Bidder and Central Bank endpoints continue to work normally (their data is not part of the
          projection).
        </li>
        <li>
          The <code>HealthBadge</code> reports <code>degraded</code> (yellow) while lag &gt; 0, then
          flips to <code>ok</code> once caught up.
        </li>
        <li>Don&apos;t draw conclusions about chain state until the badge is green again.</li>
      </ul>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>
        To proceed, type <code>{CONFIRMATION_PHRASE}</code>
      </h4>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={CONFIRMATION_PHRASE}
        autoFocus
        aria-label="resync-confirm-phrase"
      />
    </Modal>
  );
}
