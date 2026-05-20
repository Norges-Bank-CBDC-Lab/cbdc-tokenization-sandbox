/**
 * AuctionDetailPage — single auction subtree.
 *
 * One GET /v1/auctions/{id} returns the auction with its bids and
 * allocation. Mutations (close/cancel/finalise) return the updated
 * Auction; we splice it into local state via reload.
 */
import { AuctionsApi } from '../api/auctionsApi.js';
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

export function AuctionDetailPage({ auctionId, navigate }) {
  const auctionQ = useApi(() => AuctionsApi.getAuction(auctionId), [auctionId]);
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
              <dt>Sealing public key</dt>
              <dd className="mono">{Fmt.shortHex(auction.sealingPubKey, 12, 8)}</dd>
            </dl>
          </div>
        </div>

        <BidsCard bids={auction.bids} />
        <AllocationCard allocation={auction.allocation} status={auction.status} />
      </div>
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

function AllocationCard({ allocation, status }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Allocation</h3>
        {allocation && (
          <span className="muted mono" style={{ fontSize: 12 }}>
            Clearing rate {Fmt.bpsToPct(allocation.clearingRate)}
          </span>
        )}
      </div>
      <div className="card-body flush">
        {!allocation || status === 'open' ? (
          <EmptyState
            title="No allocation yet"
            message={
              status === 'open'
                ? 'Allocation is computed when the auction closes.'
                : 'Allocation data unavailable.'
            }
          />
        ) : (
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
      </div>
    </div>
  );
}
