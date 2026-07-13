/**
 * CentralBankPage — Norges Bank operator surface against WNOK.
 *
 * Surfaces:
 *  - KPIs: WNOK balance (at CB), supply, in-circulation, government settlement bank
 *  - Addresses (CB account + WNOK contract) and the allowlist editor (add/remove)
 *  - Mint / Burn / Transfer actions in the header (all transactions originate
 *    from the CB account, gated by MINTER/BURNER roles + the WNOK allowlist)
 *
 * The API returns `available: false` when CENTRAL_BANK_PK is unset
 * or the WNOK contract isn't registered — we render an empty state
 * instead of the action surface in that case.
 */
import { useState } from 'react';
import { CentralBankApi } from '../api/centralBankApi.js';
import { BiddersApi } from '../api/biddersApi.js';
import { useMutation } from '../hooks/useApi.js';
import { LiveResource, useLiveQuery } from '../sync/LiveUpdatesProvider.jsx';
import { Fmt } from '../utils/format.js';
import {
  Button,
  CopyableHex,
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshState,
  SandboxOnlyBanner,
  useToast,
} from '../components/ui.jsx';
import { AllowlistAddModal } from './AllowlistAddModal.jsx';
import { MintWnokModal } from './MintWnokModal.jsx';
import { BurnWnokModal } from './BurnWnokModal.jsx';
import { TransferWnokModal } from './TransferWnokModal.jsx';

export function CentralBankPage() {
  const cbQ = useLiveQuery([LiveResource.CENTRAL_BANK], () => CentralBankApi.getCentralBank(), []);
  const listQ = useLiveQuery([LiveResource.CENTRAL_BANK], () => CentralBankApi.listAllowlist(), []);
  const biddersQ = useLiveQuery([LiveResource.BIDDERS], () => BiddersApi.listBidders(), []);
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
          {cb.available && (
            <>
              <Button variant="ghost" onClick={() => setShowMint(true)}>
                Mint
              </Button>
              <Button variant="ghost" onClick={() => setShowBurn(true)}>
                Burn
              </Button>
              <Button variant="ghost" onClick={() => setShowTransfer(true)}>
                Transfer
              </Button>
            </>
          )}
          <Button onClick={reloadAll} variant="ghost">
            Refresh
          </Button>
        </div>
      </div>

      <RefreshState
        refreshing={cbQ.refreshing || listQ.refreshing || biddersQ.refreshing}
        error={cbQ.refreshError || listQ.refreshError || biddersQ.refreshError}
        onRetry={() => {
          reloadAll();
          biddersQ.reload();
        }}
      />

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
              <div className="kpi-label">WNOK balance</div>
              <div className="kpi-value mono">{Fmt.formatUnits(cb.wnok.balance)}</div>
              <div className="kpi-sub">Held by the CB account</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">WNOK supply</div>
              <div className="kpi-value mono">{Fmt.formatUnits(cb.wnok.totalSupply ?? '0')}</div>
              <div className="kpi-sub">Total minted minus burned</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">In circulation</div>
              <div className="kpi-value mono">
                {Fmt.formatUnits(
                  (BigInt(cb.wnok.totalSupply ?? '0') - BigInt(cb.wnok.balance ?? '0')).toString(),
                )}
              </div>
              <div className="kpi-sub">WNOK held outside the CB</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Government bank</div>
              <div className="kpi-value">{cb.govSettlementBank?.name ?? '—'}</div>
              <div className="kpi-sub">Settles bond coupon / redemption</div>
            </div>
          </div>

          {!onAllowlist && (
            <div className="hint" style={{ marginBottom: 16 }}>
              Heads-up: the CB account is not on its own WNOK allowlist. Transfers from CB will
              revert until the operator adds it to the allowlist below.
            </div>
          )}

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
                      <th className="num">WNOK holding</th>
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
                          <td className="num mono">
                            {e.wnokBalance != null ? Fmt.formatUnits(e.wnokBalance) : '—'}
                          </td>
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
