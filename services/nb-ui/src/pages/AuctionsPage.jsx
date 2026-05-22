/**
 * AuctionsPage — list of all auctions across bonds.
 */
import { useState, useMemo } from 'react';
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

const HIDE_CANCELLED_KEY = 'nb-ui:auctions:hideCancelled';

function readHideCancelled() {
  try {
    const raw = window.localStorage.getItem(HIDE_CANCELLED_KEY);
    if (raw == null) return true; // default: hide
    return raw === 'true';
  } catch {
    return true;
  }
}

function writeHideCancelled(value) {
  try {
    window.localStorage.setItem(HIDE_CANCELLED_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore — non-essential preference */
  }
}

export function AuctionsPage({ navigate }) {
  const { data, loading, error, reload } = useApi(() => AuctionsApi.listAuctions(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  // Default ON: cancelled auctions are clutter when an operator is
  // looking at active state. Setting persists across reloads.
  const [hideCancelled, setHideCancelled] = useState(() => readHideCancelled());
  const toast = useToast();

  const auctions = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return auctions.filter((a) => {
      if (hideCancelled && a.status === 'cancelled' && statusFilter !== 'cancelled') return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (ql && !(a.isin.toLowerCase().includes(ql) || a.id.toLowerCase().includes(ql)))
        return false;
      return true;
    });
  }, [auctions, q, statusFilter, typeFilter, hideCancelled]);

  const counts = useMemo(() => {
    const acc = { total: auctions.length, open: 0, closed: 0, finalised: 0 };
    auctions.forEach((a) => {
      if (acc[a.status] != null) acc[a.status]++;
    });
    return acc;
  }, [auctions]);

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
    // just missed a tick. See BondsPage handleCreated for details.
    reload();
    setTimeout(reload, 4000);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Auction service</div>
          <h1>Auctions</h1>
          <div className="subtitle">
            Sealed-bid auctions for issuing and buying back government bonds.
          </div>
        </div>
        <div className="actions">
          <Button variant="ghost" onClick={reload}>
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New auction
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total auctions</div>
          <div className="kpi-value">{counts.total}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Open</div>
          <div className="kpi-value">{counts.open}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Closed</div>
          <div className="kpi-value">{counts.closed}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Finalised</div>
          <div className="kpi-value">{counts.finalised}</div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="input search"
          placeholder="Filter by ISIN or auction ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="finalised">Finalised</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="RATE">RATE</option>
          <option value="PRICE">PRICE</option>
          <option value="BUYBACK">BUYBACK</option>
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
            'Cancelled auctions remain in the chain log; hiding keeps the working list focused ' +
            'on active state. Setting persists across page reloads.'
          }
        >
          <input
            type="checkbox"
            checked={hideCancelled}
            onChange={(e) => {
              const next = e.target.checked;
              setHideCancelled(next);
              writeHideCancelled(next);
            }}
          />
          Hide cancelled
        </label>
        <span className="count">
          {filtered.length} of {auctions.length}
        </span>
      </div>

      <div className="card flush-top">
        {loading && <LoadingState label="Loading auctions…" />}
        {!loading && error && <ErrorState error={error} onRetry={reload} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            title="No auctions match"
            message={
              auctions.length === 0 ? 'Run an auction to get started.' : 'Adjust the filters above.'
            }
            action={
              auctions.length === 0 && (
                <Button onClick={() => setShowCreate(true)} variant="primary">
                  + New auction
                </Button>
              )
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Auction ID</th>
                <th>ISIN</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Size (units)</th>
                <th
                  className="num"
                  title="Number of bids submitted on this auction. Sealed while the auction is open; revealed at close."
                >
                  Bids
                </th>
                <th className="num">Ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => navigate(`/auctions/${a.id}`)}>
                  <td className="mono">{Fmt.shortHex(a.id, 8, 6)}</td>
                  <td className="mono">
                    <a
                      href={`#/bonds/${a.isin}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        navigate(`/bonds/${a.isin}`);
                      }}
                    >
                      {a.isin}
                    </a>
                  </td>
                  <td>
                    <TypeBadge type={a.type} />
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="num mono">{Fmt.formatUnits(a.size)}</td>
                  <td className="num mono">{a.bids?.length ?? 0}</td>
                  <td className="num">
                    <div>{Fmt.formatUnixDate(a.end)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {Fmt.formatRelative(a.end)}
                    </div>
                  </td>
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

      {showCreate && (
        <CreateAuctionModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
