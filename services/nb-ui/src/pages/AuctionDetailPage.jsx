/**
 * AuctionDetailPage — single auction: metadata, bids, allocations, actions.
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
  const statusQ = useApi(() => AuctionsApi.getAuctionStatus(auctionId), [auctionId]);
  const bidsQ = useApi(() => AuctionsApi.getAuctionBids(auctionId), [auctionId]);
  const allocQ = useApi(() => AuctionsApi.getAuctionAllocations(auctionId), [auctionId]);
  const toast = useToast();

  const closeMut = useMutation(() => AuctionsApi.closeAuction(auctionId));
  const reopenMut = useMutation(() => AuctionsApi.reopenAuction(auctionId));
  const cancelMut = useMutation(() => AuctionsApi.cancelAuction(auctionId));
  const finaliseMut = useMutation((approve, winners) =>
    AuctionsApi.finaliseAuction(
      auctionId,
      statusQ.data?.cached?.allocationHash || allocQ.data?.allocation?.allocationHash,
      approve,
      winners,
    ),
  );

  if (statusQ.loading)
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  if (statusQ.error)
    return (
      <div className="card">
        <ErrorState error={statusQ.error} onRetry={statusQ.reload} />
      </div>
    );

  const s = statusQ.data;
  const meta = s.metadata;

  function reloadAll() {
    statusQ.reload();
    bidsQ.reload();
    allocQ.reload();
  }

  async function doClose() {
    try {
      await closeMut.run();
      toast.push({ kind: 'ok', title: 'Auction closed' });
      reloadAll();
    } catch (e) {
      toast.push({ title: 'Close failed', body: e.message });
      return false;
    }
  }
  async function doReopen() {
    try {
      await reopenMut.run();
      toast.push({ kind: 'ok', title: 'Auction reopened' });
      reloadAll();
    } catch (e) {
      toast.push({ title: 'Reopen failed', body: e.message });
      return false;
    }
  }
  async function doCancel() {
    try {
      await cancelMut.run();
      toast.push({ kind: 'ok', title: 'Auction cancelled' });
      reloadAll();
    } catch (e) {
      toast.push({ title: 'Cancel failed', body: e.message });
      return false;
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
      reloadAll();
    } catch (e) {
      toast.push({ title: 'Finalise failed', body: e.message });
      return false;
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
              href={`#/bonds/${s.isin}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/bonds/${s.isin}`);
              }}
            >
              {s.isin}
            </a>
          </div>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>
            {Fmt.shortHex(s.auctionId, 10, 8)}
          </h1>
          <div className="subtitle row" style={{ gap: 12 }}>
            <StatusBadge status={s.status} />
            <TypeBadge type={meta.auctionType} />
            <span className="muted">·</span>
            <span>
              Ends {Fmt.formatUnixDate(meta.end)} ({Fmt.formatRelative(meta.end)})
            </span>
          </div>
        </div>
        <div className="actions">
          <Button variant="ghost" onClick={reloadAll}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Offering size</div>
          <div className="kpi-value mono">{Fmt.formatUnits(meta.offering)}</div>
          <div className="kpi-sub">{Fmt.formatNok(meta.offering)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sealed bids</div>
          <div className="kpi-value">{s.cached?.sealedCount ?? 0}</div>
          <div className="kpi-sub">{s.cached?.unsealedCount ?? 0} unsealed</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Clearing rate</div>
          <div className="kpi-value">
            {allocQ.data?.allocation?.clearingRate ? (
              Fmt.bpsToPct(allocQ.data.allocation.clearingRate)
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div className="kpi-sub">{s.status === 'open' ? 'Awaiting close' : 'Computed'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Allocation hash</div>
          <div className="kpi-value mono" style={{ fontSize: 14 }}>
            {Fmt.shortHex(s.cached?.allocationHash, 10, 6)}
          </div>
          <div className="kpi-sub">
            {s.cached?.finalised ? 'Finalised' : s.cached?.rejected ? 'Rejected' : 'Pending'}
          </div>
        </div>
      </div>

      <div className="stack-5">
        <AuctionLifecyclePanel
          status={s}
          allocation={allocQ.data?.allocation}
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
              <dd className="mono">{s.auctionId}</dd>
              <dt>ISIN</dt>
              <dd className="mono">{s.isin}</dd>
              <dt>Type</dt>
              <dd>
                <TypeBadge type={meta.auctionType} />
              </dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={s.status} />
              </dd>
              <dt>Owner</dt>
              <dd className="mono">{meta.owner}</dd>
              <dt>Bond contract</dt>
              <dd className="mono">{meta.bond}</dd>
              <dt>Offering</dt>
              <dd className="mono">{Fmt.formatUnits(meta.offering)} units</dd>
              <dt>End</dt>
              <dd>{Fmt.formatUnixDate(meta.end)}</dd>
              <dt>Auction public key</dt>
              <dd className="mono">{Fmt.shortHex(meta.auctionPubKey, 12, 8)}</dd>
            </dl>
          </div>
        </div>

        <BidsCard bidsQ={bidsQ} />
        <AllocationCard allocQ={allocQ} status={s.status} />
      </div>
    </div>
  );
}

function BidsCard({ bidsQ }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Bids</h3>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {bidsQ.data ? `${bidsQ.data.bidCount} ${bidsQ.data.state}` : ''}
        </span>
      </div>
      <div className="card-body flush">
        {bidsQ.loading && <LoadingState />}
        {bidsQ.error && <ErrorState error={bidsQ.error} onRetry={bidsQ.reload} />}
        {!bidsQ.loading &&
          !bidsQ.error &&
          (bidsQ.data.bids.length === 0 ? (
            <EmptyState title="No bids yet" />
          ) : bidsQ.data.state === 'sealed' ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bidder</th>
                  <th>Ciphertext</th>
                  <th>Plaintext hash</th>
                </tr>
              </thead>
              <tbody>
                {bidsQ.data.bids.map((b, i) => (
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
                {bidsQ.data.bids.map((b, i) => (
                  <tr key={i}>
                    <td className="mono">{b.bidder}</td>
                    <td className="num mono">{Fmt.bpsToPct(b.rate)}</td>
                    <td className="num mono">{Fmt.formatUnits(b.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  );
}

function AllocationCard({ allocQ, status }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Allocation</h3>
        {allocQ.data?.allocation && (
          <span className="muted mono" style={{ fontSize: 12 }}>
            Clearing rate {Fmt.bpsToPct(allocQ.data.allocation.clearingRate)}
          </span>
        )}
      </div>
      <div className="card-body flush">
        {allocQ.loading && <LoadingState />}
        {allocQ.error && <ErrorState error={allocQ.error} onRetry={allocQ.reload} />}
        {!allocQ.loading &&
          !allocQ.error &&
          (!allocQ.data?.allocation || status === 'open' ? (
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
                {allocQ.data.allocation.allocations.map((a, i) => (
                  <tr key={i}>
                    <td className="mono">{a.bidder}</td>
                    <td className="num mono">{Fmt.formatUnits(a.units)}</td>
                    <td className="num mono">{Fmt.bpsToPct(a.rate)}</td>
                    <td className="num">{Fmt.formatNok(a.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  );
}
