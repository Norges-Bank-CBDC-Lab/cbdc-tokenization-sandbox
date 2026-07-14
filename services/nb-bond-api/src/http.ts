/**
 * HTTP response helpers: md5, ETag/304, RFC 7807 problem+json.
 *
 * Used by every handler to keep responses uniform. See
 * docs/plans/archive/openapi-v2-plan.md §3.5–§3.6.
 */
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { DependencyUnavailableError, MutationAcceptedError } from './application-errors';
import type { ProblemDetails } from './schemas';

const DEPENDENCY_UNAVAILABLE_DETAIL = 'Required chain state is temporarily unavailable.';

/**
 * Canonical-JSON serializer: sorts object keys recursively so a DTO
 * always serializes the same way regardless of property-set order.
 * This makes md5 stable across runs and across servers.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/** Server-side md5 of a DTO. Clients treat as an opaque cache key. */
export function computeMd5(value: unknown): string {
  return createHash('md5').update(canonicalize(value)).digest('hex');
}

/**
 * Stamps `md5` onto a DTO by computing the hash over everything except
 * `md5` itself. Useful for nested DTOs so each subtree carries its own
 * fingerprint.
 */
export function withMd5<T extends Record<string, unknown>>(dto: T): T & { md5: string } {
  const { md5: _drop, ...rest } = dto as T & { md5?: unknown };
  return { ...(rest as T), md5: computeMd5(rest) };
}

export interface SuccessResponseOptions {
  status?: number;
  cache?: 'revalidate' | 'no-store';
}

/** Emit a JSON success with explicit status and cache semantics. */
export function successResponse(
  req: Request,
  res: Response,
  body: unknown,
  options: SuccessResponseOptions = {},
): void {
  const status = options.status ?? 200;
  const cache = options.cache ?? 'revalidate';

  if (cache === 'no-store') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(body);
    return;
  }

  const etagValue = computeMd5(body);
  const etag = `"${etagValue}"`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');

  const isConditionalRead = status === 200 && ['GET', 'HEAD'].includes(req.method ?? 'GET');
  const ifNoneMatch = req.header('If-None-Match');
  if (isConditionalRead && ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }

  res.status(status).json(body);
}

/** Backwards-compatible 200 + ETag helper used by existing handlers. */
export function okResponse(req: Request, res: Response, body: unknown): void {
  successResponse(req, res, body);
}

/** Build an RFC 7807 ProblemDetails body. */
export function buildProblem(
  req: Request,
  status: number,
  title: string,
  opts: { detail?: string; errors?: { field: string; message: string }[] } = {},
): ProblemDetails {
  return {
    type: 'about:blank',
    title,
    status,
    detail: opts.detail ?? null,
    instance: req.originalUrl ?? null,
    errors: opts.errors ?? null,
  };
}

/** Emit an RFC 7807 ProblemDetails response. */
export function problem(
  req: Request,
  res: Response,
  status: number,
  title: string,
  opts: { detail?: string; errors?: { field: string; message: string }[] } = {},
): void {
  res.status(status).json(buildProblem(req, status, title, opts));
}

/**
 * Error class handlers throw to signal an HTTP-mapped failure. The
 * Express error middleware translates these into ProblemDetails.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly title: string;
  public readonly detail?: string;
  public readonly errors?: { field: string; message: string }[];

  constructor(
    status: number,
    title: string,
    opts: { detail?: string; errors?: { field: string; message: string }[] } = {},
  ) {
    super(opts.detail ?? title);
    this.status = status;
    this.title = title;
    this.detail = opts.detail;
    this.errors = opts.errors;
  }
}

export const badRequest = (detail?: string, errors?: { field: string; message: string }[]) =>
  new HttpError(400, 'Bad Request', { detail, errors });
export const unauthorized = (detail?: string) => new HttpError(401, 'Unauthorized', { detail });
export const notFound = (detail?: string) => new HttpError(404, 'Not Found', { detail });
export const conflict = (detail?: string) => new HttpError(409, 'Conflict', { detail });
export const serviceUnavailable = (detail = DEPENDENCY_UNAVAILABLE_DETAIL) =>
  new HttpError(503, 'Service Unavailable', { detail });
export const internalError = (detail?: string) =>
  new HttpError(500, 'Internal Server Error', { detail });

/** Express error middleware: maps thrown errors → ProblemDetails. */
export function problemErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof MutationAcceptedError) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json({
      status: 'accepted',
      projectionPending: true,
      transaction: {
        hash: err.transactionHash,
        block: err.blockNumber,
      },
      resource: err.resource,
    });
    return;
  }
  if (err instanceof HttpError) {
    res
      .status(err.status)
      .json(buildProblem(req, err.status, err.title, { detail: err.detail, errors: err.errors }));
    return;
  }
  if (err instanceof DependencyUnavailableError) {
    res.status(503).json(
      buildProblem(req, 503, 'Service Unavailable', {
        detail: DEPENDENCY_UNAVAILABLE_DETAIL,
      }),
    );
    return;
  }
  const detail = err instanceof Error ? err.message : String(err);
  res.status(500).json(buildProblem(req, 500, 'Internal Server Error', { detail }));
}
