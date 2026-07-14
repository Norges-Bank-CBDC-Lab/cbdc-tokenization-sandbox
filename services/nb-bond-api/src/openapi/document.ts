import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';

import { auctionPaths } from '../contracts/auctions';
import { bankingPaths } from '../contracts/banking';
import { bidderPaths } from '../contracts/bidders';
import { bondPaths } from '../contracts/bonds';
import { centralBankPaths } from '../contracts/central-bank';
import { healthPaths } from '../contracts/health';
import { liveEventPaths } from '../contracts/live-events';
import { operationPaths } from '../contracts/operations';
import { problemDetailsSchema } from './shared-responses';

const paths: ZodOpenApiPathsObject = {
  ...healthPaths,
  ...liveEventPaths,
  ...bondPaths,
  ...auctionPaths,
  ...bidderPaths,
  ...centralBankPaths,
  ...bankingPaths,
  ...operationPaths,
};

export const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'NB Bond Auction Service',
    version: '1.0.0',
    description:
      'Public API for the CBDC tokenization sandbox bond service. ' +
      'Sandbox-scale demo backing the nb-ui reference frontend. ' +
      'See docs/plans/archive/openapi-v2-plan.md for design notes.',
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  servers: [
    {
      url: 'http://bond-api.cbdc-sandbox.local',
      description: 'Local Kind sandbox',
    },
  ],
  tags: [
    { name: 'system', description: 'Service health' },
    { name: 'bonds', description: 'Bond resources (root of the resource tree)' },
    { name: 'auctions', description: 'Auction resources (bid/allocation subtree of a bond)' },
    {
      name: 'bidders',
      description:
        'Sandbox bidder roster used by the impersonated-bid flow. Private keys are stored ' +
        'in plaintext — sandbox-only, never deploy against real funds.',
    },
    {
      name: 'central-bank',
      description:
        'Central Bank (Norges Bank) operator surface against the WNOK contract: mint, burn, ' +
        'transfer, allowlist add/remove. Operator-only — entra mode requires an operator App ' +
        'Role and returns 403 otherwise. Sandbox-only.',
    },
    {
      name: 'banking',
      description:
        'Commercial-bank tokenized deposits (TBD): one ERC-20 per bank, with supply, WNOK ' +
        'reserve backing, holders, and (mutations) allowlist / mint / burn / transfer. ' +
        'In entra mode, authenticated users with a recognised operator or tester App Role may ' +
        'use this surface. Sandbox-only.',
    },
    {
      name: 'admin',
      description:
        'Operator-only ingestion lifecycle (restart loop, drop-and-rebuild projection). ' +
        'Requires an operator App Role in entra mode (403 otherwise); auth is a no-op in ' +
        'none mode.',
    },
  ],
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Microsoft Entra ID access token. In deployments where NB_BOND_API_AUTH_MODE=none ' +
          '(local sandbox default), the header is accepted but not validated. In entra mode the ' +
          'token must carry a recognised App Role in its `roles` claim (see the 403 response); ' +
          'Central Bank and admin endpoints require an operator role.',
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation failed; `errors[]` populated.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Unauthorized: {
        description: 'Authentication required or token invalid.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Forbidden: {
        description:
          'Authenticated, but the token lacks a role required for this resource (entra mode ' +
          'only). Central Bank and admin endpoints require an operator App Role; banking and ' +
          'other protected endpoints require at least one recognised operator or tester role.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      NotFound: {
        description: 'Resource does not exist.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      Conflict: {
        description: 'Operation conflicts with current resource state.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      InternalError: {
        description:
          'Unexpected sandbox server error. `detail` contains the thrown message to support ' +
          'technology testing and must not be treated as a production-safe disclosure policy.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
      ServiceUnavailable: {
        description: 'Required chain or sandbox service state is temporarily unavailable.',
        content: { 'application/json': { schema: problemDetailsSchema } },
      },
    },
  },
});
