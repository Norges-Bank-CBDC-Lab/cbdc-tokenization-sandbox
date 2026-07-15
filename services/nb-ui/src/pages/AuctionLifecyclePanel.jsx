/**
 * AuctionLifecyclePanel — drives an auction through its lifecycle.
 *
 *   open ──► closed ──► finalised
 *   (cancelled is a terminal state reachable from open or closed)
 *
 * Surfaces three actions, gated by current status:
 *   - Close auction       (open → closed, PATCH)
 *   - Approve allocation  (closed → finalised, PUT)
 *   - Cancel auction      (open|closed → cancelled, DELETE)
 */
import { useState } from 'react';
import { Fmt } from '../utils/format.js';
import { Button, Field, Input, Modal, StatusBadge } from '../components/ui.jsx';
import { FinaliseAuctionModal } from './FinaliseAuctionModal.jsx';

const STEPS = [
  { key: 'open', label: 'Open', hint: 'Accepting sealed bids' },
  { key: 'closed', label: 'Closed', hint: 'Bids unsealed, allocation computed' },
  { key: 'finalised', label: 'Finalised', hint: 'Allocation approved on-chain' },
];

function progressFor(status) {
  switch (status) {
    case 'open':
      return 0;
    case 'closed':
      return 1;
    case 'finalised':
      return 2;
    case 'cancelled':
      return -1;
    default:
      return 0;
  }
}

