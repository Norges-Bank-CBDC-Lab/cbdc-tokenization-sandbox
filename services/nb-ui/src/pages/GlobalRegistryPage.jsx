/**
 * GlobalRegistryPage — read-only inventory of the on-chain GlobalRegistry.
 *
 * Lists the contracts registered in the GlobalRegistry (name -> address) — the
 * directory the sandbox resolves everything through. The registry itself is the
 * first row. Read-only: no add/change surface yet.
 */
import { useApi } from '../hooks/useApi.js';
import { RegistryApi } from '../api/registryApi.js';
import { Button, CopyableHex, EmptyState, ErrorState, LoadingState } from '../components/ui.jsx';

export function GlobalRegistryPage() {
  const regQ = useApi(() => RegistryApi.listRegistry(), []);
  const contracts = regQ.data ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Operator</div>
          <h1>Global Registry</h1>
          <div className="subtitle">
            Contracts registered in the on-chain GlobalRegistry — the name-to-address directory the
            sandbox resolves everything through. Read-only.
          </div>
        </div>
        <div className="actions">
          <Button onClick={regQ.reload} variant="ghost">
            Refresh
          </Button>
        </div>
      </div>

      <div className="card flush-top">
        <div className="card-body flush">
          {regQ.loading && <LoadingState label="Loading registry…" />}
          {!regQ.loading && regQ.error && <ErrorState error={regQ.error} onRetry={regQ.reload} />}
          {!regQ.loading && !regQ.error && contracts.length === 0 && (
            <EmptyState
              title="No contracts registered"
              message="The GlobalRegistry returned no entries."
            />
          )}
          {!regQ.loading && !regQ.error && contracts.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.address}>
                    <td>{c.name}</td>
                    <td className="mono">
                      <CopyableHex value={c.address} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
