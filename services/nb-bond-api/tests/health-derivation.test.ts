import { computeLag, deriveStatus, sanitiseRpcUrl } from '../src/health';
import type { IngestionStatus } from '../src/ingestion';

function ingestion(overrides: Partial<IngestionStatus> = {}): IngestionStatus {
  return {
    loopRunning: true,
    lastTickAt: Date.now(),
    consecutiveFailures: 0,
    lastBlockProcessed: 100,
    lastEventTxHash: '0xabc',
    pollIntervalMs: 3000,
    recentErrors: [],
    ...overrides,
  };
}

describe('sanitiseRpcUrl', () => {
  it('strips path, query, and credentials', () => {
    expect(sanitiseRpcUrl('http://user:pw@besu.cluster.local:8545/foo?bar=1')).toBe(
      'http://besu.cluster.local:8545',
    );
  });

  it('preserves the protocol + host on a clean url', () => {
    expect(sanitiseRpcUrl('http://besu-rpc.besu:8545')).toBe('http://besu-rpc.besu:8545');
  });

  it('falls back to the literal input on parse failure', () => {
    expect(sanitiseRpcUrl('not a url')).toBe('not a url');
  });
});

describe('computeLag', () => {
  it('returns chain.head - ingestion.lastBlockProcessed', () => {
    expect(computeLag({ chainId: 1, head: 110, headReachable: true }, ingestion())).toBe(10);
  });

  it('returns null when chain.head is null', () => {
    expect(computeLag({ chainId: null, head: null, headReachable: false }, ingestion())).toBeNull();
  });

  it('returns null when lastBlockProcessed is null', () => {
    expect(
      computeLag(
        { chainId: 1, head: 110, headReachable: true },
        ingestion({ lastBlockProcessed: null }),
      ),
    ).toBeNull();
  });
});

describe('deriveStatus', () => {
  const now = 1_700_000_000_000;
  const chainOk = { chainId: 1, head: 100, headReachable: true };

  it('returns ok when chain reachable, loop running, no lag, no failures, fresh tick', () => {
    expect(deriveStatus(chainOk, ingestion({ lastTickAt: now - 1000 }), now)).toBe('ok');
  });

  it('returns down when chain is unreachable', () => {
    expect(
      deriveStatus({ chainId: null, head: null, headReachable: false }, ingestion(), now),
    ).toBe('down');
  });

  it('returns down when loop has never started', () => {
    expect(deriveStatus(chainOk, ingestion({ loopRunning: false }), now)).toBe('down');
  });

  it('returns down when last tick is >60s old', () => {
    expect(deriveStatus(chainOk, ingestion({ lastTickAt: now - 61_000 }), now)).toBe('down');
  });

  it('returns degraded when ingestion is >5 blocks behind chain head', () => {
    expect(
      deriveStatus(
        { chainId: 1, head: 200, headReachable: true },
        ingestion({ lastBlockProcessed: 190, lastTickAt: now - 1000 }),
        now,
      ),
    ).toBe('degraded');
  });

  it('returns degraded on any consecutive failures', () => {
    expect(
      deriveStatus(chainOk, ingestion({ consecutiveFailures: 1, lastTickAt: now - 1000 }), now),
    ).toBe('degraded');
  });

  it('returns degraded when last tick is >30s but <60s old', () => {
    expect(deriveStatus(chainOk, ingestion({ lastTickAt: now - 45_000 }), now)).toBe('degraded');
  });

  it('treats a 5-block lag as ok (boundary)', () => {
    expect(
      deriveStatus(
        { chainId: 1, head: 105, headReachable: true },
        ingestion({ lastBlockProcessed: 100, lastTickAt: now - 1000 }),
        now,
      ),
    ).toBe('ok');
  });

  it('does not coerce a null lastTickAt into degraded/down (pre-first-tick)', () => {
    expect(deriveStatus(chainOk, ingestion({ lastTickAt: null }), now)).toBe('ok');
  });
});
