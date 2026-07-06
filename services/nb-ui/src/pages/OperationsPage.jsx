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
import { AppConfig } from '../config.js';
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

const MAX_ERROR_CELL = 140;

/**
 * Decoded revert strings can run to hundreds of characters (raw revert
 * bytes included) — render a bounded excerpt so the row never stretches
 * the table outside its card; the full text stays on the hover title.
 */
function truncateError(error) {
  if (error.length <= MAX_ERROR_CELL) return error;
  return `${error.slice(0, MAX_ERROR_CELL)}…`;
}

/**
 * Shortened tx hash, linked to the block explorer's transaction page
 * when EXPLORER_BASE_URL is configured (empty = plain text, no link).
 */
function TxCell({ txHash }) {
  if (!txHash) return '—';
  const short = `${txHash.slice(0, 10)}…`;
  const base = (AppConfig.EXPLORER_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    return (
      <span className="mono" title={txHash}>
        {short}
      </span>
    );
  }
  return (
    <a
      className="mono"
      href={`${base}/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      title={txHash}
    >
      {short}
    </a>
  );
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
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Operation</th>
                    <th>Target</th>
                    <th>Result</th>
                    <th>Tx</th>
                    <th>Status</th>
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
                      <td className="cell-break">
                        {op.error ? (
                          <span title={op.error}>{truncateError(op.error)}</span>
                        ) : (
                          formatDetail(op.detail)
                        )}
                      </td>
                      <td>
                        <TxCell txHash={op.txHash} />
                      </td>
                      <td>
                        <span className={statusBadgeClass(op.status)}>{op.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
