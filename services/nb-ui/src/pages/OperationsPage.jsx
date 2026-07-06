/**
 * OperationsPage — the operator audit trail (System → Operations).
 *
 * Every operator-initiated on-chain operation attempted through the NB Bond
 * API is recorded server-side with its outcome — including reverts that never
 * reached the chain (rejected at gas estimation), whose decoded reason exists
 * nowhere else. Newest first. Read-only.
 */
import { useApi } from '../hooks/useApi.js';
import { OperationsApi } from '../api/operationsApi.js';
import { Button, CopyableHex, EmptyState, ErrorState, LoadingState } from '../components/ui.jsx';
import { formatRelative, formatUnixDate } from '../utils/format.js';

const STATUS_BADGE = {
  SUCCEEDED: 'badge-open',
  REVERTED: 'badge-rejected',
  FAILED: 'badge-cancelled',
  PARTIAL: 'badge-closed',
};

function statusBadgeClass(status) {
  return `badge ${STATUS_BADGE[status] ?? 'badge-unknown'} no-dot`;
}

/** "WNOK_ALLOWLIST_ADD" -> "WNOK allowlist add" */
function formatOpType(opType) {
  const [head, ...rest] = String(opType).split('_');
  return [head, ...rest.map((w) => w.toLowerCase())].join(' ');
}

/** Compact one-line summary of the op-specific detail payload. */
function formatDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

function TargetCell({ target }) {
  if (/^0x[a-fA-F0-9]{40}$/.test(target)) {
    return (
      <span className="mono">
        <CopyableHex value={target} />
      </span>
    );
  }
  return <span>{target}</span>;
}

export function OperationsPage() {
  const opsQ = useApi(() => OperationsApi.listOperations(), []);
  const operations = opsQ.data ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Operator</div>
          <h1>Operations</h1>
          <div className="subtitle">
            Audit trail of operator actions submitted on-chain through the NB Bond API — successes
            with their transaction hash, failures with the decoded revert reason. Failed attempts
            are usually rejected before broadcast, so this trail is their only record. Read-only.
          </div>
        </div>
        <div className="actions">
          <Button onClick={opsQ.reload} variant="ghost">
            Refresh
          </Button>
        </div>
      </div>

      <div className="card flush-top">
        <div className="card-body flush">
          {opsQ.loading && <LoadingState label="Loading operations…" />}
          {!opsQ.loading && opsQ.error && <ErrorState error={opsQ.error} onRetry={opsQ.reload} />}
          {!opsQ.loading && !opsQ.error && operations.length === 0 && (
            <EmptyState
              title="No operations recorded yet"
              message="Operator actions (mint, transfer, payout, auction lifecycle …) will appear here as they are attempted."
            />
          )}
          {!opsQ.loading && !opsQ.error && operations.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Operation</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr key={op.id}>
                    <td title={formatUnixDate(op.createdAt)}>{formatRelative(op.createdAt)}</td>
                    <td>{formatOpType(op.opType)}</td>
                    <td>
                      <TargetCell target={op.target} />
                    </td>
                    <td>
                      <span className={statusBadgeClass(op.status)}>{op.status}</span>
                    </td>
                    <td>
                      {op.error ? (
                        <span title={op.error}>{op.error}</span>
                      ) : (
                        formatDetail(op.detail)
                      )}
                    </td>
                    <td className="mono">{op.txHash ? <CopyableHex value={op.txHash} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
