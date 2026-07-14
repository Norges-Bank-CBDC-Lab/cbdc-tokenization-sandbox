/**
 * httpClient — fetch surface with ETag cache.
 *
 * Every API call goes through here. GETs are cached by URL path: the
 * client stores the response's ETag and replays it on the next request
 * via `If-None-Match`. A 304 from the server short-circuits to the
 * cached body, so polling is cheap even with bulky-tree responses.
 *
 * Mutations (POST/PUT/PATCH/DELETE) clear the cache — the server
 * returns the updated parent DTO, which the caller can store directly
 * if they wish. Next GET re-primes the cache.
 *
 * Auth headers are pulled from the configured AuthProvider per request
 * (none / entra), so AUTH_MODE swaps at runtime without caller changes.
 */
import { AppConfig } from '../config.js';
import { auth } from '../auth/index.js';
import { createSseParser } from '../sync/liveEventProtocol.js';

/**
 * Format an HttpError message from an RFC 7807 problem+json body so
 * `e.message` shown in toasts and form errors is informative ("subsequent
 * auctions cannot be RATE") instead of generic ("HTTP 400 Bad Request").
 * Callers that need the structured body still get it on `e.body`.
 */
function formatProblemMessage(body, status, statusText) {
  const fallback = `HTTP ${status} ${statusText}`;
  if (!body || typeof body !== 'object') return fallback;
  if (Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
  }
  return body.detail || body.title || fallback;
}

export class HttpError extends Error {
  constructor(status, statusText, body) {
    super(formatProblemMessage(body, status, statusText));
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export function isMutationAccepted(value) {
  return (
    value?.status === 'accepted' &&
    value?.projectionPending === true &&
    typeof value?.transaction?.hash === 'string' &&
    typeof value?.resource?.id === 'string'
  );
}

export function mutationAcceptedMessage(value) {
  const block = value?.transaction?.block;
  return `Transaction committed${block == null ? '' : ` in block ${block}`}; waiting for the read model.`;
}

/** Open and consume one authenticated SSE connection. Resolves when it closes. */
async function streamLiveEvents({ signal, onOpen, onChanged }) {
  const base = AppConfig.API_BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/events`, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      ...(await authHeaders()),
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, res.statusText, text ? safeJson(text) : null);
  }
  const contentType = res.headers?.get?.('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/event-stream')) {
    throw new Error(`Expected text/event-stream, received ${contentType || 'no content type'}`);
  }
  if (!res.body) throw new Error('SSE response has no readable body');

  onOpen();
  const parser = createSseParser(onChanged);
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

// In-memory ETag cache: path → { etag, body }.
// One entry per URL. Cleared on any mutation.
const cache = new Map();

async function authHeaders() {
  const value = await auth.getAuthHeader();
  return value ? { Authorization: value } : {};
}

async function request(method, path, { body, query } = {}) {
  const base = AppConfig.API_BASE_URL.replace(/\/$/, '');
  let url = base + path;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams(query).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }

  const isCacheable = method === 'GET';
  const cacheKey = url;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(await authHeaders()),
  };

  if (isCacheable) {
    const cached = cache.get(cacheKey);
    if (cached) headers['If-None-Match'] = cached.etag;
  }

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url, init);

  if (isCacheable && res.status === 304) {
    const cached = cache.get(cacheKey);
    if (cached) return cached.body;
    // Server said 304 but we have nothing cached — should not happen.
    // Fall through to refetch without the header.
    return request(method, path, { body, query });
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) throw new HttpError(res.status, res.statusText, data);

  if (isCacheable) {
    const etag = res.headers?.get?.('ETag');
    if (etag) cache.set(cacheKey, { etag, body: data });
  } else {
    // Any mutation invalidates the entire GET cache. Subsequent reads
    // will refetch fresh. The mutation response itself is the new
    // truth for the parent resource.
    cache.clear();
  }

  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Manually clear the cache. Useful for "force refresh" buttons. */
export function clearHttpCache() {
  cache.clear();
}

export const HttpClient = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  clearCache: clearHttpCache,
  streamLiveEvents,
  HttpError,
};
