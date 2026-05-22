/**
 * NetworkHealthModal — pretty-printed /v1/health view with the two
 * operator-driven recovery actions (Plan C):
 *
 *   - **Reconnect** restarts the in-process ingestion loop without
 *     touching the projection. POST /v1/admin/restart-ingestion.
 *   - **Resync from block 0** drops the projection and rebuilds from
 *     chain. Gated behind ConfirmResyncModal (type-to-confirm).
 *
 * The modal shares the same poll as the HealthBadge via the
 * `useHealthPoll` hook — the parent passes its `health` snapshot and
 * `onReload` callback so the modal can refresh in place after a
 * Reconnect / Resync without spinning up a second timer.
 */
import { useState } from 'react';
import { Button, Modal, useToast } from '../components/ui.jsx';
import { summarise } from '../components/HealthBadge.jsx';
import { HealthApi } from '../api/healthApi.js';
import { ConfirmResyncModal } from './ConfirmResyncModal.jsx';

function formatRelative(ts) {
  if (!ts) return '—';
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', gap: 12 }}>
      <span style={{ color: '#6b7280', fontSize: 13 }}>{label}</span>
      <span
        style={{
          textAlign: 'right',
          fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
          fontSize: 13,
          color: 'var(--ink)',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3
      style={{
        margin: '16px 0 6px',
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#6b7280',
      }}
    >
      {children}
    </h3>
  );
}

const STATUS_COLOR = {
  ok: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
};

export function NetworkHealthModal({ health, onReload, onClose }) {
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  async function reconnect() {
    setReconnecting(true);
    try {
      const result = await HealthApi.restartIngestion();
      if (result?.restarted) {
        toast?.push?.({ kind: 'success', message: 'Ingestion loop restarted' });
      } else {
        toast?.push?.({
          kind: 'info',
          message: 'Restart accepted — loop still coming up. Watching status…',
        });
      }
      await onReload?.();
    } catch (err) {
      toast?.push?.({ kind: 'error', message: `Reconnect failed: ${err.message}` });
    } finally {
      setReconnecting(false);
    }
  }

  async function resyncSubmit() {
    try {
      await HealthApi.restartIngestion({ fromBlock: 0 });
      toast?.push?.({
        kind: 'success',
        message: 'Resync started — projection will rebuild shortly',
      });
      setConfirmOpen(false);
      await onReload?.();
    } catch (err) {
      toast?.push?.({ kind: 'error', message: `Resync failed: ${err.message}` });
      // Keep the confirm modal open so the operator sees the error.
      throw err;
    }
  }

  const status = health?.status ?? 'loading';
  const chain = health?.chain;
  const ingestion = health?.ingestion;
  const recent = ingestion?.recentErrors ?? [];

  return (
    <>
      <Modal
        title="Network Health"
        onClose={onClose}
        maxWidth={640}
        footer={
          <>
            <Button onClick={onReload} disabled={reconnecting}>
              Refresh
            </Button>
            <Button onClick={reconnect} disabled={reconnecting} variant="primary">
              {reconnecting ? 'Reconnecting…' : 'Reconnect'}
            </Button>
            <Button onClick={() => setConfirmOpen(true)} variant="danger" disabled={reconnecting}>
              Resync from block 0…
            </Button>
          </>
        }
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <span
            aria-hidden="true"
            data-testid="status-dot"
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: STATUS_COLOR[status] ?? '#d0d4dc',
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {status}
          </span>
          <span style={{ color: '#6b7280', fontSize: 13 }}>— {summarise(health)}</span>
        </div>

        <SectionTitle>Chain</SectionTitle>
        <Row label="RPC URL" value={chain?.rpcUrl || '—'} mono />
        <Row label="Chain ID" value={chain?.chainId ?? '—'} />
        <Row label="Head block" value={chain?.head ?? '—'} />
        <Row label="Head reachable" value={chain?.headReachable ? '✓ yes' : '✗ no'} />

        <SectionTitle>Ingestion</SectionTitle>
        <Row label="Loop running" value={ingestion?.loopRunning ? '✓ yes' : '✗ no'} />
        <Row label="Last block processed" value={ingestion?.lastBlockProcessed ?? '—'} />
        <Row label="Lag" value={ingestion?.lag ?? '—'} />
        <Row label="Poll interval" value={ingestion ? `${ingestion.pollIntervalMs} ms` : '—'} />
        <Row label="Last tick" value={formatRelative(ingestion?.lastTickAt)} />
        <Row label="Consecutive failures" value={ingestion?.consecutiveFailures ?? '—'} />
        <Row label="Last event tx" value={shortHash(ingestion?.lastEventTxHash)} mono />

        <SectionTitle>Recent errors</SectionTitle>
        {recent.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            No recent ingestion errors recorded.
          </p>
        ) : (
          <table
            style={{
              width: '100%',
              fontSize: 12,
              borderCollapse: 'collapse',
              marginTop: 4,
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border, #d0d4dc)' }}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 6px',
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  When
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 6px',
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Code
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 6px',
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Message
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr
                  key={`${e.ts}-${i}`}
                  style={{ borderBottom: '1px solid var(--border-subtle, #ececec)' }}
                >
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    {formatRelative(e.ts)}
                  </td>
                  <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono, monospace)' }}>
                    {e.code ?? '—'}
                  </td>
                  <td style={{ padding: '4px 6px', wordBreak: 'break-word' }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
      {confirmOpen && (
        <ConfirmResyncModal onCancel={() => setConfirmOpen(false)} onConfirm={resyncSubmit} />
      )}
    </>
  );
}
