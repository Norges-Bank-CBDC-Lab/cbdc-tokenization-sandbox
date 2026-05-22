/**
 * BondDetailPage — single bond with its auctions + holders.
 *
 * One GET /v1/bonds/{isin} returns the full bond tree. Auctions and
 * holders are sliced from `bond.auctions` and `bond.holders`. No
 * per-feature fetches.
 */
import { useState } from 'react';
import { BondsApi } from '../api/bondsApi.js';
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
  const auctions = b.auctions ?? [];
  const holders = b.holders ?? [];

  function handleCreated(updatedBond) {
    setShowCreate(false);
    const newAuction = updatedBond?.auctions?.[0];
    toast.push({
      kind: 'ok',
      title: 'Auction created',
      body: `${newAuction ? Fmt.shortHex(newAuction.id) : ''} on ${updatedBond.isin}`,
    });
    // First reload races the backend ingestion loop (default 3s tick); the
    // delayed second reload covers the worst case where the immediate one
    // just missed a tick.
    bondQ.reload();
    setTimeout(bondQ.reload, 4000);
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
              Coupon rate {Fmt.bpsToPct(b.coupon?.yieldBps)} · matures{' '}
              {Fmt.formatUnixDate(b.maturity?.date)}
            </span>
          </div>
        </div>
        <div className="actions">
          <Button variant="ghost" onClick={bondQ.reload}>
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
        <div
          className="kpi"
          title={
            'Contractual annual coupon rate fixed at bond creation. ' +
            'Not the same as yield-to-maturity, which would depend on the market price the ' +
            'investor paid — there is no secondary-market pricing in this sandbox, so the two ' +
            'coincide at par issuance.'
          }
        >
          <div className="kpi-label">Coupon rate</div>
          <div className="kpi-value">{Fmt.bpsToPct(b.coupon?.yieldBps)}</div>
          <div className="kpi-sub">Annualised, fixed at issuance</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Time to maturity</div>
          <div className="kpi-value">{Fmt.durationToYears(b.maturity?.remaining)}</div>
          <div className="kpi-sub">{Fmt.formatRelative(b.maturity?.date)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Coupons paid</div>
          <div className="kpi-value">
            {b.coupon?.payments?.made ?? '0'} / {b.coupon?.payments?.total ?? '—'}
          </div>
          <div className="kpi-sub">{b.coupon?.payments?.remaining ?? '—'} remaining</div>
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
              <dt
                title={
                  'Time from bond issuance until principal is redeemed to holders. After ' +
                  'maturity, the bond stops paying coupons and the issuer redeems the units.'
                }
              >
                Maturity duration
              </dt>
              <dd>{Fmt.durationToYears(b.maturity?.duration)}</dd>
              <dt>Maturity date</dt>
              <dd>{Fmt.formatUnixDate(b.maturity?.date)}</dd>
              <dt
                title={
                  'Time between coupon payments. Coupons are paid out periodically until ' +
                  'maturity (or early redemption); the issuer’s next coupon payment is due ' +
                  'one coupon-duration after the previous one.'
                }
              >
                Coupon duration
              </dt>
              <dd>{Fmt.durationToYears(b.coupon?.duration)}</dd>
              <dt
                title={
                  'Contractual annual rate paid per coupon — fixed at issuance. Distinct from ' +
                  'yield-to-maturity, which adjusts for market price; the sandbox has no ' +
                  'secondary-market pricing so the two are equal at par issuance.'
                }
              >
                Coupon rate
              </dt>
              <dd>{Fmt.bpsToPct(b.coupon?.yieldBps)}</dd>
              <dt>Coupon payments (total)</dt>
              <dd className="mono">{b.coupon?.payments?.total ?? '—'}</dd>
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
            {auctions.length === 0 ? (
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
                  {auctions.map((a) => (
                    <tr
                      key={a.id}
                      className="clickable"
                      onClick={() => navigate(`/auctions/${a.id}`)}
                    >
                      <td className="mono">{Fmt.shortHex(a.id, 8, 6)}</td>
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
                          href={`#/auctions/${a.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/auctions/${a.id}`);
                          }}
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Holders</h3>
            <span className="muted mono" style={{ fontSize: 12 }}>
              {holders.length} address{holders.length === 1 ? '' : 'es'}
            </span>
          </div>
          <div className="card-body flush">
            {holders.length === 0 ? (
              <EmptyState title="No holders" message="No allocations have been distributed yet." />
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
                  {holders.map((h) => (
                    <tr key={h.holder}>
                      <td className="mono">{h.holder}</td>
                      <td className="num mono">{Fmt.formatUnits(h.balance)}</td>
                      <td className="num">{Fmt.formatNok(h.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
