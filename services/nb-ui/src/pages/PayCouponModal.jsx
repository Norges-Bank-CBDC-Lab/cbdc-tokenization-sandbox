/**
 * PayCouponModal — confirmation gate before paying a bond coupon.
 *
 * Shows exactly what the payment will do: every current holder, the
 * cash amount each receives, and the total cash leg from the
 * government reserve. Confirm fires POST /v1/bonds/{isin}/coupon-
 * payments with holders=null (backend pays ALL active holders); the
 * server re-checks eligibility on-chain, so a stale `payable` flag
 * fails loudly here rather than silently.
 */
import { BondsApi } from '../api/bondsApi.js';
import { useMutation } from '../hooks/useApi.js';
import { Fmt } from '../utils/format.js';
import { Button, Modal } from '../components/ui.jsx';

// Per-holder coupon payment mirrors BondManager.payCoupon on-chain:
//   paymentPerBond = UNIT_NOMINAL (1000 NOK face value) × rateBps / 10000
//   payment        = balance × paymentPerBond                     (NOK)
// Fmt.formatNok takes bond-unit amounts and multiplies by the 1000 NOK
// face value itself, so we hand it balance × rateBps / 10000.
function couponUnits(balance, rateBps) {
  return (Number(balance ?? 0) * Number(rateBps ?? 0)) / 10000;
}

export function PayCouponModal({ bond, onClose, onPaid }) {
  const mutation = useMutation(() => BondsApi.payCoupon(bond.isin));

  // The on-chain payCoupon requires covering EVERY holder — including the
  // BondManager itself when a partial allocation left it holding unsold
  // units. Such treasury-held units deadlock the payout (the government
  // TBD's allowlist refuses the manager contract), so flag them loudly
  // before the operator fires a doomed transaction.
  const managerAddress = (bond.contracts?.manager ?? '').toLowerCase();
  const holders = bond.holders ?? [];
  const isTreasury = (h) => (h.holder ?? '').toLowerCase() === managerAddress;
  const treasuryHeld = holders.some(isTreasury);
  const rateBps = bond.coupon?.rateBps;
  const totalBalance = holders.reduce((sum, h) => sum + Number(h.balance ?? 0), 0);
  const totalUnits = holders.reduce((sum, h) => sum + couponUnits(h.balance, rateBps), 0);

  async function submit() {
    try {
      const updated = await mutation.run();
      onPaid(updated);
    } catch {
      // Surfaced inline below via mutation.error; keep the modal open
      // so the operator can read the revert reason and retry.
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} variant="ghost" disabled={mutation.loading}>
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={mutation.loading}>
        {mutation.loading ? 'Paying…' : 'Pay coupon'}
      </Button>
    </>
  );

  return (
    <Modal title={`Pay coupon on ${bond.isin}`} onClose={onClose} maxWidth={620} footer={footer}>
      <p style={{ marginTop: 0 }}>
        Pays one coupon interval at <strong>{Fmt.bpsToPct(rateBps)}</strong> of face value to every
        current holder. The cash leg settles from the government reserve in the same transaction.
      </p>

      {holders.length === 0 && (
        <p className="muted">
          No holders are known to the UI cache — the backend resolves the active holder set on-chain
          when the payment is submitted.
        </p>
      )}

      {holders.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Holder</th>
              <th className="num">Balance (units)</th>
              <th className="num">Coupon payment</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.holder}>
                <td className="mono" title={h.holder}>
                  {Fmt.shortHex(h.holder, 8, 6)}
                  {isTreasury(h) && <span className="muted"> (treasury)</span>}
                </td>
                <td className="num mono">{Fmt.formatUnits(h.balance)}</td>
                <td className="num mono">{Fmt.formatNok(couponUnits(h.balance, rateBps))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td className="num mono">{Fmt.formatUnits(String(totalBalance))}</td>
              <td className="num mono">
                <strong>{Fmt.formatNok(totalUnits)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {treasuryHeld && (
        <div className="error" style={{ marginTop: 8 }}>
          This bond has treasury-held units — the unsold remainder sits on the bond manager after a
          partial allocation. On-chain payout must cover every holder, and the government TBD&apos;s
          allowlist blocks the manager, so this payment will fail unless the manager is explicitly
          allowlisted there. See docs/KNOWN_ISSUES.md.
        </div>
      )}

      {mutation.error && (
        <div className="error" style={{ marginTop: 8 }}>
          {mutation.error.message || 'Coupon payment failed.'}
        </div>
      )}
    </Modal>
  );
}
