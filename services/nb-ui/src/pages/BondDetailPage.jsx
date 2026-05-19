/**
 * BondDetailPage — single bond + its auctions + holders.
 */
import { useState } from 'react';
import { BondsApi } from '../api/bondsApi.js';
import { AuctionsApi } from '../api/auctionsApi.js';
import { useApi } from '../hooks/useApi.js';
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
import { CreateAuctionModal } from './CreateAuctionModal.jsx';

export function BondDetailPage({ isin, navigate }) {
  const bondQ = useApi(() => BondsApi.getBond(isin), [isin]);
  const auctionsQ = useApi(() => AuctionsApi.listAuctionsForBond(isin), [isin]);
  const holdersQ = useApi(() => BondsApi.getBondHolders(isin), [isin]);
  const [showCreate, setShowCreate] = useState(false);
  const toast = useToast();

  if (bondQ.loading)
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  if (bondQ.error)
    return (
      <div className="card">
        <ErrorState error={bondQ.error} onRetry={bondQ.reload} />
      </div>
    );

  const b = bondQ.data;

  function handleCreated(res) {
    setShowCreate(false);
    toast.push({
      kind: 'ok',
      title: 'Auction created',
      body: `${Fmt.shortHex(res.auctionId)} on ${res.isin}`,
    });
    // First reload races the backend ingestion loop (default 3s tick); the
    // delayed second reload covers the worst case where the immediate one
    // just missed a tick. See BondsPage handleCreated for details.
    auctionsQ.reload();
    setTimeout(auctionsQ.reload, 4000);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">
            <a
              href="#/bonds"
              onClick={(e) => {
                e.preventDefault();
                navigate('/bonds');
              }}
            >
              Bonds
            </a>{' '}
            · {b.isin}
          </div>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 26 }}>{b.isin}</h1>
          <div className="subtitle row" style={{ gap: 12 }}>
            <StatusBadge status={b.status} />
            <span>·</span>
            <span>
              Coupon {Fmt.bpsToPct(b.couponYield)} · matures {Fmt.formatUnixDate(b.maturityDate)}
            </span>
          </div>
        </div>
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => {
              bondQ.reload();
              auctionsQ.reload();
              holdersQ.reload();
            }}
          >
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New auction
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total supply</div>
          <div className="kpi-value mono">{Fmt.formatUnits(b.totalSupply)}</div>
          <div className="kpi-sub">{Fmt.formatNok(b.totalSupply)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Coupon yield</div>
          <div className="kpi-value">{Fmt.bpsToPct(b.couponYield)}</div>
          <div className="kpi-sub">Annualised</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Time to maturity</div>
          <div className="kpi-value">{Fmt.durationToYears(b.timeToMaturity)}</div>
          <div className="kpi-sub">{Fmt.formatRelative(b.maturityDate)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Coupons paid</div>
          <div className="kpi-value">
            {b.couponPaymentsMade ?? '0'} / {b.couponPaymentsTotal ?? '—'}
          </div>
          <div className="kpi-sub">{b.couponPaymentsRemaining ?? '—'} remaining</div>
        </div>
      </div>

      <div className="stack-5">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Bond details</h3>
          </div>
          <div className="card-body">
            <dl className="kv-grid">
              <dt>ISIN</dt>
              <dd className="mono">{b.isin}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={b.status} />
              </dd>
              <dt>Maturity duration</dt>
              <dd>{Fmt.durationToYears(b.maturityDuration)}</dd>
              <dt>Maturity date</dt>
              <dd>{Fmt.formatUnixDate(b.maturityDate)}</dd>
              <dt>Coupon duration</dt>
              <dd>{Fmt.durationToYears(b.couponDuration)}</dd>
              <dt>Coupon yield</dt>
              <dd>{Fmt.bpsToPct(b.couponYield)}</dd>
              <dt>Coupon payments (total)</dt>
              <dd className="mono">{b.couponPaymentsTotal ?? '—'}</dd>
              <dt>Total supply</dt>
              <dd className="mono">
                {Fmt.formatUnits(b.totalSupply)} units · {Fmt.formatNok(b.totalSupply)}
              </dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Auctions for {b.isin}</h3>
            <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>
              + New auction
            </Button>
          </div>
          <div className="card-body flush">
            {auctionsQ.loading && <LoadingState />}
            {auctionsQ.error && <ErrorState error={auctionsQ.error} onRetry={auctionsQ.reload} />}
            {!auctionsQ.loading &&
              !auctionsQ.error &&
              (auctionsQ.data.auctions.length === 0 ? (
                <EmptyState
                  title="No auctions yet"
                  message="Create the first auction for this bond."
                />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Auction ID</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th className="num">Size</th>
                      <th className="num">Ends</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {auctionsQ.data.auctions.map((a) => (
                      <tr
                        key={a.auctionId}
                        className="clickable"
                        onClick={() => navigate(`/auctions/${a.auctionId}`)}
                      >
                        <td className="mono">{Fmt.shortHex(a.auctionId, 8, 6)}</td>
                        <td>
                          <TypeBadge type={a.type} />
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="num mono">{Fmt.formatUnits(a.size)}</td>
                        <td className="num">{Fmt.formatUnixDate(a.end)}</td>
                        <td className="right">
                          <a
                            href={`#/auctions/${a.auctionId}`}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(`/auctions/${a.auctionId}`);
                            }}
                          >
                            View →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Holders</h3>
            <span className="muted mono" style={{ fontSize: 12 }}>
              {holdersQ.data?.holders?.length ?? 0} address
              {(holdersQ.data?.holders?.length ?? 0) === 1 ? '' : 'es'}
            </span>
          </div>
          <div className="card-body flush">
            {holdersQ.loading && <LoadingState />}
            {holdersQ.error && <ErrorState error={holdersQ.error} onRetry={holdersQ.reload} />}
            {!holdersQ.loading &&
              !holdersQ.error &&
              (holdersQ.data.holders.length === 0 ? (
                <EmptyState
                  title="No holders"
                  message="No allocations have been distributed yet."
                />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Holder</th>
                      <th className="num">Balance (units)</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdersQ.data.holders.map((h) => (
                      <tr key={h.holder}>
                        <td className="mono">{h.holder}</td>
                        <td className="num mono">{Fmt.formatUnits(h.balance)}</td>
                        <td className="num">{Fmt.formatNok(h.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateAuctionModal
          defaultIsin={b.isin}
          lockIsin
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
