/**
 * Capability policy — maps the signed-in account's App Roles to what the UI
 * may show. Single source of truth for "who can see Central Bank" and "who
 * can operate" (operator-only controls such as the test-mode toggle).
 *
 * In `none` mode (the local sandbox default) the UI is fully open: there are
 * no roles and no gating, matching the unauthenticated backend. Gating only
 * applies in `entra` mode. Any other mode is a misconfiguration and gets no
 * access at all.
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

const FULL_ACCESS = {
  canUseApp: true,
  canAccessCentralBank: true,
  canAccessBanking: true,
  canOperate: true,
};
const NO_ACCESS = {
  canUseApp: false,
  canAccessCentralBank: false,
  canAccessBanking: false,
  canOperate: false,
};

/**
 * Derive capability flags for an account.
 *
 * @param {{ roles?: string[] } | null} account
 * @returns {{
 *   canUseApp: boolean,
 *   canAccessCentralBank: boolean,
 *   canAccessBanking: boolean,
 *   canOperate: boolean,
 * }}
 */
export function capabilitiesForAccount(account) {
  const mode = AppConfig.AUTH_MODE || 'none';
  // Non-interactive auth (local sandbox) is fully open.
  if (mode === 'none') return FULL_ACCESS;
  // An unrecognised mode is a configuration error: grant nothing.
  if (mode !== 'entra') return NO_ACCESS;
  const roles = account?.roles ?? [];
  if (roles.length === 0) return NO_ACCESS;
  const isOperator = roles.some((r) => operatorRoles.includes(r));
  const isTester = roles.some((r) => testerRoles.includes(r));
  return {
    canUseApp: isOperator || isTester,
    // Central Bank is an operator-only surface; Banking (TBD) is open to
    // testers so they can exercise bank-money flows end-to-end.
    canAccessCentralBank: isOperator,
    canAccessBanking: isOperator || isTester,
    // Operator-only controls (test mode today). Mirrors the API, which
    // honours operator-only behaviour for operator roles only.
    canOperate: isOperator,
  };
}
