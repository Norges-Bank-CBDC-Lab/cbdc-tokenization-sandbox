import {
  __resetIngestionStateForTests,
  advanceProjectionTo,
  computeIngestionWindow,
  waitForIngestionBlock,
} from '../src/ingestion';

describe('computeIngestionWindow', () => {
  it('returns null when latest is behind nextBlock (no new chain activity)', () => {
    expect(computeIngestionWindow(76, 75)).toBeNull();
    expect(computeIngestionWindow(1000, 999)).toBeNull();
  });

  it('processes the single-block case when latest === nextBlock', () => {
    // Regression: a previous `if (to === from) return;` skip caused the
    // current head block to be silently dropped. The head must be processed
    // regardless of consensus or empty-block policy.
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

describe('waitForIngestionBlock', () => {
  it('returns once the projection reaches the target block', async () => {
    let currentTime = 0;
    const blocks: Array<number | null> = [null, 41, 42];
    const getStatus = jest.fn(() => {
      const next = blocks.shift();
      return { lastBlockProcessed: next === undefined ? 42 : next };
    });
    const sleepFn = jest.fn(async (ms: number) => {
      currentTime += ms;
    });

    await expect(
      waitForIngestionBlock(42, {
        timeoutMs: 500,
        pollMs: 25,
        getStatus,
        sleepFn,
        now: () => currentTime,
      }),
    ).resolves.toBe(true);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('returns false instead of throwing when the bounded wait expires', async () => {
    let currentTime = 0;
    const sleepFn = jest.fn(async (ms: number) => {
      currentTime += ms;
    });

    await expect(
      waitForIngestionBlock(42, {
        timeoutMs: 100,
        pollMs: 25,
        getStatus: () => ({ lastBlockProcessed: 41 }),
        sleepFn,
        now: () => currentTime,
      }),
    ).resolves.toBe(false);
    expect(currentTime).toBe(100);
  });
});

describe('advanceProjectionTo', () => {
  beforeEach(() => __resetIngestionStateForTests());

  it('delegates to the shared coordinator for the requested block', async () => {
    const advance = jest.fn(async (target?: number) => target === 42);
    await expect(advanceProjectionTo(42, { advance, timeoutMs: 100 })).resolves.toBe(true);
    expect(advance).toHaveBeenCalledWith(42);
  });

  it('returns false when no ingestion coordinator is active', async () => {
    await expect(advanceProjectionTo(42, { advance: null })).resolves.toBe(false);
  });

  it('bounds the caller wait without cancelling queued ingestion', async () => {
    const advance = jest.fn(() => new Promise<boolean>(() => undefined));
    await expect(advanceProjectionTo(42, { advance, timeoutMs: 5 })).resolves.toBe(false);
    expect(advance).toHaveBeenCalledWith(42);
  });
});
