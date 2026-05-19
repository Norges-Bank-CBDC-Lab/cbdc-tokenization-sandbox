/**
 * httpClient — the single fetch surface.
 *
 * Every API call goes through here. Auth headers are pulled from the
 * configured AuthProvider per request, so flipping AUTH_MODE at runtime
 * (via /config.js) immediately changes the wire behaviour without any
 * caller-side change.
 */
import { AppConfig } from '../config.js';
import { auth } from '../auth/index.js';

export class HttpError extends Error {
  constructor(status, statusText, body) {
    super(`HTTP ${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.status = 501;
    this.name = 'NotImplementedError';
  }
}

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

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(await authHeaders()),
  };

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new HttpError(res.status, res.statusText, data);
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const HttpClient = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  HttpError,
  NotImplementedError,
};
