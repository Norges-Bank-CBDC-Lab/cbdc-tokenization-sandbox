/**
 * CapabilitiesContext — delivers the signed-in account's capability flags
 * (see capabilities.js) to components that show or hide role-dependent
 * controls. App.jsx provides the value; `useCapabilities()` reads it.
 *
 * Without a provider (for example a page rendered on its own in a test) the
 * hook derives the flags from the current auth account, so it grants exactly
 * what the account holds: everything in `none` mode, nothing in `entra` mode
 * without a signed-in account.
 */
import { createContext, useContext } from 'react';
import { auth } from './index.js';
import { capabilitiesForAccount } from './capabilities.js';

export const CapabilitiesContext = createContext(null);

export function useCapabilities() {
  return useContext(CapabilitiesContext) ?? capabilitiesForAccount(auth.getAccount());
}
