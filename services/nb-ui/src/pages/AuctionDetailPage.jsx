/**
 * AuctionDetailPage — single auction subtree.
 *
 * One GET /v1/auctions/{id} returns the auction with its bids and
 * allocation. Mutations (close/cancel/finalise) return the updated
 * Auction; we splice it into local state via reload.
 */
import { useState } from 'react';
import { AuctionsApi } from '../api/auctionsApi.js';
import { BiddersApi } from '../api/biddersApi.js';
import { isAuctionExpired } from '../api/selectors.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  TypeBadge,
  useToast,
} from '../components/ui.jsx';
import { AuctionLifecyclePanel } from './AuctionLifecyclePanel.jsx';
import { PlaceBidModal } from './PlaceBidModal.jsx';
import { getTestMode } from '../utils/debugSettings.js';

/**
 * Renders a long hex string in full, wrappable + monospace, with a
 * one-click Copy button. Falls back to a select-all hint when the
 * clipboard API is unavailable (e.g. non-secure context).
 */
function CopyableHex({ value }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can still triple-click to select */
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <code
        className="mono"
        style={{
          flex: 1,
          wordBreak: 'break-all',
          background: 'var(--surface-2, #f5f6fa)',
          padding: '4px 6px',
          borderRadius: 4,
          fontSize: 12,
          userSelect: 'all',
        }}
      >
        {value}
      </code>
      <Button size="sm" variant="ghost" onClick={onCopy} title="Copy to clipboard">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function AuctionDetailPage({ auctionId, navigate }) {
  const auctionQ = useApi(() => AuctionsApi.getAuction(auctionId), [auctionId]);
  const biddersQ = useApi(() => BiddersApi.listBidders(), []);
  const [showPlaceBid, setShowPlaceBid] = useState(false);
  const toast = useToast();

  const closeMut = useMutation(() => AuctionsApi.closeAuction(auctionId));
  const reopenMut = useMutation(() => AuctionsApi.reopenAuction(auctionId));
  const cancelMut = useMutation(() => AuctionsApi.cancelAuction(auctionId));
  const finaliseMut = useMutation((approve, winners) =>
    AuctionsApi.finaliseAuction(auctionId, auctionQ.data?.allocation?.hash, approve, winners),
  );

  if (auctionQ.loading)
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  if (auctionQ.error)
    return (
      <div className="card">
        <ErrorState error={auctionQ.error} onRetry={auctionQ.reload} />
      </div>
    );

  const auction = auctionQ.data;
  const sealedCount = auction.bids.filter((b) => b.state === 'sealed').length;
  const unsealedCount = auction.bids.filter((b) => b.state === 'unsealed').length;

  async function doClose() {
    try {
      await closeMut.run();
      toast.push({ kind: 'ok', title: 'Auction closed' });
      auctionQ.reload();
    } catch (e) {
      toast.push({ title: 'Close failed', body: e.message });
    }
  }
  async function doReopen() {
    try {
      await reopenMut.run();
      toast.push({ kind: 'ok', title: 'Auction reopened' });
      auctionQ.reload();
    } catch (e) {
      toast.push({ title: 'Reopen failed', body: e.message });
    }
  }
  async function doCancel() {
    try {
      await cancelMut.run();
      toast.push({ kind: 'ok', title: 'Auction cancelled' });
      auctionQ.reload();
    } catch (e) {
      toast.push({ title: 'Cancel failed', body: e.message });
    }
  }
  async function doFinalise(approve, winners) {
    try {
      await finaliseMut.run(approve, winners);
      toast.push({
        kind: 'ok',
        title: approve ? 'Allocation approved' : 'Allocation rejected',
        body:
          approve && winners
            ? `${winners.length} winner${winners.length === 1 ? '' : 's'} finalised`
            : undefined,
      });
      auctionQ.reload();
    } catch (e) {
      toast.push({ title: 'Finalise failed', body: e.message });
    }
  }

  const mutating =
    closeMut.loading || reopenMut.loading || cancelMut.loading || finaliseMut.loading;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">
            <a
              href="#/auctions"
              onClick={(e) => {
                e.preventDefault();
                navigate('/auctions');
              }}
            >
              Auctions
            </a>{' '}
            ·{' '}
            <a
              href={`#/bonds/${auction.isin}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/bonds/${auction.isin}`);
              }}
            >
              {auction.isin}
            </a>
          </div>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>
            {Fmt.shortHex(auction.id, 10, 8)}
          </h1>
          <div className="subtitle row" style={{ gap: 12 }}>
            <StatusBadge status={auction.status} />
            <TypeBadge type={auction.type} />
            <span className="muted">·</span>
            <span>
              Ends {Fmt.formatUnixDate(auction.end)} ({Fmt.formatRelative(auction.end)})
            </span>
          </div>
        </div>
        <div className="actions">
          {auction.status === 'open' && (!isAuctionExpired(auction) || getTestMode()) && (
            <Button variant="primary" onClick={() => setShowPlaceBid(true)}>
              Place bid
            </Button>
          )}
          <Button variant="ghost" onClick={auctionQ.reload}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Offering size</div>
          <div className="kpi-value mono">{Fmt.formatUnits(auction.size)}</div>
          <div className="kpi-sub">{Fmt.formatNok(auction.size)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sealed bids</div>
          <div className="kpi-value">{sealedCount}</div>
          <div className="kpi-sub">{unsealedCount} unsealed</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Clearing rate</div>
          <div className="kpi-value">
            {auction.allocation?.clearingRate ? (
              Fmt.bpsToPct(auction.allocation.clearingRate)
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div className="kpi-sub">{auction.status === 'open' ? 'Awaiting close' : 'Computed'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Allocation hash</div>
          <div className="kpi-value mono" style={{ fontSize: 14 }}>
            {Fmt.shortHex(auction.allocation?.hash, 10, 6)}
          </div>
          <div className="kpi-sub">
            {auction.status === 'finalised'
              ? 'Finalised'
              : auction.status === 'rejected'
                ? 'Rejected'
                : 'Pending'}
          </div>
        </div>
      </div>

      <div className="stack-5">
        <AuctionLifecyclePanel
          auction={auction}
          busy={mutating}
          onClose={doClose}
          onReopen={doReopen}
          onFinalise={doFinalise}
          onCancel={doCancel}
        />

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Auction metadata</h3>
          </div>
          <div className="card-body">
            <dl className="kv-grid">
              <dt>Auction ID</dt>
              <dd className="mono">{auction.id}</dd>
              <dt>ISIN</dt>
              <dd className="mono">{auction.isin}</dd>
              <dt>Type</dt>
              <dd>
                <TypeBadge type={auction.type} />
              </dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={auction.status} />
              </dd>
              <dt>Owner</dt>
              <dd className="mono">{auction.owner}</dd>
              <dt>Auction contract</dt>
              <dd className="mono">{auction.contracts.auction}</dd>
              <dt>Bond token</dt>
              <dd className="mono">{auction.contracts.token}</dd>
              <dt>Offering</dt>
              <dd className="mono">{Fmt.formatUnits(auction.size)} units</dd>
              <dt>End</dt>
              <dd>{Fmt.formatUnixDate(auction.end)}</dd>
              <dt
                title={
                  'Bidders encrypt the plaintext of their bid against this public key before ' +
                  'submitting it on-chain. The auctioneer holds the matching private key and ' +
                  'unseals every bid only after closeAuction(). Copy the full value below into ' +
                  'the bid-encryption CLI.'
                }
              >
                Sealing public key
              </dt>
              <dd>
                <CopyableHex value={auction.sealingPubKey} />
              </dd>
            </dl>
          </div>
        </div>

        <BidsCard bids={auction.bids} />
        <AllocationCard allocation={auction.allocation} status={auction.status} />
      </div>

      {showPlaceBid && (
        <PlaceBidModal
          bidders={biddersQ.data ?? []}
          defaultAuctionId={auction.id}
          onClose={() => setShowPlaceBid(false)}
          onSubmitted={() => {
            setShowPlaceBid(false);
            toast.push({ kind: 'ok', title: 'Sealed bid submitted' });
            auctionQ.reload();
          }}
        />
      )}
    </div>
  );
}

function BidsCard({ bids }) {
  const state = bids.length > 0 ? bids[0].state : 'unsealed';
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Bids</h3>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {bids.length} {state}
        </span>
      </div>
      <div className="card-body flush">
        {bids.length === 0 ? (
          <EmptyState title="No bids yet" />
        ) : state === 'sealed' ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Ciphertext</th>
                <th>Plaintext hash</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{b.bidder}</td>
                  <td className="mono">{Fmt.shortHex(b.ciphertext, 8, 6)}</td>
                  <td className="mono">{Fmt.shortHex(b.plaintextHash, 8, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bidder</th>
                <th className="num">Rate</th>
                <th className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{b.bidder}</td>
                  <td className="num mono">{Fmt.bpsToPct(b.rate)}</td>
                  <td className="num mono">{Fmt.formatUnits(b.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Header badge that labels the allocation card's current lifecycle
// state. The card differentiates three states with allocation data:
//   - closed    — allocation computed, NOT yet on-chain ("Proposed")
//   - finalised — allocation minted on-chain ("Minted")
//   - rejected  — operator rejected the allocation
// Plus the no-data states (open / cancelled). This matches the operator
// feedback that "bids show all submitted bids; allocations show what was
// actually minted", while still letting the operator preview the
// proposed allocation between close and finalise — which is the whole
// point of the approval gate.
function allocationBadge(status) {
  if (status === 'finalised') {
    return { label: 'Minted on chain', color: '#10b981', bg: '#d1fae5' };
  }
  if (status === 'rejected') {
    return { label: 'Allocation rejected', color: '#b91c1c', bg: '#fee2e2' };
  }
  if (status === 'closed') {
    return { label: 'Proposed — pending finalisation', color: '#92400e', bg: '#fef3c7' };
  }
  return null;
}

function AllocationCard({ allocation, status }) {
  const badge = allocationBadge(status);
  const showTable = allocation && status !== 'open' && status !== 'cancelled';
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Allocation</h3>
        {badge && (
          <span
            style={{
              background: badge.bg,
              color: badge.color,
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {badge.label}
          </span>
        )}
        {allocation && status !== 'open' && (
          <span className="muted mono" style={{ fontSize: 12 }}>
            Clearing rate {Fmt.bpsToPct(allocation.clearingRate)}
          </span>
        )}
      </div>
      <div className="card-body flush">
        {status === 'open' && (
          <EmptyState
            title="No allocation yet"
            message="Bids are sealed and unrevealed. Allocation is computed when the auction closes."
          />
        )}
        {status === 'cancelled' && (
          <EmptyState
            title="Auction cancelled"
            message="No allocation was computed. All sealed bids stay on-chain but are not minted."
          />
        )}
        {showTable && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bidder</th>
                <th className="num">Allocated units</th>
                <th className="num">Rate</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {allocation.entries.map((a, i) => (
                <tr key={i}>
                  <td className="mono">{a.bidder}</td>
                  <td className="num mono">{Fmt.formatUnits(a.units)}</td>
                  <td className="num mono">{Fmt.bpsToPct(a.rate)}</td>
                  <td className="num">{Fmt.formatNok(a.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showTable === false && allocation && status !== 'open' && status !== 'cancelled' && (
          <EmptyState
            title="No allocation data"
            message="Auction was processed but the allocation block is empty."
          />
        )}
      </div>
    </div>
  );
}
