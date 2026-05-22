/**
 * HealthBadge — top-bar live/down indicator that doubles as the entry
 * point to the NetworkHealthModal (Plan C).
 *
 * Renders a coloured pill — green for ok, yellow for degraded, red for
 * down, grey for mock mode — and a `title` tooltip with a concrete
 * reason for the colour. Click opens the modal; the modal owns the
 * Reconnect / Resync affordances and shares the same poll via
 * `useHealthPoll`.
 *
 * In mock mode the badge stays grey ("MOCK API") and skips polling.
 */
import { useState } from 'react';
import { AppConfig } from '../config.js';
import { useHealthPoll } from '../hooks/useHealthPoll.js';
import { NetworkHealthModal } from '../pages/NetworkHealthModal.jsx';

const BORDER_COLOR = {
  ok: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
  mock: '#d0d4dc',
  loading: '#d0d4dc',
};

const LABEL = {
  ok: 'LIVE',
  degraded: 'LIVE',
  down: 'DOWN',
  mock: 'MOCK API',
  loading: 'LIVE',
};

/**
 * Build the badge tooltip from the /v1/health payload. Exported because
 * NetworkHealthModal reuses it for its header summary line.
 */
export function summarise(health, now = Date.now()) {
  if (!health) return 'Loading health…';
  const { status, chain, ingestion } = health;
  if (status === 'ok') {
    return `Network healthy — chain head ${chain.head}, ingestion up to date`;
  }
  if (status === 'degraded') {
    if (!ingestion.loopRunning) return 'On-chain healthy, ingestion loop not running';
    if (ingestion.lag !== null && ingestion.lag > 5) {
      return `On-chain healthy, ingestion ${ingestion.lag} blocks behind`;
    }
    if (ingestion.consecutiveFailures > 0) {
      return 'On-chain healthy, recent ingestion errors';
    }
    const stalled = Math.round((now - (ingestion.lastTickAt ?? now)) / 1000);
    return `On-chain healthy, ingestion poll stalled ${stalled} s`;
  }
  // down
  if (!chain.headReachable) return "Backend can't reach chain";
  if (!ingestion.loopRunning) return 'Ingestion loop not running';
  const stale = Math.round((now - (ingestion.lastTickAt ?? now)) / 1000);
  return `Ingestion stale for ${stale} s`;
}

export function HealthBadge() {
  const isMock = AppConfig.USE_MOCK;
  const { health, reload } = useHealthPoll({ enabled: !isMock });
  const [modalOpen, setModalOpen] = useState(false);

  const tone = isMock ? 'mock' : (health?.status ?? 'loading');
  const tooltip = isMock ? 'Mock API — no real backend connected' : summarise(health);
  const label = LABEL[tone];

  return (
    <>
      <button
        type="button"
        className={`env-pill ${isMock ? 'mock' : ''}`}
        onClick={() => setModalOpen(true)}
        title={tooltip}
        aria-label={`Network status: ${tooltip}`}
        data-status={tone}
        style={{
          background: 'transparent',
          border: `1px solid ${BORDER_COLOR[tone]}`,
          color: '#6b7280',
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </button>
      {modalOpen && (
        <NetworkHealthModal health={health} onReload={reload} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
