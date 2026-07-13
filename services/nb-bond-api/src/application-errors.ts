/**
 * A required infrastructure read failed. The cause is retained for server-side
 * diagnostics, while the HTTP layer exposes only the stable safe message.
 */
export class DependencyUnavailableError extends Error {
  readonly dependency: string;
  readonly resource: string;
  readonly cause: unknown;

  constructor(dependency: string, resource: string, cause: unknown) {
    super(`required ${dependency} read failed for ${resource}`);
    this.name = 'DependencyUnavailableError';
    this.dependency = dependency;
    this.resource = resource;
    this.cause = cause;
  }
}
