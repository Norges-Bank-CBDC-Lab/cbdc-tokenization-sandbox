/**
 * ConfigErrorPage — full-page surface shown when the runtime config carries
 * an AUTH_MODE the UI does not recognise. Like LoginPage, it is the only thing
 * rendered: no nav, no pages, no API calls. It names the bad value so the
 * deployment can be fixed; the valid values are `none` and `entra`.
 */
import { NorgesBankLogo } from './NorgesBankLogo.jsx';

export function ConfigErrorPage({ authMode }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <NorgesBankLogo height={32} />
        <h1 className="login-title">Bond Auction Service</h1>
        <p className="login-status login-status-expired">
          Configuration error: unknown AUTH_MODE &quot;{authMode}&quot;.
        </p>
        <p className="login-status">
          Set AUTH_MODE to &quot;none&quot; or &quot;entra&quot; in the runtime config and reload.
        </p>
      </div>
    </div>
  );
}
