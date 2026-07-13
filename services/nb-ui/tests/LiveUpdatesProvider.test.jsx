import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamLiveEvents, handleUnauthorized } = vi.hoisted(() => ({
  streamLiveEvents: vi.fn(),
  handleUnauthorized: vi.fn(),
}));

vi.mock('../src/api/httpClient.js', () => ({
  HttpClient: { streamLiveEvents },
}));

vi.mock('../src/auth/index.js', () => ({
  auth: {
    subscribe: () => () => {},
    handleUnauthorized,
  },
}));

import { LiveUpdatesProvider, useLiveQuery } from '../src/sync/LiveUpdatesProvider.jsx';

function Query({ resource, fetcher }) {
  useLiveQuery([resource], fetcher, []);
  return null;
}

describe('LiveUpdatesProvider', () => {
  beforeEach(() => {
    streamLiveEvents.mockReset();
    handleUnauthorized.mockReset();
    streamLiveEvents.mockImplementation(() => new Promise(() => {}));
  });

  it('reloads only matching live queries and reconciles all on open', async () => {
    const bondsFetcher = vi.fn().mockResolvedValue([]);
    const operationsFetcher = vi.fn().mockResolvedValue([]);
    const view = render(
      <LiveUpdatesProvider>
        <Query resource="bonds" fetcher={bondsFetcher} />
        <Query resource="operations" fetcher={operationsFetcher} />
      </LiveUpdatesProvider>,
    );

    await waitFor(() => expect(streamLiveEvents).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(bondsFetcher).toHaveBeenCalledOnce();
      expect(operationsFetcher).toHaveBeenCalledOnce();
    });
    const connection = streamLiveEvents.mock.calls[0][0];

    act(() => connection.onChanged(['bonds']));
    await waitFor(() => expect(bondsFetcher).toHaveBeenCalledTimes(2));
    expect(operationsFetcher).toHaveBeenCalledOnce();

    act(() => connection.onOpen());
    await waitFor(() => {
      expect(bondsFetcher).toHaveBeenCalledTimes(3);
      expect(operationsFetcher).toHaveBeenCalledTimes(2);
    });

    view.unmount();
    expect(connection.signal.aborted).toBe(true);
  });

  it('hands a 401 to auth and stops reconnecting', async () => {
    streamLiveEvents.mockRejectedValueOnce({ status: 401 });

    render(
      <LiveUpdatesProvider>
        <div />
      </LiveUpdatesProvider>,
    );

    await waitFor(() => expect(handleUnauthorized).toHaveBeenCalledOnce());
    expect(streamLiveEvents).toHaveBeenCalledOnce();
  });

  it('stops reconnecting after a 403', async () => {
    streamLiveEvents.mockRejectedValueOnce({ status: 403 });

    render(
      <LiveUpdatesProvider>
        <div />
      </LiveUpdatesProvider>,
    );

    await waitFor(() => expect(streamLiveEvents).toHaveBeenCalledOnce());
    expect(handleUnauthorized).not.toHaveBeenCalled();
  });

  it('does not open a stream when live updates are disabled', () => {
    render(
      <LiveUpdatesProvider enabled={false}>
        <div />
      </LiveUpdatesProvider>,
    );

    expect(streamLiveEvents).not.toHaveBeenCalled();
  });
});
