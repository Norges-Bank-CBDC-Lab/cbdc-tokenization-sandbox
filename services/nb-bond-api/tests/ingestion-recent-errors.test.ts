import {
  __pushIngestionErrorForTests,
  __resetIngestionStateForTests,
  getIngestionStatus,
} from '../src/ingestion';

describe('recent-errors ring buffer', () => {
  beforeEach(() => {
    __resetIngestionStateForTests();
  });

  it('keeps the most recent 10 errors in newest-first order', () => {
    for (let i = 0; i < 15; i++) {
      __pushIngestionErrorForTests(new Error(`boom ${i}`));
    }
    const { recentErrors } = getIngestionStatus();
    expect(recentErrors).toHaveLength(10);
    // Newest first: the last we pushed (boom 14) is at index 0.
    expect(recentErrors[0].message).toBe('boom 14');
    expect(recentErrors[9].message).toBe('boom 5');
  });

  it('records ts + message + code from ethers-style errors', () => {
    const err = Object.assign(new Error('rpc timeout'), { code: 'TIMEOUT' });
    __pushIngestionErrorForTests(err);
    const [entry] = getIngestionStatus().recentErrors;
    expect(entry.message).toBe('rpc timeout');
    expect(entry.code).toBe('TIMEOUT');
    expect(typeof entry.ts).toBe('number');
  });

  it('falls back to err.name when err.code is missing', () => {
    class MyCustomError extends Error {}
    __pushIngestionErrorForTests(new MyCustomError('boom'));
    expect(getIngestionStatus().recentErrors[0].code).toBe('Error');
    // ^ `name` defaults to 'Error' on subclassed Error without explicit name.
  });

  it('handles non-Error throws (strings, plain objects)', () => {
    __pushIngestionErrorForTests('string thrown');
    __pushIngestionErrorForTests({ message: 'plain object', code: 'POE' });
    const errs = getIngestionStatus().recentErrors;
    expect(errs[1].message).toBe('string thrown');
    expect(errs[1].code).toBe(null);
    expect(errs[0].message).toBe('plain object');
    expect(errs[0].code).toBe('POE');
  });
});
