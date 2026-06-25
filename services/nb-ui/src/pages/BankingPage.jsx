/**
 * BankingPage — operator surface over the per-bank TBD (tokenized bank
 * deposit) tokens.
 *
 * Hybrid layout: a compact overview of every deployed TBD on top, an
 * "acting as bank" selector, and a detail panel for the selected bank's token
 * with allowlist editing and mint / burn / transfer. Writes are signed
 * server-side by the token's owning bank (see nb-bond-api banking-tbd.ts).
 *
 * Sandbox-only — per-bank signing keys are local fixtures.
 */
import { useEffect, useState } from 'react';
import { BankingApi } from '../api/bankingApi.js';
import { useApi, useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import {
  Button,
  CopyableHex,
  EmptyState,
  ErrorState,
  LoadingState,
  SandboxOnlyBanner,
  Select,
  useToast,
} from '../components/ui.jsx';
import { AddTbdAllowlistModal } from './AddTbdAllowlistModal.jsx';
import { TbdMintBurnModal } from './TbdMintBurnModal.jsx';
import { TransferTbdModal } from './TransferTbdModal.jsx';

const PAGE_SIZE = 5;

export function BankingPage() {
  const tbdQ = useApi(() => BankingApi.listTbd(), []);
  const banksQ = useApi(() => BankingApi.listBanks(), []);
  const [selectedBank, setSelectedBank] = useState('');
  const [modal, setModal] = useState(null);
  const [page, setPage] = useState(0);
  const toast = useToast();

  const removeMut = useMutation(({ tbdAddress, holder }) =>
    BankingApi.removeFromAllowlist(tbdAddress, holder),
  );

  // Keep the overview showing the selected ("acting as") bank's page. Manual
  // Next/Prev still browse freely — this only re-syncs when the selection or
  // the underlying data changes.
  useEffect(() => {
    const list = tbdQ.data ?? [];
    const active = (
      selectedBank ||
      banksQ.data?.[0]?.address ||
      list[0]?.bank.address ||
      ''
    ).toLowerCase();
    const idx = list.findIndex((t) => t.bank.address.toLowerCase() === active);
    if (idx >= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(Math.floor(idx / PAGE_SIZE));
    }
  }, [selectedBank, tbdQ.data, banksQ.data]);

  function reload() {
    tbdQ.reload();
    banksQ.reload();
  }

  if (tbdQ.loading) {
    return (
      <div className="card">
        <LoadingState label="Loading TBD tokens…" />
      </div>
    );
  }
  if (tbdQ.error) {
    return (
      <div className="card">
        <ErrorState error={tbdQ.error} onRetry={reload} />
      </div>
    );
  }

  const tokens = tbdQ.data ?? [];
  const banks = banksQ.data ?? [];
  // Drive the selector from the configured banks; fall back to the tokens'
  // banks if /banks is unavailable.
  const options = banks.length ? banks : tokens.map((t) => t.bank);
  const activeBank = (selectedBank || options[0]?.address || '').toLowerCase();
  const token = tokens.find((t) => t.bank.address.toLowerCase() === activeBank) ?? null;
  const pageCount = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedTokens = tokens.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function onMutated(kind, ref) {
    setModal(null);
    toast.push({
      kind: 'ok',
      title: `${kind} submitted`,
      body: `tx ${Fmt.shortHex(ref.hash, 8, 6)} @ block ${ref.block ?? '—'}`,
    });
    reload();
  }

  function onRemoveHolder(holder) {
    if (!token) return;
    const ok = window.confirm(
      `Remove ${Fmt.shortHex(holder, 8, 6)} from the ${token.symbol} allowlist?\n\n` +
        'On-chain balances are not changed; the address can no longer send or receive this TBD ' +
        'until re-added.',
    );
    if (!ok) return;
    removeMut
      .run({ tbdAddress: token.address, holder })
      .then((ref) => onMutated('Allowlist remove', ref))
      .catch((e) => toast.push({ title: 'Remove failed', body: e.message }));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumbs">Operator</div>
          <h1>Banking</h1>
          <div className="subtitle">
            Tokenized bank deposits (TBD) — one token per commercial bank. Manage the allowlist and
            run mint / burn / transfer, signed by the owning bank.
          </div>
        </div>
        <div className="actions">
          <Button onClick={reload} variant="ghost">
            Refresh
          </Button>
        </div>
      </div>

      <SandboxOnlyBanner>
        Tokenized bank deposits. Operations are signed by each token&apos;s owning bank using local
        fixture keys — never deploy against real funds.
      </SandboxOnlyBanner>

      {tokens.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No TBD tokens found"
            message="No tokenized-bank-deposit contracts are registered in GlobalRegistry yet."
          />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Deployed TBD tokens</h3>
            </div>
            <div className="card-body flush">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Token</th>
                    <th>Supply</th>
                    <th>Holders</th>
                    <th>Reserve (WNOK)</th>
                    <th>Backed</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTokens.map((t) => (
                    <tr
                      key={t.address}
                      onClick={() => setSelectedBank(t.bank.address)}
                      style={{
                        cursor: 'pointer',
                        fontWeight: t.bank.address.toLowerCase() === activeBank ? 600 : 400,
                      }}
                    >
                      <td>{t.bank.name}</td>
                      <td>
                        {t.name} <span className="muted">[{t.symbol}]</span>
                      </td>
                      <td>{t.totalSupply}</td>
                      <td>{t.holders.length}</td>
                      <td className="mono">{t.reserve ? t.reserve.wnokBalance : '—'}</td>
                      <td>{t.reserve ? (t.reserve.backed ? '✓' : '✗') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div
                  className="row"
                  style={{
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    marginTop: 12,
                  }}
                >
                  <span className="muted">
                    Page {safePage + 1} of {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 'var(--sp-6)' }}>
            <div className="card-header">
              <h3 className="card-title">Manage TBD</h3>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="muted">Acting as</span>
                <Select value={activeBank} onChange={(e) => setSelectedBank(e.target.value)}>
                  {options.map((b) => (
                    <option key={b.address} value={b.address.toLowerCase()}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="card-body">
              {!token ? (
                <EmptyState
                  title="No TBD for this bank"
                  message="This configured bank has no TBD contract registered yet."
                />
              ) : (
                <>
                  <div className="kpi-grid">
                    <div className="kpi">
                      <div className="kpi-label">Total supply</div>
                      <div className="kpi-value mono">{token.totalSupply}</div>
                      <div className="kpi-sub">
                        {token.name} [{token.symbol}] · decimals {token.decimals}
                      </div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Reserve (WNOK)</div>
                      <div className="kpi-value mono">
                        {token.reserve ? token.reserve.wnokBalance : '—'}
                      </div>
                      <div className="kpi-sub">
                        {token.reserve
                          ? token.reserve.backed
                            ? 'Backed by reserve'
                            : 'Under-backed'
                          : 'WNOK unreachable'}
                      </div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Holders</div>
                      <div className="kpi-value">{token.holders.length}</div>
                      <div className="kpi-sub">Allowlisted addresses</div>
                    </div>
                    <div className="kpi">
                      <div
                        className="kpi-label"
                        title="The TBD has a designated government reserve account that can mint TBD by depositing WNOK 1:1 (sovereign-money issuance). This is NOT WNOK-allowlist membership."
                      >
                        Government-nominated ⓘ
                      </div>
                      <div className="kpi-value">{token.government.nominated ? 'Yes' : 'No'}</div>
                      <div className="kpi-sub">
                        {token.government.nominated
                          ? Fmt.shortHex(token.government.reserveAddress, 8, 6)
                          : 'No gov-reserve mint path'}
                      </div>
                    </div>
                    <div className="kpi">
                      <div
                        className="kpi-label"
                        title="Whether the owning bank's address is on the WNOK allowlist — required to hold the WNOK reserve and settle cross-bank in WNOK. Distinct from government-nomination."
                      >
                        WNOK settlement ⓘ
                      </div>
                      <div className="kpi-value">
                        {token.reserve
                          ? token.reserve.bankAllowlisted
                            ? 'Allowlisted'
                            : 'Not allowlisted'
                          : '—'}
                      </div>
                      <div className="kpi-sub">Owning bank on the WNOK allowlist</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 12, margin: '12px 0' }}>
                    <div>
                      <div className="kpi-label" style={{ marginBottom: 4 }}>
                        TBD contract
                      </div>
                      <CopyableHex value={token.address} />
                    </div>
                    <div>
                      <div className="kpi-label" style={{ marginBottom: 4 }}>
                        Owning bank ({token.bank.name})
                      </div>
                      <CopyableHex value={token.bank.address} />
                    </div>
                  </div>

                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Button variant="primary" onClick={() => setModal('mint')}>
                      Mint
                    </Button>
                    <Button variant="danger" onClick={() => setModal('burn')}>
                      Burn
                    </Button>
                    <Button variant="ghost" onClick={() => setModal('transfer')}>
                      Transfer
                    </Button>
                    <Button variant="ghost" onClick={() => setModal('add')}>
                      + Add to allowlist
                    </Button>
                  </div>

                  {token.holders.length === 0 ? (
                    <EmptyState
                      title="Allowlist is empty"
                      message="Add an address before minting or transferring."
                    />
                  ) : (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Address</th>
                          <th>Balance</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {token.holders.map((h) => (
                          <tr key={h.address}>
                            <td className="mono">{h.address}</td>
                            <td>{h.balance}</td>
                            <td className="right">
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => onRemoveHolder(h.address)}
                                disabled={removeMut.loading}
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {token && modal === 'mint' && (
        <TbdMintBurnModal
          mode="mint"
          tbdAddress={token.address}
          symbol={token.symbol}
          onClose={() => setModal(null)}
          onSubmitted={(ref) => onMutated('Mint', ref)}
        />
      )}
      {token && modal === 'burn' && (
        <TbdMintBurnModal
          mode="burn"
          tbdAddress={token.address}
          symbol={token.symbol}
          onClose={() => setModal(null)}
          onSubmitted={(ref) => onMutated('Burn', ref)}
        />
      )}
      {token && modal === 'transfer' && (
        <TransferTbdModal
          tbdAddress={token.address}
          symbol={token.symbol}
          bankName={token.bank.name}
          onClose={() => setModal(null)}
          onSubmitted={(ref) => onMutated('Transfer', ref)}
        />
      )}
      {token && modal === 'add' && (
        <AddTbdAllowlistModal
          tbdAddress={token.address}
          symbol={token.symbol}
          existingAddresses={token.holders.map((h) => h.address)}
          onClose={() => setModal(null)}
          onAdded={(ref) => onMutated('Allowlist add', ref)}
        />
      )}
    </div>
  );
}
