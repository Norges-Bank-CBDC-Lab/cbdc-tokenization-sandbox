/**
 * BiddersPage — sandbox bidder roster and impersonated bid entry.
 *
 * Lists every bidder in the API DB (seeded with Nordea, DNB,
 * Alice.tbd). The operator can:
 *  - Add a fresh bidder (generate keypair or import an existing key)
 *  - Delete a bidder (hard-blocked when on-chain bids reference them)
 *  - "Place bid" → opens PlaceBidModal scoped to that bidder
 *
 * All actions go through BiddersApi, which dispatches to the real
 * NB Bond API or the in-memory mock depending on AppConfig.USE_MOCK.
 */
import { useState } from 'react';
import { BiddersApi } from '../api/biddersApi.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  SandboxOnlyBanner,
  useToast,
} from '../components/ui.jsx';
import { AddBidderModal } from './AddBidderModal.jsx';
import { PlaceBidModal } from './PlaceBidModal.jsx';

export function BiddersPage() {
  const { data, loading, error, reload } = useApi(() => BiddersApi.listBidders(), []);
  const [showAdd, setShowAdd] = useState(false);
  const [placeBidFor, setPlaceBidFor] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null);
  const toast = useToast();

  const deleteMut = useMutation((address) => BiddersApi.deleteBidder(address));

  const bidders = data ?? [];
  const totalWnok = bidders.reduce((sum, b) => sum + BigInt(b.wnokBalance ?? '0'), 0n);

  async function onDelete(bidder) {
    const ok = window.confirm(
      `Delete bidder "${bidder.name}" (${Fmt.shortHex(bidder.address)})?\n\n` +
        'This removes the keypair from the sandbox roster but does NOT remove ' +
        'any bids already submitted on-chain.',
    );
    if (!ok) return;
    try {
      await deleteMut.run(bidder.address);
      toast.push({ kind: 'ok', title: 'Bidder removed' });
      reload();
    } catch (e) {
      // RFC 7807 errors are formatted in HttpError.message already
      toast.push({ title: 'Delete failed', body: e.message });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Sandbox roster</div>
          <h1>Bidders</h1>
          <div className="subtitle">
            Impersonable bidder accounts. The API holds each private key so it can sign bid intents
            and submit sealed bids on behalf of the bidder.
          </div>
        </div>
        <div className="actions">
          <Button onClick={reload} variant="ghost">
            Refresh
          </Button>
          <Button onClick={() => setShowAdd(true)} variant="primary">
            + Add bidder
          </Button>
        </div>
      </div>

      <SandboxOnlyBanner />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Bidders</div>
          <div className="kpi-value">{bidders.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total WNOK across roster</div>
          <div className="kpi-value mono">{Fmt.formatUnits(totalWnok.toString())}</div>
        </div>
      </div>

      <div className="card flush-top">
        {loading && <LoadingState label="Loading bidders…" />}
        {!loading && error && <ErrorState error={error} onRetry={reload} />}
        {!loading && !error && bidders.length === 0 && (
          <EmptyState
            title="No bidders yet"
            message="Add a bidder to start submitting impersonated bids."
            action={
              <Button onClick={() => setShowAdd(true)} variant="primary">
                + Add bidder
              </Button>
            }
          />
        )}
        {!loading && !error && bidders.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Public key</th>
                <th className="num">WNOK</th>
                <th className="num">ETH (wei)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bidders.map((b) => (
                <tr key={b.address}>
                  <td>{b.name}</td>
                  <td className="mono">{b.address}</td>
                  <td className="mono">{Fmt.shortHex(b.publicKey, 8, 6)}</td>
                  <td className="num mono">{Fmt.formatUnits(b.wnokBalance)}</td>
                  <td className="num mono">{Fmt.formatUnits(b.ethBalance)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="primary" onClick={() => setPlaceBidFor(b)}>
                      Place bid
                    </Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => setRevealedKey(b)}>
                      Reveal key
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onDelete(b)}
                      disabled={deleteMut.loading}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddBidderModal
          existingNames={bidders.map((b) => b.name)}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            toast.push({ kind: 'ok', title: 'Bidder added' });
            reload();
          }}
        />
      )}

      {placeBidFor && (
        <PlaceBidModal
          bidder={placeBidFor}
          onClose={() => setPlaceBidFor(null)}
          onSubmitted={() => {
            setPlaceBidFor(null);
            toast.push({ kind: 'ok', title: 'Sealed bid submitted' });
            reload();
          }}
        />
      )}

      {revealedKey && <RevealKeyModal bidder={revealedKey} onClose={() => setRevealedKey(null)} />}
    </div>
  );
}

function RevealKeyModal({ bidder, onClose }) {
  return (
    <Modal title={`Private key — ${bidder.name}`} onClose={onClose}>
      <SandboxOnlyBanner>
        The key below grants full impersonation of this bidder. Do not paste it anywhere outside
        this sandbox.
      </SandboxOnlyBanner>
      <div className="field">
        <label>Address</label>
        <div className="mono" style={{ wordBreak: 'break-all' }}>
          {bidder.address}
        </div>
      </div>
      <div className="field">
        <label>Public key (compressed)</label>
        <div className="mono" style={{ wordBreak: 'break-all' }}>
          {bidder.publicKey}
        </div>
      </div>
      <div className="field">
        <label>Private key</label>
        <div className="mono" style={{ wordBreak: 'break-all', color: '#7a3a00' }}>
          {bidder.privateKey}
        </div>
      </div>
    </Modal>
  );
}
