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

export type MutationResource = {
  type: 'bond' | 'auction';
  id: string;
};

/**
 * A mutation committed on-chain, but its resource projection did not catch up
 * within the bounded response wait. This is a successful asynchronous outcome,
 * represented as HTTP 202 rather than an error or a stale resource body.
 */
export class MutationAcceptedError extends Error {
  readonly transactionHash: string;
  readonly blockNumber: number | null;
  readonly resource: MutationResource;

  constructor(input: {
    transactionHash: string;
    blockNumber: number | null;
    resource: MutationResource;
  }) {
    super(`transaction accepted; ${input.resource.type} projection is still catching up`);
    this.name = 'MutationAcceptedError';
    this.transactionHash = input.transactionHash;
    this.blockNumber = input.blockNumber;
    this.resource = input.resource;
  }
}
