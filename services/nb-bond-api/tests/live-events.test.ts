import { LiveEventBroadcaster } from '../src/live-events';

describe('LiveEventBroadcaster', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes one deterministic changed event with no domain data', () => {
    const broadcaster = new LiveEventBroadcaster(15_000);
    const subscriber = jest.fn();
    const unsubscribe = broadcaster.subscribe(subscriber);

    broadcaster.publishChanged(['bonds', 'auctions', 'bonds']);

    expect(subscriber).toHaveBeenCalledWith(
      'event: changed\ndata: {"changed":["auctions","bonds"]}\n\n',
    );
    unsubscribe();
  });

  it('does not emit an event when no resources changed', () => {
    const broadcaster = new LiveEventBroadcaster(15_000);
    const subscriber = jest.fn();
    const unsubscribe = broadcaster.subscribe(subscriber);

    broadcaster.publishChanged([]);

    expect(subscriber).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('starts heartbeats lazily and stops them after unsubscribe', () => {
    jest.useFakeTimers();
    const broadcaster = new LiveEventBroadcaster(1_000);
    const subscriber = jest.fn();

    jest.advanceTimersByTime(1_000);
    expect(subscriber).not.toHaveBeenCalled();

    const unsubscribe = broadcaster.subscribe(subscriber);
    jest.advanceTimersByTime(1_000);
    expect(subscriber).toHaveBeenCalledWith(': heartbeat\n\n');

    unsubscribe();
    subscriber.mockClear();
    jest.advanceTimersByTime(1_000);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('removes a subscriber whose writer throws', () => {
    const broadcaster = new LiveEventBroadcaster(15_000);
    broadcaster.subscribe(() => {
      throw new Error('closed');
    });

    broadcaster.publishChanged(['operations']);

    expect(broadcaster.subscriberCount).toBe(0);
  });
});
