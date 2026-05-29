/**
 * CentralBankPage — Norges Bank operator surface against WNOK.
 *
 * Surfaces:
 *  - CB account address, WNOK contract address, CB balance, allowlist size
 *  - Allowlist editor (add/remove)
 *  - Mint / Burn / Transfer modals (all transactions originate from the
 *    CB account, gated by MINTER/BURNER roles + the WNOK allowlist)
 *
 * The API returns `available: false` when CENTRAL_BANK_PK is unset
 * or the WNOK contract isn't registered — we render an empty state
 * instead of the action surface in that case.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { BiddersApi } from '../api/biddersApi.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SandboxOnlyBanner,
  useToast,
} from '../components/ui.jsx';
import { AllowlistAddModal } from './AllowlistAddModal.jsx';
import { MintWnokModal } from './MintWnokModal.jsx';
import { BurnWnokModal } from './BurnWnokModal.jsx';
import { TransferWnokModal } from './TransferWnokModal.jsx';

/**
 * Renders a long hex string in full, wrappable + monospace, with a one-click
 * Copy button. Mirrors the helper in AuctionDetailPage — dedupe both into
 * components/ui.jsx in a follow-up.
 */
function CopyableHex({ value }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can still triple-click to select */
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <code
        className="mono"
        style={{
          flex: 1,
          wordBreak: 'break-all',
          background: 'var(--surface-2, #f5f6fa)',
          padding: '4px 6px',
          borderRadius: 4,
          fontSize: 12,
          userSelect: 'all',
        }}
      >
        {value}
      </code>
      <Button size="sm" variant="ghost" onClick={onCopy} title="Copy to clipboard">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function CentralBankPage() {
  const cbQ = useApi(() => CentralBankApi.getCentralBank(), []);
  const listQ = useApi(() => CentralBankApi.listAllowlist(), []);
  const biddersQ = useApi(() => BiddersApi.listBidders(), []);
  const [showAdd, setShowAdd] = useState(false);
  const [showMint, setShowMint] = useState(false);
  const [showBurn, setShowBurn] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const toast = useToast();

  const removeMut = useMutation((address) => CentralBankApi.removeFromAllowlist(address));

  function reloadAll() {
    cbQ.reload();
    listQ.reload();
  }

  async function onRemove(address) {
    const ok = window.confirm(
      `Remove ${Fmt.shortHex(address, 8, 6)} from the WNOK allowlist?\n\n` +
        'On-chain balances are not changed. The address will no longer be able to send or ' +
        'receive WNOK transfers until re-added.',
    );
    if (!ok) return;
    try {
      const ref = await removeMut.run(address);
      toast.push({
        kind: 'ok',
        title: 'Address removed',
        body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
      });
      reloadAll();
    } catch (e) {
      toast.push({ title: 'Remove failed', body: e.message });
    }
  }

  if (cbQ.loading) {
    return (
      <div className="card">
        <LoadingState label="Loading Central Bank…" />
      </div>
    );
  }
  if (cbQ.error) {
    return (
      <div className="card">
        <ErrorState error={cbQ.error} onRetry={reloadAll} />
      </div>
    );
  }

  const cb = cbQ.data;
  const allowlist = listQ.data ?? [];
  const onAllowlist = cb.available
    ? allowlist.some((e) => e.address.toLowerCase() === cb.address.toLowerCase())
    : false;
  // The WNOK allowlist is address-only on-chain, so enrich each address with a
  // name + type by matching the bidder roster (by lowercased address). The CB's
  // own account is labelled separately; unknown addresses stay "—".
  const biddersByAddress = new Map((biddersQ.data ?? []).map((b) => [b.address.toLowerCase(), b]));
  function allowlistLabel(address) {
    const lower = address.toLowerCase();
    const bidder = biddersByAddress.get(lower);
    if (bidder) return { name: bidder.name, type: 'Bidder' };
    if (cb.available && lower === cb.address.toLowerCase()) {
      return { name: '—', type: 'Central Bank' };
    }
    return { name: '—', type: '—' };
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Operator</div>
          <h1>Central Bank</h1>
          <div className="subtitle">
            Manage the WNOK allowlist and run mint / burn / transfer operations from the Norges Bank
            operator account.
          </div>
        </div>
        <div className="actions">
          <Button onClick={reloadAll} variant="ghost">
            Refresh
          </Button>
        </div>
      </div>

      <SandboxOnlyBanner />

      {!cb.available && (
        <div className="card">
          <EmptyState
            title="Central Bank unavailable"
            message={
              'The API is reporting available=false — either CENTRAL_BANK_PK is unset, or the ' +
              'WNOK contract is not registered in GlobalRegistry. Check the nb-bond-api Helm ' +
              'values and that the WNOK deploy ran.'
            }
          />
        </div>
      )}

      {cb.available && (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">CB account</div>
              <div className="kpi-value mono" style={{ fontSize: 14 }}>
                {Fmt.shortHex(cb.address, 10, 8)}
              </div>
              <div className="kpi-sub">
                {onAllowlist ? 'On allowlist — can transfer' : 'Not allowlisted'}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">WNOK balance</div>
              <div className="kpi-value mono">{Fmt.formatUnits(cb.wnok.balance)}</div>
              <div className="kpi-sub">Held by the CB account</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Allowlist size</div>
              <div className="kpi-value">{cb.wnok.allowlistSize}</div>
              <div className="kpi-sub">Addresses permitted to send / receive</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">WNOK contract</div>
              <div className="kpi-value mono" style={{ fontSize: 14 }}>
                {Fmt.shortHex(cb.wnok.contractAddress, 10, 8)}
              </div>
              <div className="kpi-sub">From GlobalRegistry</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Addresses</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div className="kpi-label" style={{ marginBottom: 4 }}>
                    CB account
                  </div>
                  <CopyableHex value={cb.address} />
                </div>
                <div>
                  <div className="kpi-label" style={{ marginBottom: 4 }}>
                    WNOK contract
                  </div>
                  <CopyableHex value={cb.wnok.contractAddress} />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">WNOK actions</h3>
            </div>
            <div className="card-body">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => setShowMint(true)}>
                  Mint
                </Button>
                <Button variant="danger" onClick={() => setShowBurn(true)}>
                  Burn
                </Button>
                <Button variant="ghost" onClick={() => setShowTransfer(true)}>
                  Transfer from CB
                </Button>
              </div>
              {!onAllowlist && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Heads-up: the CB account is not on its own WNOK allowlist. Transfers from CB will
                  revert until the operator adds it here.
                </div>
              )}
            </div>
          </div>

          <div className="card flush-top">
            <div className="card-header">
              <h3 className="card-title">Allowlist</h3>
              <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
                + Add address
              </Button>
            </div>
            <div className="card-body flush">
              {listQ.loading && <LoadingState label="Loading allowlist…" />}
              {!listQ.loading && listQ.error && (
                <ErrorState error={listQ.error} onRetry={listQ.reload} />
              )}
              {!listQ.loading && !listQ.error && allowlist.length === 0 && (
                <EmptyState
                  title="Allowlist is empty"
                  message="Add the CB account or any holder before running transfers."
                />
              )}
              {!listQ.loading && !listQ.error && allowlist.length > 0 && (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowlist.map((e) => {
                      const label = allowlistLabel(e.address);
                      return (
                        <tr key={e.address}>
                          <td className="mono">{e.address}</td>
                          <td>{label.name}</td>
                          <td>{label.type}</td>
                          <td className="right">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => onRemove(e.address)}
                              disabled={removeMut.loading}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <AllowlistAddModal
          existingAddresses={allowlist.map((e) => e.address)}
          onClose={() => setShowAdd(false)}
          onAdded={(ref) => {
            setShowAdd(false);
            toast.push({
              kind: 'ok',
              title: 'Address added',
              body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
            });
            reloadAll();
          }}
        />
      )}
      {showMint && (
        <MintWnokModal
          onClose={() => setShowMint(false)}
          onSubmitted={(ref) => {
            setShowMint(false);
            toast.push({
              kind: 'ok',
              title: 'WNOK minted',
              body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
            });
            reloadAll();
          }}
        />
      )}
      {showBurn && (
        <BurnWnokModal
          onClose={() => setShowBurn(false)}
          onSubmitted={(ref) => {
            setShowBurn(false);
            toast.push({
              kind: 'ok',
              title: 'WNOK burned',
              body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
            });
            reloadAll();
          }}
        />
      )}
      {showTransfer && (
        <TransferWnokModal
          cbAddress={cb.address}
          cbBalance={cb.wnok.balance}
          allowlist={allowlist.map((e) => e.address)}
          onClose={() => setShowTransfer(false)}
          onSubmitted={(ref) => {
            setShowTransfer(false);
            toast.push({
              kind: 'ok',
              title: 'WNOK transferred',
              body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
            });
            reloadAll();
          }}
        />
      )}
    </div>
  );
}
