import { createShutdownHandler } from '../src/shutdown';

function fakeServer() {
  return { close: jest.fn(), closeAllConnections: jest.fn() };
}

describe('createShutdownHandler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the server, waits for ingestion to settle, then exits 0', async () => {
    const server = fakeServer();
    let settle: () => void = () => undefined;
    const stopIngestion = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const exit = jest.fn();

    const shutdown = createShutdownHandler({ server, stopIngestion, exit });
    const done = shutdown('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(stopIngestion).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    settle();
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 0 after the timeout when ingestion does not settle', async () => {
    jest.useFakeTimers();
    const exit = jest.fn();
    const shutdown = createShutdownHandler({
      server: fakeServer(),
      stopIngestion: () => new Promise<void>(() => undefined),
      exit,
      timeoutMs: 5_000,
    });

    const done = shutdown('SIGTERM');
    await jest.advanceTimersByTimeAsync(5_000);
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 at once on a second signal', async () => {
    const exit = jest.fn();
    const shutdown = createShutdownHandler({
      server: fakeServer(),
      stopIngestion: () => new Promise<void>(() => undefined),
      exit,
      timeoutMs: 60_000,
    });

    void shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
