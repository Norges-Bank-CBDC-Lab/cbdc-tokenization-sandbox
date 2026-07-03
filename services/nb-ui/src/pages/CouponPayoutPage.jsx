/**
 * CouponPayoutPage — operator surface for paying bond coupons.
 *
 * Lists every issued bond (supply > 0, not disabled, has a coupon
 * schedule) with its payout progress: previous payout (= issuance date
 * until the first coupon lands), next payout due, payments made/total,
 * and maturity. The per-row "Pay coupon" action is enabled purely from
 * the server-computed `coupon.payable` flag — the sandbox chain only
 * mints blocks on transactions, so the chain clock lags wall clock and
 * the UI must never re-derive eligibility from Date.now().
 *
 * Payment fires POST /v1/bonds/{isin}/coupon-payments (all active
 * holders) after a confirmation modal showing the per-holder amounts.
 */
import { useMemo, useState } from 'react';
import { BondsApi } from '../api/bondsApi.js';
import { useApi } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  useToast,
} from '../components/ui.jsx';
import { PayCouponModal } from './PayCouponModal.jsx';

function payButtonTitle(coupon) {
  if (coupon.payable) return 'Pay this coupon to all current holders';
  if (coupon.nextPaymentDue == null || Number(coupon.payments?.remaining ?? 0) === 0) {
    return 'All coupons paid';
  }
  return `Not due yet — next payout ${Fmt.formatUnixDate(coupon.nextPaymentDue)}`;
}

export function CouponPayoutPage({ navigate }) {
  const { data, loading, error, reload } = useApi(() => BondsApi.listBonds(), []);
  const [payTarget, setPayTarget] = useState(null);
  const toast = useToast();

  // Only bonds that can ever receive a coupon: issued supply, not
  // soft-deleted, and carrying an on-chain coupon schedule.
  const bonds = useMemo(
    () =>
      (data ?? []).filter((b) => Number(b.totalSupply ?? 0) > 0 && !b.disabled && b.coupon != null),
    [data],
  );

  const kpis = useMemo(() => {
    const dueNow = bonds.filter((b) => b.coupon.payable).length;
    const outstanding = bonds.reduce(
      (sum, b) => sum + Number(b.coupon.payments?.remaining ?? 0),
      0,
    );
    const dueTimes = bonds
      .map((b) => b.coupon.nextPaymentDue)
      .filter((t) => t != null)
      .map(Number);
    const nextDue = dueTimes.length > 0 ? String(Math.min(...dueTimes)) : null;
    return { dueNow, outstanding, nextDue };
  }, [bonds]);

  function handlePaid(updatedBond) {
    setPayTarget(null);
    toast.push({
      kind: 'ok',
      title: 'Coupon paid',
      body: `${updatedBond?.isin ?? ''} — cash leg settled to all holders`,
    });
    // First reload races the backend ingestion loop (default 3s tick);
    // the delayed second reload covers the worst case where the
    // immediate one just missed a tick. See BondsPage handleCreated.
    reload();
    setTimeout(reload, 4000);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Operator</div>
          <h1>Coupon payout</h1>
          <div className="subtitle">
            Pay the periodic coupon on issued bonds. The cash leg settles from the government
            reserve to every holder, proportional to their balance.
          </div>
        </div>
        <div className="actions">
          <Button variant="ghost" onClick={reload}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Due now</div>
          <div className="kpi-value">{kpis.dueNow}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Coupons outstanding</div>
          <div className="kpi-value">{kpis.outstanding}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Next payout due</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {kpis.nextDue != null ? Fmt.formatUnixDate(kpis.nextDue) : '—'}
          </div>
          {kpis.nextDue != null && (
            <div className="kpi-sub">{Fmt.formatRelative(kpis.nextDue)}</div>
          )}
        </div>
      </div>

      <div className="card flush-top">
        {loading && <LoadingState label="Loading bonds…" />}
        {!loading && error && <ErrorState error={error} onRetry={reload} />}
        {!loading && !error && bonds.length === 0 && (
          <EmptyState
            title="No issued bonds with a coupon schedule"
            message="Bonds appear here once an auction has been finalised and supply is minted."
          />
        )}
        {!loading && !error && bonds.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>ISIN</th>
                <th>Status</th>
                <th className="num">Coupon rate</th>
                <th
                  className="num"
                  title="Coupon payments made vs the total the schedule expects (maturity / coupon interval)."
                >
                  Payments
                </th>
                <th
                  className="num"
                  title="Until the first coupon lands, this is the issuance date."
                >
                  Previous payout
                </th>
                <th className="num">Next payout</th>
                <th className="num">Maturity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bonds.map((b) => {
                const c = b.coupon;
                const madeCount = Number(c.payments?.made ?? 0);
                return (
                  <tr key={b.isin}>
                    <td className="mono">
                      <a
                        href={`#/bonds/${b.isin}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/bonds/${b.isin}`);
                        }}
                      >
                        {b.isin}
                      </a>
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="num mono">{Fmt.bpsToPct(c.rateBps)}</td>
                    <td className="num mono">
                      {c.payments?.made ?? '—'}/{c.payments?.total ?? '—'}
                    </td>
                    <td className="num">
                      {madeCount === 0 ? (
                        <span className="muted">Issued {Fmt.formatUnixDate(c.lastPaymentAt)}</span>
                      ) : (
                        Fmt.formatUnixDate(c.lastPaymentAt)
                      )}
                    </td>
                    <td className="num">
                      {c.nextPaymentDue != null ? (
                        <>
                          <div>{Fmt.formatUnixDate(c.nextPaymentDue)}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {Fmt.formatRelative(c.nextPaymentDue)}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{Fmt.formatUnixDate(b.maturity?.date)}</td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!c.payable}
                        title={payButtonTitle(c)}
                        onClick={() => setPayTarget(b)}
                      >
                        Pay coupon
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {payTarget && (
        <PayCouponModal bond={payTarget} onClose={() => setPayTarget(null)} onPaid={handlePaid} />
      )}
    </div>
  );
}
