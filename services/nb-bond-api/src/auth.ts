/**
 * Authentication middleware.
 *
 * Two modes selected by NB_BOND_API_AUTH_MODE:
 *   - `none` (default): accepts and ignores the Authorization header.
 *   - `entra`: validates the bearer token as a JWT issued by Microsoft
 *     Entra ID. Signature verified against the tenant's JWKS, `aud` and
 *     `iss` claims checked.
 *
 * Frontend (nb-ui) configures the matching AUTH_MODE; ArgoCD keeps the
 * two in sync. See docs/plans/archive/openapi-v2-plan.md §3.7.
 */
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { envVariables } from './env-vars';
import { buildProblem } from './http';
import { logger } from './logger';

type EntraConfig = {
  tenantId: string;
  audience: string;
  issuer: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
};

function buildEntraConfig(): EntraConfig {
  const tenantId = envVariables.NB_BOND_API_AUTH_ENTRA_TENANT_ID!;
  const audience = envVariables.NB_BOND_API_AUTH_ENTRA_AUDIENCE!;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwksUrl = new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);
  const jwks = createRemoteJWKSet(jwksUrl);
  return { tenantId, audience, issuer, jwks };
}

const entraConfig: EntraConfig | null =
  envVariables.NB_BOND_API_AUTH_MODE === 'entra' ? buildEntraConfig() : null;

logger.info(`auth mode: ${envVariables.NB_BOND_API_AUTH_MODE}`);

/**
 * Extracts the bearer token from the Authorization header, or null.
 *
 * Prefix-checks "Bearer " case-insensitively without a regex so a
 * crafted header like "Bearer " + many whitespace chars can't trigger
 * polynomial backtracking (CodeQL js/polynomial-redos).
 */
function extractBearer(req: Request): string | null {
  const header = req.header('Authorization');
  if (!header) return null;
  const prefix = header.slice(0, 7);
  if (prefix.toLowerCase() !== 'bearer ') return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Express middleware. In `none` mode this is a no-op. In `entra` mode it
 * rejects requests with a missing or invalid token.
 *
 * Routes wishing to opt out (e.g. /v1/health) should be mounted before
 * this middleware in the express pipeline.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!entraConfig) {
    next();
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    res.status(401).json(
      buildProblem(req, 401, 'Unauthorized', {
        detail: 'Missing Authorization: Bearer <token>',
      }),
    );
    return;
  }

  try {
    await jwtVerify(token, entraConfig.jwks, {
      issuer: entraConfig.issuer,
      audience: entraConfig.audience,
    });
    next();
  } catch (err) {
    res.status(401).json(
      buildProblem(req, 401, 'Unauthorized', {
        detail: `Invalid token: ${(err as Error).message}`,
      }),
    );
  }
}
