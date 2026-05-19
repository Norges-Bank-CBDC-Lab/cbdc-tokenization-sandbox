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
});
