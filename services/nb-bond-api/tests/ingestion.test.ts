import { computeIngestionWindow } from '../src/ingestion';

describe('computeIngestionWindow', () => {
  it('returns null when latest is behind nextBlock (no new chain activity)', () => {
    expect(computeIngestionWindow(76, 75)).toBeNull();
    expect(computeIngestionWindow(1000, 999)).toBeNull();
  });

  it('processes the single-block case when latest === nextBlock', () => {
    // Regression: a previous `if (to === from) return;` skip caused the
    // head block to be silently dropped on Clique PoA, where the chain
    // produces blocks only on activity. The head must be processed.
    expect(computeIngestionWindow(75, 75)).toEqual({ from: 75, to: 75 });
    expect(computeIngestionWindow(0, 0)).toEqual({ from: 0, to: 0 });
  });

  it('processes the full available range when latest is within one batch', () => {
    expect(computeIngestionWindow(0, 74)).toEqual({ from: 0, to: 74 });
    expect(computeIngestionWindow(100, 250)).toEqual({ from: 100, to: 250 });
  });

  it('caps the range at the batch size to avoid huge log queries', () => {
    expect(computeIngestionWindow(0, 10_000)).toEqual({ from: 0, to: 500 });
    expect(computeIngestionWindow(1_000, 2_500)).toEqual({ from: 1_000, to: 1_500 });
  });

  it('honours a caller-supplied batch size', () => {
    expect(computeIngestionWindow(0, 100, 10)).toEqual({ from: 0, to: 10 });
    expect(computeIngestionWindow(50, 60, 5)).toEqual({ from: 50, to: 55 });
  });
});
