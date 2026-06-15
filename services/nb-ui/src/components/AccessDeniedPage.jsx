/**
 * AccessDeniedPage — full-page surface for a signed-in user whose account
 * carries no recognised role (entra mode). Like LoginPage, it is the only
 * thing such a user sees: no nav, no pages, no API calls. Offers sign-out so
 * they can switch to an authorised account.
 */
import { useState } from 'react';
import { auth } from '../auth/index.js';
import { NorgesBankLogo } from './NorgesBankLogo.jsx';
import { Button } from './ui.jsx';

export function AccessDeniedPage({ account }) {
  const [busy, setBusy] = useState(false);
  const who = account?.name || account?.username;

  async function onLogout() {
    setBusy(true);
    try {
      await auth.logout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <NorgesBankLogo height={32} />
        <h1 className="login-title">Bond Auction Service</h1>
        <p className="login-status login-status-expired">
          {who
            ? `${who} is not authorised for this application.`
            : 'Your account is not authorised for this application.'}
        </p>
        <p className="login-status">
          Ask an operator to add you to the Sandbox-Tester or Sandbox-Operator group.
        </p>
        <Button variant="primary" onClick={onLogout} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </div>
  );
}
