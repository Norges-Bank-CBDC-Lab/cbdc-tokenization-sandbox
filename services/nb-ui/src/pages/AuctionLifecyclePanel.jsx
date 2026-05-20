/**
 * AuctionLifecyclePanel — drives an auction through its lifecycle.
 *
 *   open ──► closed ──► finalised
 *                  └──► rejected
 *   (cancelled is a terminal state reachable from open or closed)
 *
 * Surfaces three actions, gated by current status:
 *   - Close auction       (open → closed, PATCH)
 *   - Approve / Reject    (closed → finalised|rejected, PUT)
 *   - Cancel auction      (open|closed → cancelled, DELETE)
 *
 * "Reopen" is rendered when status is "closed" but the backend / on-chain
 * has no closed→open transition yet — see docs/KNOWN_ISSUES.md
 * "nb-ui: reopenAuction needs backend / on-chain support". The httpClient
 * throws NotImplementedError so the UI shows a clear toast.
 */
import { useState, useMemo } from 'react';
import { Fmt } from '../utils/format.js';
import { Button, Field, Input, Modal, RadioGroup, StatusBadge } from '../components/ui.jsx';

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
    case 'rejected':
      return 1;
    case 'cancelled':
      return -1;
    default:
      return 0;
  }
}

function Stepper({ status }) {
  const reached = progressFor(status);
  const isTerminalBad = status === 'rejected' || status === 'cancelled';

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
  if (status === 'rejected') {
    return (
      <div className="lc-terminal lc-terminal-bad">
        <div className="lc-terminal-icon">✕</div>
        <div>
          <div className="lc-terminal-title">Allocation rejected</div>
          <div className="lc-terminal-msg">
            The computed allocation was rejected. No tokens were issued. A new auction can be
            created to retry.
          </div>
        </div>
      </div>
    );
  }
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
        finalised or rejected.
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

function FinaliseModal({ auction, onClose, onConfirm, busy }) {
  // Bids come from the auction subtree — no separate fetch.
  const bids = useMemo(() => auction.bids.filter((b) => b.state === 'unsealed'), [auction.bids]);
  const unsealed = bids.length > 0;
  const [mode, setMode] = useState('approve');
  const [ack, setAck] = useState(false);
  const [selectionOverride, setSelectionOverride] = useState(null);
  const offering = Number(auction.size || 0);

  const selected = useMemo(() => {
    return selectionOverride ?? new Set(bids.map((_, i) => i));
  }, [bids, selectionOverride]);

  const summary = useMemo(() => {
    if (!unsealed) return null;
    const picked = [...selected].map((i) => bids[i]).filter(Boolean);
    const totalUnits = picked.reduce((s, b) => s + Number(b.units || 0), 0);
    const clearingBps = picked.reduce((max, b) => Math.max(max, Number(b.rate || 0)), 0);
    return {
      count: picked.length,
      totalUnits,
      clearingBps,
      overAllocated: offering > 0 && totalUnits > offering,
      underFilled: offering > 0 && totalUnits < offering,
    };
  }, [selected, bids, unsealed, offering]);

  function toggle(i) {
    setSelectionOverride((prev) => {
      const next = new Set(prev ?? selected ?? []);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function selectAll() {
    setSelectionOverride(new Set(bids.map((_, i) => i)));
  }
  function selectNone() {
    setSelectionOverride(new Set());
  }
  function autoFill() {
    const idxs = bids.map((b, i) => ({ i, rate: Number(b.rate), units: Number(b.units) }));
    idxs.sort((a, b) => a.rate - b.rate || b.units - a.units);
    const next = new Set();
    let acc = 0;
    for (const x of idxs) {
      if (acc >= offering) break;
      next.add(x.i);
      acc += x.units;
    }
    setSelectionOverride(next);
  }

  const allocationHash = auction.allocation?.hash || null;
  const disabled = busy || !allocationHash || !ack || (mode === 'approve' && selected.size === 0);

  return (
    <Modal
      title="Finalise allocation"
      maxWidth={780}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === 'approve' ? 'primary' : 'danger'}
            onClick={() => onConfirm(mode === 'approve', [...(selected ?? [])])}
            disabled={disabled}
          >
            {busy
              ? mode === 'approve'
                ? 'Approving…'
                : 'Rejecting…'
              : mode === 'approve'
                ? `Approve ${selected?.size ?? 0} winner${selected?.size === 1 ? '' : 's'}`
                : 'Reject allocation'}
          </Button>
        </>
      }
    >
      <p className="lc-modal-lead">
        Select the bids that will be issued tokens. The clearing rate is the highest accepted rate —
        all winners pay the same. Approving signs the allocation on-chain. Rejecting marks the
        auction rejected and issues no tokens.
      </p>

      <div className="lc-hash">
        <div className="lc-hash-label">Allocation hash</div>
        <div className="lc-hash-value mono">{allocationHash || '— not yet computed —'}</div>
      </div>

      <div className="lc-bids-header">
        <div className="lc-bids-title">Bids ({bids.length})</div>
        <div className="lc-bids-tools">
          <Button size="sm" variant="ghost" onClick={autoFill} disabled={!unsealed}>
            Auto-fill
          </Button>
          <Button size="sm" variant="ghost" onClick={selectAll} disabled={!unsealed}>
            All
          </Button>
          <Button size="sm" variant="ghost" onClick={selectNone} disabled={!unsealed}>
            None
          </Button>
        </div>
      </div>

      <div className="lc-bids-table-wrap">
        {!unsealed && (
          <div className="state" style={{ padding: 'var(--sp-5)' }}>
            <div className="state-msg">
              Bids are still sealed. Close the auction first to unseal them.
            </div>
          </div>
        )}
        {unsealed && (
          <table className="tbl lc-bids-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>✓</th>
                <th>Bidder</th>
                <th className="num">Rate</th>
                <th className="num">Units</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b, i) => {
                const checked = selected?.has(i) ?? false;
                return (
                  <tr
                    key={i}
                    className={`clickable ${checked ? 'lc-bid-on' : 'lc-bid-off'}`}
                    onClick={() => toggle(i)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(i)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="mono">{Fmt.shortHex(b.bidder, 8, 6)}</td>
                    <td className="num mono">{Fmt.bpsToPct(b.rate)}</td>
                    <td className="num mono">{Fmt.formatUnits(b.units)}</td>
                    <td className="num">{Fmt.formatNok(b.units)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {summary && (
        <div className="lc-summary-row">
          <div className="lc-summary-cell">
            <div className="lc-summary-label">Winners</div>
            <div className="lc-summary-value mono">
              {summary.count} / {bids.length}
            </div>
          </div>
          <div className="lc-summary-cell">
            <div className="lc-summary-label">Clearing rate</div>
            <div className="lc-summary-value mono">
              {summary.count === 0 ? '—' : Fmt.bpsToPct(summary.clearingBps)}
            </div>
          </div>
          <div className="lc-summary-cell">
            <div className="lc-summary-label">Allocated</div>
            <div className="lc-summary-value mono">{Fmt.formatUnits(summary.totalUnits)}</div>
            <div className="lc-summary-sub">of {Fmt.formatUnits(offering)} offered</div>
          </div>
          <div className="lc-summary-cell">
            <div className="lc-summary-label">Coverage</div>
            <div
              className={`lc-summary-value mono ${
                summary.overAllocated ? 'lc-over' : summary.underFilled ? 'lc-under' : ''
              }`}
            >
              {offering > 0 ? ((summary.totalUnits / offering) * 100).toFixed(1) + '%' : '—'}
            </div>
            <div className="lc-summary-sub">
              {summary.overAllocated
                ? 'Over offering'
                : summary.underFilled
                  ? 'Under offering'
                  : 'Fully covered'}
            </div>
          </div>
        </div>
      )}

      <div className="lc-decision">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Decision</label>
          <RadioGroup
            name="finalise-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'approve', label: 'Approve' },
              { value: 'reject', label: 'Reject' },
            ]}
          />
        </div>
      </div>

      <label className="lc-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I have independently verified the selected allocation and this decision is final.
        </span>
      </label>
    </Modal>
  );
}

function ReopenModal({ auction, onClose, onConfirm, busy }) {
  return (
    <Modal
      title="Reopen auction"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep closed
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Reopening…' : 'Reopen auction'}
          </Button>
        </>
      }
    >
      <p className="lc-modal-lead">
        Reopening returns the auction to <strong>open</strong> state and discards the computed
        allocation. New bids can be submitted until the auction is closed again. Use this when a
        counting error is spotted before finalisation, or to extend the bidding window.
      </p>
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
      <div className="lc-warning">
        The current allocation hash will be discarded. Any in-progress finalisation review must be
        restarted after reopening.
      </div>
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

export function AuctionLifecyclePanel({ auction, onClose, onReopen, onFinalise, onCancel, busy }) {
  const [modal, setModal] = useState(null);
  const s = auction.status;

  const canClose = s === 'open';
  const canFinalise = s === 'closed';
  const canReopen = s === 'closed';
  const canCancel = s === 'open' || s === 'closed';
  const terminal = s === 'finalised' || s === 'rejected' || s === 'cancelled';

  const summary =
    s === 'open'
      ? 'Auction is open. Sealed bids may still be submitted until the scheduled end.'
      : s === 'closed'
        ? 'Bids have been unsealed and the allocation has been computed. Review and finalise to issue tokens.'
        : s === 'finalised'
          ? 'Allocation has been approved. Tokens are issued.'
          : s === 'rejected'
            ? 'Allocation was rejected. No tokens were issued.'
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
                    'Pick which bids will receive tokens at the clearing rate, then approve or reject.'}
                </div>
              </div>
              <div className="lc-action-buttons">
                {canReopen && (
                  <Button variant="default" onClick={() => setModal('reopen')} disabled={busy}>
                    Reopen…
                  </Button>
                )}
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
        <FinaliseModal
          auction={auction}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(approve, winners) => handle(onFinalise, approve, winners)}
        />
      )}
      {modal === 'reopen' && (
        <ReopenModal
          auction={auction}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={() => handle(onReopen)}
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
