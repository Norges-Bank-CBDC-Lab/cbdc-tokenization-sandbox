/**
 * BondsPage — list of all bonds with filter + "New bond" action.
 */
import { useState, useMemo } from 'react';
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
import { CreateBondModal } from './CreateBondModal.jsx';

const SHOW_DISABLED_KEY = 'nb-ui:bonds:showDisabled';

function readShowDisabled() {
  try {
    const raw = window.localStorage.getItem(SHOW_DISABLED_KEY);
    if (raw == null) return false; // default: hide disabled
    return raw === 'true';
  } catch {
    return false;
  }
}

function writeShowDisabled(value) {
  try {
    window.localStorage.setItem(SHOW_DISABLED_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore — non-essential preference */
  }
}

export function BondsPage({ navigate }) {
  // Default OFF: disabled bonds are clutter when looking at active state.
  // Setting persists across reloads, mirrors the "Hide cancelled" pattern
  // on AuctionsPage (PR #117).
  const [showDisabled, setShowDisabled] = useState(() => readShowDisabled());
  const { data, loading, error, reload } = useApi(
    () => BondsApi.listBonds({ includeDisabled: showDisabled }),
    [showDisabled],
  );
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const toast = useToast();

  const bonds = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return bonds.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (ql && !b.isin.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [bonds, q, statusFilter]);

  const counts = useMemo(() => {
    const acc = { total: bonds.length, minting: 0, maturing: 0, matured: 0 };
    bonds.forEach((b) => {
      if (acc[b.status] != null) acc[b.status]++;
    });
    return acc;
  }, [bonds]);

  function handleCreated(bond) {
    setShowCreate(false);
    toast.push({
      kind: 'ok',
      title: 'Bond created',
      body: `${bond.isin} pre-staged. Schedule its first auction from the detail page.`,
    });
    // Decoupled flow (D2): land the operator on the new bond's detail
    // page so they can schedule the first auction in the next step.
    navigate(`/bonds/${bond.isin}`);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Registry</div>
          <h1>Bonds</h1>
          <div className="subtitle">Government bonds issued through the auction service.</div>
        </div>
        <div className="actions">
          <Button onClick={reload} variant="ghost">
            Refresh
          </Button>
          <Button onClick={() => setShowCreate(true)} variant="primary">
            + New bond
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total bonds</div>
          <div className="kpi-value">{counts.total}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Minting</div>
          <div className="kpi-value">{counts.minting}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Maturing</div>
          <div className="kpi-value">{counts.maturing}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Matured</div>
          <div className="kpi-value">{counts.matured}</div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="input search"
          placeholder="Filter by ISIN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="minting">Minting</option>
          <option value="maturing">Maturing</option>
          <option value="matured">Matured</option>
          <option value="redeemed">Redeemed</option>
        </select>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--ink-2, #4b5563)',
            cursor: 'pointer',
          }}
          title={
            'Disabled bonds remain in the chain log; hiding keeps the working list focused on ' +
            'active state. Setting persists across page reloads.'
          }
        >
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => {
              const next = e.target.checked;
              setShowDisabled(next);
              writeShowDisabled(next);
            }}
          />
          Show disabled
        </label>
        <span className="count">
          {filtered.length} of {bonds.length}
        </span>
      </div>

      <div className="card flush-top">
        {loading && <LoadingState label="Loading bonds…" />}
        {!loading && error && <ErrorState error={error} onRetry={reload} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            title="No bonds match"
            message={
              bonds.length === 0
                ? 'Create your first bond to get started.'
                : 'Adjust the filters above.'
            }
            action={
              bonds.length === 0 && (
                <Button onClick={() => setShowCreate(true)} variant="primary">
                  + New bond
                </Button>
              )
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>ISIN</th>
                <th>Status</th>
                <th className="num">Coupon yield</th>
                <th className="num">Maturity</th>
                <th className="num">Total supply</th>
                <th className="num">Coupons paid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.isin}
                  className={`clickable ${b.disabled ? 'row-muted' : ''}`}
                  onClick={() => navigate(`/bonds/${b.isin}`)}
                >
                  <td className="mono">{b.isin}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <StatusBadge status={b.status} />
                      {b.disabled && <span className="badge badge-disabled no-dot">DISABLED</span>}
                    </span>
                  </td>
                  <td className="num mono">{Fmt.bpsToPct(b.coupon?.rateBps)}</td>
                  <td className="num">{Fmt.formatUnixDate(b.maturity?.date)}</td>
                  <td className="num mono">{Fmt.formatUnits(b.totalSupply)}</td>
                  <td className="num mono">
                    {b.coupon?.payments?.made ?? '0'} / {b.coupon?.payments?.total ?? '—'}
                  </td>
                  <td className="right">
                    <a
                      href={`#/bonds/${b.isin}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/bonds/${b.isin}`);
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

      {showCreate && (
        <CreateBondModal
          existingIsins={bonds.map((b) => b.isin)}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
