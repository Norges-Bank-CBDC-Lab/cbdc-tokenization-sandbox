import { RpcUnavailableError } from '../src/chain';
import { startIngestionLoopWithRetry } from '../src/ingestion';

describe('startIngestionLoopWithRetry', () => {
  it('returns immediately when start() succeeds first try', async () => {
    const start = jest.fn().mockResolvedValueOnce(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    await startIngestionLoopWithRetry({ start, sleepFn });
    expect(start).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('retries with exponential backoff until start() succeeds', async () => {
    const start = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await startIngestionLoopWithRetry({
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      factor: 2,
      start,
      sleepFn,
    });

    expect(start).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 100);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 200);
  });

  it('caps backoff at maxDelayMs', async () => {
    const start = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockRejectedValueOnce(new Error('4'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    await startIngestionLoopWithRetry({
      initialDelayMs: 1000,
      maxDelayMs: 3000,
      factor: 2,
      start,
      sleepFn,
    });

    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepFn).toHaveBeenNthCalledWith(3, 3000);
    expect(sleepFn).toHaveBeenNthCalledWith(4, 3000);
  });

  it('still retries when the error is an RpcUnavailableError (the expected boot failure)', async () => {
    const start = jest
      .fn()
      .mockRejectedValueOnce(new RpcUnavailableError('rpc down', 'http://x'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    await startIngestionLoopWithRetry({ start, sleepFn, initialDelayMs: 10 });
    expect(start).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });
});
