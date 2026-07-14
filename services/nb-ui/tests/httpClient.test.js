import { describe, it, expect, beforeEach, vi } from 'vitest';

// Feature: HttpClient honours the AuthProvider — when getAuthHeader returns a
// value, it lands as Authorization on every request; when it returns null,
// the header is absent. This is the seam that lets the same UI code work
// against the unauth'd sandbox backend AND against an Entra-protected backend.

describe('HttpClient + AuthProvider integration', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.AUTH_MODE = 'none';
    window.__APP_CONFIG__.API_BASE_URL = 'http://test.local';
  });

  it('sends no Authorization header when AUTH_MODE is "none"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"ok":true}',
    });
    globalThis.fetch = fetchSpy;

    const { HttpClient } = await import('../src/api/httpClient.js');
    await HttpClient.get('/v1/health');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the Bearer header returned by the auth provider', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'null',
    });
    globalThis.fetch = fetchSpy;

    // Inject a stub provider via vi.doMock so the resolver wires it instead.
    vi.doMock('../src/auth/index.js', () => ({
      auth: {
        getAuthHeader: async () => 'Bearer test-token-123',
        getAccount: () => null,
        subscribe: () => () => {},
        init: async () => {},
        login: async () => {},
        logout: async () => {},
      },
      authMode: 'entra',
    }));

    const { HttpClient } = await import('../src/api/httpClient.js');
    await HttpClient.get('/v1/bonds');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-token-123');
  });

  it('throws HttpError with status + body for non-2xx responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"error":"missing"}',
    });
    const { HttpClient } = await import('../src/api/httpClient.js');
    await expect(HttpClient.get('/v1/bonds/nope')).rejects.toMatchObject({
      status: 404,
      statusText: 'Not Found',
      body: { error: 'missing' },
    });
  });

  it('accepts and identifies a documented projection-pending mutation', async () => {
    const pending = {
      status: 'accepted',
      projectionPending: true,
      transaction: { hash: '0xabc', block: 42 },
      resource: { type: 'bond', id: 'NO0000000001' },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      text: async () => JSON.stringify(pending),
    });
    const { HttpClient, isMutationAccepted, mutationAcceptedMessage } =
      await import('../src/api/httpClient.js');

    const result = await HttpClient.post('/v1/bonds', {});
    expect(isMutationAccepted(result)).toBe(true);
    expect(mutationAcceptedMessage(result)).toContain('block 42');
  });

  it('streams SSE with a fresh bearer header and parses split frames', async () => {
    const encoder = new TextEncoder();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: encoder.encode(': connected\n\nevent: chan') })
      .mockResolvedValueOnce({
        done: false,
        value: encoder.encode('ged\ndata: {"changed":["bonds","unknown"]}\n\n'),
      })
      .mockResolvedValueOnce({ done: true });
    const releaseLock = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: { getReader: () => ({ read, releaseLock }) },
    });
    vi.doMock('../src/auth/index.js', () => ({
      auth: { getAuthHeader: vi.fn().mockResolvedValue('Bearer stream-token') },
      authMode: 'entra',
    }));

    const { HttpClient } = await import('../src/api/httpClient.js');
    const onOpen = vi.fn();
    const onChanged = vi.fn();
    await HttpClient.streamLiveEvents({
      signal: new AbortController().signal,
      onOpen,
      onChanged,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test.local/v1/events',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', Authorization: 'Bearer stream-token' },
      }),
    );
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledWith(['bonds']);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});

describe('createSseParser', () => {
  it('handles comments, CRLF, multiple data lines, and malformed events', async () => {
    const { createSseParser } = await import('../src/sync/liveEventProtocol.js');
    const onChanged = vi.fn();
    const parser = createSseParser(onChanged);

    parser.push(': heartbeat\r\n\r\nevent: changed\r\ndata: {"changed":\r\n');
    parser.push('data: ["operations","operations"]}\r\n\r\n');
    parser.push('event: changed\n' + 'data: not-json\n\n' + 'event: other\n' + 'data: {}\n\n');

    expect(onChanged).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledWith(['operations']);
  });
});
