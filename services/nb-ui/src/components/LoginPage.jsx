/**
 * LoginPage — the full-page signed-out / session-expired surface.
 *
 * Rendered by the auth gate in App.jsx whenever an interactive auth mode is
 * active and there is no usable signed-in session. It is the ONLY thing a
 * signed-out user sees: no nav, no pages, no API calls. Pure presentation
 * plus auth.login(); all values are generic (nothing deployment-specific).
 */
import { useState } from 'react';
import { auth } from '../auth/index.js';
import { NorgesBankLogo } from './NorgesBankLogo.jsx';
import { Button } from './ui.jsx';

export function LoginPage({ expired = false }) {
  const [busy, setBusy] = useState(false);

  async function onLogin() {
    setBusy(true);
    try {
      await auth.login();
    } finally {
      // loginRedirect navigates away on success; this only matters when the
      // redirect could not start (so the button must become clickable again).
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <NorgesBankLogo height={32} />
        <h1 className="login-title">Bond Auction Service</h1>
        <p className={expired ? 'login-status login-status-expired' : 'login-status'}>
          {expired ? 'Your session has expired — please sign in again.' : 'You are signed out.'}
        </p>
        <Button variant="primary" onClick={onLogin} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>
    </div>
  );
}
