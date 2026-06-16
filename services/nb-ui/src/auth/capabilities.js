/**
 * Capability policy — maps the signed-in account's App Roles to what the UI
 * may show. Single source of truth for "who can see Central Bank".
 *
 * In `none` mode (the local sandbox default) the UI is fully open: there are
 * no roles and no gating, matching the unauthenticated backend. Gating only
 * applies in `entra` mode.
 *
 * Role-value strings come from runtime config (AUTH_OPERATOR_ROLES /
 * AUTH_TESTER_ROLES) so they are never baked into the bundle — see
 * services/nb-ui/DEVELOPMENT.md "Pluggable auth".
 */
import { AppConfig } from '../config.js';

function parseRoleList(value) {
  return (value || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

const operatorRoles = parseRoleList(AppConfig.AUTH_OPERATOR_ROLES);
const testerRoles = parseRoleList(AppConfig.AUTH_TESTER_ROLES);

const FULL_ACCESS = { canUseApp: true, canAccessCentralBank: true };
const NO_ACCESS = { canUseApp: false, canAccessCentralBank: false };

/**
 * Derive capability flags for an account.
 *
 * @param {{ roles?: string[] } | null} account
 * @returns {{ canUseApp: boolean, canAccessCentralBank: boolean }}
 */
export function capabilitiesForAccount(account) {
  // Non-interactive auth (local sandbox) is fully open.
  if ((AppConfig.AUTH_MODE || 'none') !== 'entra') return FULL_ACCESS;
  const roles = account?.roles ?? [];
  if (roles.length === 0) return NO_ACCESS;
  const isOperator = roles.some((r) => operatorRoles.includes(r));
  const isTester = roles.some((r) => testerRoles.includes(r));
  return {
    canUseApp: isOperator || isTester,
    canAccessCentralBank: isOperator,
  };
}
