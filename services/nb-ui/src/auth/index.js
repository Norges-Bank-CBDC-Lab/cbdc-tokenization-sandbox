/**
 * Auth plugin resolver.
 *
 * The UI imports `auth` from this module and never references a specific
 * implementation. New auth modes (e.g. OAuth2 generic, mTLS) plug in by
 * adding a case here plus a sibling implementation file. The runtime
 * AUTH_MODE comes from window.__APP_CONFIG__.AUTH_MODE.
 */
import { AppConfig } from '../config.js';
import { createNoneAuth } from './noneAuth.js';
import { createEntraAuth } from './entraAuth.js';

/**
 * Provider for an unrecognised AUTH_MODE. Same interface as noneAuth, but it
 * never has an account and sends no Authorization header. App.jsx renders the
 * configuration-error page instead of the app for such a mode, and
 * capabilities.js grants it nothing, so no page mounts and nothing calls the
 * API.
 */
function createMisconfiguredAuth() {
  return createNoneAuth();
}

function resolve() {
  switch (AppConfig.AUTH_MODE) {
    case 'entra':
      return createEntraAuth(AppConfig);
    case 'none':
    case '':
    case undefined:
      return createNoneAuth();
    default:
      // Unknown mode: fail closed. The UI shows a configuration error naming
      // the value instead of opening any surface.
      console.error(`Unknown AUTH_MODE "${AppConfig.AUTH_MODE}" — the UI will not start.`);
      return createMisconfiguredAuth();
  }
}

export const auth = resolve();
export const authMode = AppConfig.AUTH_MODE || 'none';
/** False when AUTH_MODE is neither `none` (or unset) nor `entra`. */
export const isKnownAuthMode = authMode === 'none' || authMode === 'entra';
