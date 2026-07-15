import { useMemo, useState } from 'react';

import { Button, Modal } from '../components/ui.jsx';
import { formatPercentageRatio, parseUnsignedInteger } from '../domain/amounts.js';
import {
  selectAuctionBidPositions,
  summarizeAuctionSelection,
} from '../domain/auctionAllocation.js';
import { Fmt } from '../utils/format.js';

/** Stateful allocation review kept separate from the lifecycle presentation. */
export function FinaliseAuctionModal({ auction, onClose, onConfirm, busy }) {
  const bids = useMemo(
    () => auction.bids.filter((bid) => bid.state === 'unsealed'),
    [auction.bids],
  );
  const unsealed = bids.length > 0;
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectionOverride, setSelectionOverride] = useState(null);
  const offering = parseUnsignedInteger(auction.size || '0', 'offering');

  const selected = useMemo(
    () => selectionOverride ?? new Set(bids.map((_, index) => index)),
    [bids, selectionOverride],
  );
  const summary = useMemo(() => {
    if (!unsealed) return null;
    const picked = [...selected].map((index) => bids[index]).filter(Boolean);
    return summarizeAuctionSelection(picked, auction.type, offering);
  }, [selected, bids, unsealed, offering, auction.type]);

  function toggle(index) {
    setSelectionOverride((previous) => {
      const next = new Set(previous ?? selected);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const allocationHash = auction.allocation?.hash || null;
  const disabled = busy || !allocationHash || !acknowledged || selected.size === 0;

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
            variant="primary"
            onClick={() => {
              const winningBidIndexes = [...selected]
                .map((index) => bids[index]?.bidIndex)
                .filter((index) => Number.isInteger(index));
              onConfirm({
                winningBidIndexes,
                expectedClearingRate: String(summary?.clearingRate ?? 0n),
              });
            }}
            disabled={disabled}
          >
            {busy
              ? 'Approving…'
              : `Approve ${selected.size} winner${selected.size === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <p className="lc-modal-lead">
        Select the bids that will be issued tokens. The clearing rate is the highest accepted rate —
        all winners pay the same. Approving signs the allocation on-chain. To stop without issuing,
        close this dialog and use the durable Cancel auction action.
      </p>

      <div className="lc-hash">
        <div className="lc-hash-label">Allocation hash</div>
        <div className="lc-hash-value mono">{allocationHash || '— not yet computed —'}</div>
      </div>

      <div className="lc-bids-header">
        <div className="lc-bids-title">Bids ({bids.length})</div>
        <div className="lc-bids-tools">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelectionOverride(selectAuctionBidPositions(bids, auction.type, offering))
            }
            disabled={!unsealed}
          >
            Auto-fill
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectionOverride(new Set(bids.map((_, index) => index)))}
            disabled={!unsealed}
          >
            All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectionOverride(new Set())}
            disabled={!unsealed}
          >
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
              {bids.map((bid, index) => {
                const checked = selected.has(index);
                return (
                  <tr
                    key={index}
                    className={`clickable ${checked ? 'lc-bid-on' : 'lc-bid-off'}`}
                    onClick={() => toggle(index)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(index)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td className="mono">{Fmt.shortHex(bid.bidder, 8, 6)}</td>
                    <td className="num mono">{Fmt.bpsToPct(bid.rate)}</td>
                    <td className="num mono">{Fmt.formatUnits(bid.units)}</td>
                    <td className="num">{Fmt.formatNok(bid.units)}</td>
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
              {summary.count === 0 ? '—' : Fmt.bpsToPct(summary.clearingRate)}
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
              {offering > 0n ? formatPercentageRatio(summary.totalUnits, offering) : '—'}
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

      <label className="lc-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>
          I have independently verified the selected allocation and this decision is final.
        </span>
      </label>
    </Modal>
  );
}
