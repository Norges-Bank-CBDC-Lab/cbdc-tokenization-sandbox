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
import { useMutation } from '../hooks/useApi.js';
import { LiveResource, useLiveQuery } from '../sync/LiveUpdatesProvider.jsx';
import { Fmt } from '../utils/format.js';
import {
  Button,
  CopyableHex,
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
  StatusBadge,
  TypeBadge,
  useToast,
} from '../components/ui.jsx';
import { AuctionLifecyclePanel } from './AuctionLifecyclePanel.jsx';
import { PlaceBidModal } from './PlaceBidModal.jsx';
import { getTestMode } from '../utils/debugSettings.js';

export function AuctionDetailPage({ auctionId, navigate }) {
  const auctionQ = useLiveQuery([LiveResource.AUCTIONS], () => AuctionsApi.getAuction(auctionId), [
    auctionId,
  ]);
  const biddersQ = useLiveQuery([LiveResource.BIDDERS], () => BiddersApi.listBidders(), []);
  const [showPlaceBid, setShowPlaceBid] = useState(false);
  const toast = useToast();

  const closeMut = useMutation(() => AuctionsApi.closeAuction(auctionId));
  const reopenMut = useMutation(() => AuctionsApi.reopenAuction(auctionId));
  const cancelMut = useMutation(() => AuctionsApi.cancelAuction(auctionId));
  const finaliseMut = useMutation((args) => AuctionsApi.finaliseAuction(auctionId, args));

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
  // `selection` is { winningBidIndexes, expectedClearingRate } from the
  // finalise modal — only forwarded when approving. The backend recomputes
  // the allocation over exactly the selected bids, so what is minted matches
  // the operator's selection rather than the full close-time allocation.
  async function doFinalise(approve, selection) {
    try {
      await finaliseMut.run(approve ? { approve: true, ...selection } : { approve: false });
      toast.push({
        kind: 'ok',
        title: approve ? 'Allocation approved' : 'Allocation rejected',
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

      <RefreshState
        refreshing={auctionQ.refreshing || biddersQ.refreshing}
        error={auctionQ.refreshError || biddersQ.refreshError}
        onRetry={() => {
          auctionQ.reload();
          biddersQ.reload();
        }}
      />

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
          <div className="kpi-label">{Fmt.clearingLabel(auction.type)}</div>
          <div className="kpi-value">
            {auction.status !== 'open' && auction.allocation?.clearingRate ? (
              Fmt.formatBidRate(auction.allocation.clearingRate, auction.type)
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div className="kpi-sub">
            {auction.status === 'open'
              ? 'Awaiting close'
              : auction.status === 'finalised'
                ? 'Final'
                : auction.allocation?.clearingRate
                  ? 'Proposed'
                  : '—'}
          </div>
        </div>
        <div className="kpi">
          <div
            className="kpi-label"
            title="Off-chain commitment to the computed allocation — the clearing rate plus every bidder's units. The operator confirms this exact digest when finalising; it is recomputed server-side to detect tampering. Not yet posted on-chain."
            style={{ cursor: 'help' }}
          >
            Allocation hash
          </div>
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

        <BidsCard bids={auction.bids} auctionType={auction.type} auctionStatus={auction.status} />
        <AllocationCard
          allocation={auction.allocation}
          status={auction.status}
          auctionType={auction.type}
        />
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

// "Best" direction depends on auction type: lowest yield wins for RATE,
// highest price wins for PRICE, lowest repurchase price wins for BUYBACK.
function bestBidRate(bids, auctionType) {
  if (bids.length === 0) return null;
  const rates = bids.map((b) => BigInt(b.rate));
  const pickMax = auctionType === 'PRICE';
  let best = rates[0];
  for (const r of rates) {
    if (pickMax ? r > best : r < best) best = r;
  }
  return best.toString();
}

function sumUnits(bids) {
  let total = 0n;
  for (const b of bids) total += BigInt(b.units);
  return total.toString();
}

export function BidsCard({ bids, auctionType, auctionStatus }) {
  const state = bids.length > 0 ? bids[0].state : 'unsealed';
  const rateLabel = Fmt.rateColumnLabel(auctionType);
  const totalsLabel = Fmt.bestRateLabel(auctionType);
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
            <tfoot>
              <tr>
                <td colSpan={3} className="muted">
                  Total bids: <span className="mono">{bids.length}</span>{' '}
                  <span className="muted">
                    (rates are encrypted until the auction closes
                    {auctionStatus === 'open' ? ' or test mode is enabled' : ''})
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bidder</th>
                <th className="num">{rateLabel}</th>
                <th className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{b.bidder}</td>
                  <td className="num mono">{Fmt.formatBidRate(b.rate, auctionType)}</td>
                  <td className="num mono">{Fmt.formatUnits(b.units)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="muted">
                  Total ({bids.length} bid{bids.length === 1 ? '' : 's'})
                </td>
                <td className="num mono" title={totalsLabel}>
                  {Fmt.formatBidRate(bestBidRate(bids, auctionType), auctionType)}
                </td>
                <td className="num mono">{Fmt.formatUnits(sumUnits(bids))}</td>
              </tr>
            </tfoot>
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

export function AllocationCard({ allocation, status, auctionType }) {
  const badge = allocationBadge(status);
  const showTable = allocation && status !== 'open' && status !== 'cancelled';
  const rateLabel = Fmt.rateColumnLabel(auctionType);
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
            {Fmt.clearingLabel(auctionType)}{' '}
            {Fmt.formatBidRate(allocation.clearingRate, auctionType)}
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
                <th className="num">{rateLabel}</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {allocation.entries.map((a, i) => (
                <tr key={i}>
                  <td className="mono">{a.bidder}</td>
                  <td className="num mono">{Fmt.formatUnits(a.units)}</td>
                  <td className="num mono">{Fmt.formatBidRate(a.rate, auctionType)}</td>
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
