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

function resolve() {
  switch (AppConfig.AUTH_MODE) {
    case 'entra':
      return createEntraAuth(AppConfig);
    case 'none':
    case '':
    case undefined:
      return createNoneAuth();
    default:
      // Unknown mode: fail closed to the no-auth implementation and let the
      // visible "auth mode unknown" warning in DEVELOPMENT.md guide the fix.
      console.warn(`Unknown AUTH_MODE "${AppConfig.AUTH_MODE}" — falling back to no-auth.`);
      return createNoneAuth();
  }
}

export const auth = resolve();
export const authMode = AppConfig.AUTH_MODE || 'none';