function Stepper({ status }) {
  const reached = progressFor(status);
  const isTerminalBad = status === 'cancelled';

  return (
    <ol className="lc-steps" aria-label="Auction lifecycle">
      {STEPS.map((s, i) => {
        const state =
          isTerminalBad && i > reached
            ? 'skipped'
            : i < reached
              ? 'done'
              : i === reached && status === STEPS[i].key
                ? 'current'
                : i <= reached
                  ? 'done'
                  : 'todo';

        return (
          <li key={s.key} className={`lc-step lc-${state}`}>
            <div className="lc-dot" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'skipped' ? '·' : i + 1}
            </div>
            <div className="lc-step-text">
              <div className="lc-step-label">{s.label}</div>
              <div className="lc-step-hint">{s.hint}</div>
            </div>
            {i < STEPS.length - 1 && <div className="lc-bar" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function TerminalBanner({ status }) {
  if (status === 'cancelled') {
    return (
      <div className="lc-terminal lc-terminal-bad">
        <div className="lc-terminal-icon">⊘</div>
        <div>
          <div className="lc-terminal-title">Auction cancelled</div>
          <div className="lc-terminal-msg">
            This auction was cancelled before finalisation. No tokens were issued.
          </div>
        </div>
      </div>
    );
  }
  if (status === 'finalised') {
    return (
      <div className="lc-terminal lc-terminal-good">
        <div className="lc-terminal-icon">✓</div>
        <div>
          <div className="lc-terminal-title">Auction complete</div>
          <div className="lc-terminal-msg">
            Allocation approved. Bond tokens have been issued to winning bidders.
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function CloseModal({ auction, onClose, onConfirm, busy }) {
  const sealed = auction.bids.filter((b) => b.state === 'sealed').length;
  return (
    <Modal
      title="Close auction"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep open
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Closing…' : 'Close auction'}
          </Button>
        </>
      }
    >
      <p className="lc-modal-lead">
        Closing the auction stops bid submission, unseals all sealed bids, and computes the clearing
        rate and allocation. This action cannot be undone — once closed, the auction can only be
        finalised or cancelled.
      </p>
      <dl className="kv-grid lc-modal-kv">
        <dt>Auction</dt>
        <dd className="mono">{Fmt.shortHex(auction.id, 10, 8)}</dd>
        <dt>ISIN</dt>
        <dd className="mono">{auction.isin}</dd>
        <dt>Sealed bids</dt>
        <dd className="mono">{sealed}</dd>
        <dt>Offering</dt>
        <dd className="mono">{Fmt.formatUnits(auction.size)} units</dd>
        <dt>Scheduled end</dt>
        <dd>
          {Fmt.formatUnixDate(auction.end)} ({Fmt.formatRelative(auction.end)})
        </dd>
      </dl>
      {sealed === 0 && (
        <div className="lc-warning">
          No sealed bids were recorded. Closing now will produce an empty allocation.
        </div>
      )}
    </Modal>
  );
}

function CancelModal({ auction, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const matches = confirmText.trim().toUpperCase() === 'CANCEL';

  return (
    <Modal
      title="Cancel auction"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep auction
          </Button>
          <Button variant="danger" onClick={() => onConfirm(reason)} disabled={busy || !matches}>
            {busy ? 'Cancelling…' : 'Cancel auction'}
          </Button>
        </>
      }
    >
      <div className="lc-warning lc-warning-strong">
        Cancelling is permanent. The auction will be marked cancelled, any submitted bids will be
        discarded, and no tokens will be issued.
      </div>
      <dl className="kv-grid lc-modal-kv">
        <dt>Auction</dt>
        <dd className="mono">{Fmt.shortHex(auction.id, 10, 8)}</dd>
        <dt>ISIN</dt>
        <dd className="mono">{auction.isin}</dd>
        <dt>Current status</dt>
        <dd>
          <StatusBadge status={auction.status} />
        </dd>
      </dl>
      <Field label="Reason (optional, for audit log)">
        <textarea
          className="input"
          rows="3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Pricing error in offering memorandum"
          style={{ resize: 'vertical', fontFamily: 'var(--font-sans)' }}
        />
      </Field>
      <Field label="Type CANCEL to confirm">
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="CANCEL"
          mono
        />
      </Field>
    </Modal>
  );
}

export function AuctionLifecyclePanel({ auction, onClose, onFinalise, onCancel, busy }) {
  const [modal, setModal] = useState(null);
  const s = auction.status;

  const canClose = s === 'open';
  const canFinalise = s === 'closed';
  const canCancel = s === 'open' || s === 'closed';
  const terminal = s === 'finalised' || s === 'cancelled';

  const summary =
    s === 'open'
      ? 'Auction is open. Sealed bids may still be submitted until the scheduled end.'
      : s === 'closed'
        ? 'Bids have been unsealed and the allocation has been computed. Review and finalise to issue tokens.'
        : s === 'finalised'
          ? 'Allocation has been approved. Tokens are issued.'
          : s === 'cancelled'
            ? 'Auction was cancelled before finalisation.'
            : '';

  async function handle(action, ...args) {
    const ok = await action(...args);
    if (ok !== false) setModal(null);
  }

  return (
    <div className="card lc-panel">
      <div className="card-header">
        <h3 className="card-title">Lifecycle</h3>
        <StatusBadge status={s} />
      </div>
      <div className="card-body">
        <Stepper status={s} />

        {summary && <p className="lc-summary">{summary}</p>}
        <TerminalBanner status={s} />

        {!terminal && (
          <div className="lc-actions">
            <div className="lc-action-row">
              <div className="lc-action-text">
                <div className="lc-action-title">
                  {canClose && 'Step 1 · Close the auction'}
                  {canFinalise && 'Step 2 · Select winners & finalise'}
                </div>
                <div className="lc-action-hint">
                  {canClose &&
                    'Stops new bids, unseals submissions, and computes the clearing rate.'}
                  {canFinalise &&
                    'Pick which bids will receive tokens at the clearing rate, then approve the allocation.'}
                </div>
              </div>
              <div className="lc-action-buttons">
                {canClose && (
                  <Button variant="primary" onClick={() => setModal('close')} disabled={busy}>
                    Close auction…
                  </Button>
                )}
                {canFinalise && (
                  <Button variant="primary" onClick={() => setModal('finalise')} disabled={busy}>
                    Select winners & finalise…
                  </Button>
                )}
              </div>
            </div>

            {canCancel && (
              <div className="lc-cancel-row">
                <span className="muted">Need to abort?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setModal('cancel')}
                  disabled={busy}
                >
                  Cancel auction…
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {modal === 'close' && (
        <CloseModal
          auction={auction}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={() => handle(onClose)}
        />
      )}
      {modal === 'finalise' && (
        <FinaliseAuctionModal
          auction={auction}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(selection) => handle(onFinalise, selection)}
        />
      )}
      {modal === 'cancel' && (
        <CancelModal
          auction={auction}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(reason) => handle(onCancel, reason)}
        />
      )}
    </div>
  );
}
