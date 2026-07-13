/**
 * BiddersPage — sandbox bidder roster and impersonated bid entry.
 *
 * Lists every bidder in the API DB (seeded with Nordea, DNB,
 * Alice.tbd). The operator can:
 *  - Add a fresh bidder (generate keypair or import an existing key)
 *  - Delete a bidder (hard-blocked when on-chain bids reference them)
 *  - "Place bid" → opens PlaceBidModal scoped to that bidder
 *
 * All actions go through BiddersApi → HttpClient → NB Bond API.
 */
import { useState } from 'react';
import { BiddersApi } from '../api/biddersApi.js';
import { BondsApi } from '../api/bondsApi.js';
import { selectBidAcceptingAuctions } from '../api/selectors.js';
import { useMutation } from '../hooks/useApi.js';
import { LiveResource, useLiveQuery } from '../sync/LiveUpdatesProvider.jsx';
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
import { getTestMode } from '../utils/debugSettings.js';

export function BiddersPage() {
  const { data, loading, error, reload } = useLiveQuery(
    [LiveResource.BIDDERS],
    () => BiddersApi.listBidders(),
    [],
  );
  // Side query for the "is anything bid-acceptable right now?" check
  // used to disable the per-row Place bid button when there's nothing
  // for the operator to bid on. Cheap — same bondsApi cache as the
  // PlaceBidModal itself.
  const bondsQ = useLiveQuery(
    [LiveResource.BONDS, LiveResource.AUCTIONS],
    () => BondsApi.listBonds(),
    [],
  );
  const [showAdd, setShowAdd] = useState(false);
  const [placeBidFor, setPlaceBidFor] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null);
  const toast = useToast();

  const deleteMut = useMutation((address) => BiddersApi.deleteBidder(address));

  const bidders = data ?? [];
  const totalWnok = bidders.reduce((sum, b) => sum + BigInt(b.wnokBalance ?? '0'), 0n);
  const testMode = getTestMode();
  // In test mode the operator can submit against any open auction
  // (including time-expired ones), so the gate is `status === 'open'`.
  // Otherwise it's the stricter "open AND end > now".
  const biddableCount = testMode
    ? (bondsQ.data ?? []).flatMap((b) => b.auctions ?? []).filter((a) => a.status === 'open').length
    : selectBidAcceptingAuctions(bondsQ.data ?? []).length;
  const placeBidEnabled = biddableCount > 0;

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
                <th
                  title={
                    'On-chain identity: 20-byte EVM address derived from the public key ' +
                    '(last 20 bytes of keccak256 of the uncompressed pubkey). Used as ' +
                    'msg.sender when the API submits this bidder’s transactions.'
                  }
                >
                  Address
                </th>
                <th
                  title={
                    'Compressed secp256k1 public key (33 bytes, SEC1). Used to verify ECDSA ' +
                    'signatures on this bidder’s bid intents. Bid plaintexts are encrypted to ' +
                    'the auction’s separate sealing key — not to this key.'
                  }
                >
                  Public key
                </th>
                <th className="num">WNOK</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bidders.map((b) => (
                <tr key={b.address}>
                  <td>{b.name}</td>
                  <td className="mono" title={b.address}>
                    {b.address}
                  </td>
                  <td className="mono" title={b.publicKey}>
                    {Fmt.shortHex(b.publicKey, 8, 6)}
                  </td>
                  <td className="num mono">{Fmt.formatUnits(b.wnokBalance)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setPlaceBidFor(b)}
                      disabled={!placeBidEnabled}
                      title={
                        placeBidEnabled
                          ? undefined
                          : 'No auctions are currently accepting bids — either none are open or all have passed their end timestamp. Enable Test mode in the top bar to force submit (chain will reject expired).'
                      }
                    >
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
        <label
          title={
            'On-chain identity. 20-byte EVM address derived from the public key ' +
            '(last 20 bytes of keccak256 of the uncompressed pubkey). Appears as ' +
            'msg.sender on every transaction the API submits on this bidder’s behalf.'
          }
        >
          Address
        </label>
        <div className="mono" style={{ wordBreak: 'break-all' }}>
          {bidder.address}
        </div>
      </div>
      <div className="field">
        <label
          title={
            'Compressed secp256k1 public key (33 bytes, SEC1). Used to verify ECDSA ' +
            'signatures on bid intents from this bidder. NOT used to encrypt bids — ' +
            'that uses the auction’s separate sealingPubKey.'
          }
        >
          Public key (compressed)
        </label>
        <div className="mono" style={{ wordBreak: 'break-all' }}>
          {bidder.publicKey}
        </div>
      </div>
      <div className="field">
        <label
          title={
            'secp256k1 private key. Signs every tx and bid intent the API sends on this ' +
            'bidder’s behalf. Stored in plaintext in the sandbox SQLite DB — sandbox-only.'
          }
        >
          Private key (signing)
        </label>
        <div className="mono" style={{ wordBreak: 'break-all', color: '#7a3a00' }}>
          {bidder.privateKey}
        </div>
      </div>
    </Modal>
  );
}
