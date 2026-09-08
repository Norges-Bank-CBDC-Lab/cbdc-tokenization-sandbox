/**
 * PayCouponModal — confirmation gate before paying a bond coupon.
 *
 * Shows exactly what the payment will do: every current holder, the
 * cash amount each receives, and the total cash leg from the
 * government reserve. On the final coupon period the payment also
 * repays principal, burns every unit, and closes the bond, so the
 * preview adds the principal column, lists unsold manager-held units
 * as burned without payment, and warns when the reserve's WNOK balance
 * cannot cover the total. Confirm fires POST /v1/bonds/{isin}/coupon-
 * payments with holders=null (backend pays ALL active holders); the
 * server re-checks eligibility on-chain, so a stale `payable` flag
 * fails loudly here rather than silently.
 */
import { BondsApi } from '../api/bondsApi.js';
import { CentralBankApi } from '../api/centralBankApi.js';
import { useMutation } from '../hooks/useApi.js';
import { LiveResource, useLiveQuery } from '../sync/LiveUpdatesProvider.jsx';
import { Fmt } from '../utils/format.js';
import { Button, Modal } from '../components/ui.jsx';

// Per-holder amounts mirror BondManager.payCoupon on-chain, in bond units
// (Fmt.formatNok multiplies by the 1000 NOK face value itself):
//   coupon    = balance × rateBps / 10000
//   principal = balance                    (final period only)
function couponUnits(balance, rateBps) {
  return (Number(balance ?? 0) * Number(rateBps ?? 0)) / 10000;
}

export function PayCouponModal({ bond, onClose, onPaid }) {
  const mutation = useMutation(() => BondsApi.payCoupon(bond.isin));
  const cbQ = useLiveQuery([LiveResource.CENTRAL_BANK], () => CentralBankApi.getCentralBank(), []);

  // Units the BondManager holds itself were never sold (a bidder's cash leg
  // failed at finalisation): they earn no coupon and are burned without
  // payment when the bond closes. They still count towards the holder set
  // the contract requires, so they stay in the preview.
  const managerAddress = (bond.contracts?.manager ?? '').toLowerCase();
  const holders = bond.holders ?? [];
  const isTreasury = (h) => (h.holder ?? '').toLowerCase() === managerAddress;
  const treasuryHeld = holders.some(isTreasury);
  const rateBps = bond.coupon?.rateBps;
  const isFinal = Number(bond.coupon?.payments?.remaining ?? 0) === 1;

  const paid = holders.filter((h) => !isTreasury(h));
  const unsoldUnits = holders
    .filter(isTreasury)
    .reduce((sum, h) => sum + Number(h.balance ?? 0), 0);
  const totalBalance = holders.reduce((sum, h) => sum + Number(h.balance ?? 0), 0);
  const couponTotal = paid.reduce((sum, h) => sum + couponUnits(h.balance, rateBps), 0);
  const principalTotal = isFinal ? paid.reduce((sum, h) => sum + Number(h.balance ?? 0), 0) : 0;
  const cashTotalUnits = couponTotal + principalTotal;

  // Reserve balance is in 1-NOK units; the preview totals are in bond units.
  const reserveNok = cbQ.data?.govReserve?.wnokBalance;
  const reserveShort = reserveNok != null && Number(reserveNok) < cashTotalUnits * 1000;

  async function submit() {
    try {
      const updated = await mutation.run();
      onPaid(updated);
    } catch {
      // Surfaced inline below via mutation.error; keep the modal open
      // so the operator can read the revert reason and retry.
    }
  }

  const actionLabel = isFinal ? 'Pay final coupon and close bond' : 'Pay coupon';
  const footer = (
    <>
      <Button onClick={onClose} variant="ghost" disabled={mutation.loading}>
        Cancel
      </Button>
      <Button onClick={submit} variant="primary" disabled={mutation.loading}>
        {mutation.loading ? 'Paying…' : actionLabel}
      </Button>
    </>
  );

  return (
    <Modal
      title={`${isFinal ? 'Pay final coupon' : 'Pay coupon'} on ${bond.isin}`}
      onClose={onClose}
      maxWidth={680}
      footer={footer}
    >
      <p style={{ marginTop: 0 }}>
        Pays one coupon interval at <strong>{Fmt.bpsToPct(rateBps)}</strong> of face value to every
        current holder. The cash leg settles in WNOK from the government reserve in the same
        transaction.
      </p>
      {isFinal && (
        <p className="hint">
          This is the final coupon. Each holder also receives the principal (face value) of their
          units, every unit is burned, and the bond closes as matured. There is no separate
          redemption step.
        </p>
      )}

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
              <th className="num">Coupon</th>
              {isFinal && <th className="num">Principal</th>}
              {isFinal && <th className="num">Total payout</th>}
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => {
              const treasury = isTreasury(h);
              const coupon = treasury ? 0 : couponUnits(h.balance, rateBps);
              const principal = treasury || !isFinal ? 0 : Number(h.balance ?? 0);
              return (
                <tr key={h.holder}>
                  <td className="mono" title={h.holder}>
                    {Fmt.shortHex(h.holder, 8, 6)}
                    {treasury && <span className="muted"> (unsold, held by manager)</span>}
                  </td>
                  <td className="num mono">{Fmt.formatUnits(h.balance)}</td>
                  <td className="num mono">
                    {treasury ? <span className="muted">no coupon</span> : Fmt.formatNok(coupon)}
                  </td>
                  {isFinal && (
                    <td className="num mono">
                      {treasury ? (
                        <span className="muted">burned, no payment</span>
                      ) : (
                        Fmt.formatNok(principal)
                      )}
                    </td>
                  )}
                  {isFinal && (
                    <td className="num mono">
                      {treasury ? '—' : Fmt.formatNok(coupon + principal)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td className="num mono">{Fmt.formatUnits(String(totalBalance))}</td>
              <td className="num mono">
                <strong>{Fmt.formatNok(couponTotal)}</strong>
              </td>
              {isFinal && (
                <td className="num mono">
                  <strong>{Fmt.formatNok(principalTotal)}</strong>
                </td>
              )}
              {isFinal && (
                <td className="num mono">
                  <strong>{Fmt.formatNok(cashTotalUnits)}</strong>
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      )}

      {treasuryHeld && (
        <p className="hint" style={{ marginTop: 8 }}>
          {isFinal
            ? `${Fmt.formatUnits(String(unsoldUnits))} unsold units held by the bond manager are burned without payment when the bond closes.`
            : `${Fmt.formatUnits(String(unsoldUnits))} unsold units held by the bond manager earn no coupon.`}
        </p>
      )}

      {reserveShort && (
        <div className="error" style={{ marginTop: 8 }}>
          The government reserve holds {Fmt.formatUnits(reserveNok)} WNOK, less than the{' '}
          {Fmt.formatNok(cashTotalUnits)} this payment moves. The whole transaction will revert; top
          up the reserve from the Central Bank page first.
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
