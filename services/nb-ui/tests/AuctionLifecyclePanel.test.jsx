import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuctionLifecyclePanel } from '../src/pages/AuctionLifecyclePanel.jsx';
import { CapabilitiesContext } from '../src/auth/capabilitiesContext.js';

// Feature: close, finalise, and cancel are issuer actions. The lifecycle panel
// offers them only to accounts that can operate; everyone else sees the
// read-only stepper.

const OPEN_AUCTION = { id: '0xauction1', status: 'open', bids: [], allocation: null };
const CLOSED_AUCTION = { ...OPEN_AUCTION, status: 'closed' };

const OPERATOR = {
  canUseApp: true,
  canAccessCentralBank: true,
  canAccessBanking: true,
  canOperate: true,
};
const TESTER = { ...OPERATOR, canAccessCentralBank: false, canOperate: false };

function renderPanel(auction, capabilities) {
  return render(
    <CapabilitiesContext.Provider value={capabilities}>
      <AuctionLifecyclePanel
        auction={auction}
        busy={false}
        onClose={vi.fn()}
        onFinalise={vi.fn()}
        onCancel={vi.fn()}
      />
    </CapabilitiesContext.Provider>,
  );
}

describe('AuctionLifecyclePanel', () => {
  it('offers close and cancel on an open auction to an operator', () => {
    renderPanel(OPEN_AUCTION, OPERATOR);
    expect(screen.getByRole('button', { name: /Close auction/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel auction/ })).toBeInTheDocument();
  });

  it('offers no lifecycle action to an account that cannot operate', () => {
    renderPanel(OPEN_AUCTION, TESTER);
    expect(screen.queryByRole('button', { name: /Close auction/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel auction/ })).not.toBeInTheDocument();

    renderPanel(CLOSED_AUCTION, TESTER);
    expect(screen.queryByRole('button', { name: /finalise/i })).not.toBeInTheDocument();
  });
});
