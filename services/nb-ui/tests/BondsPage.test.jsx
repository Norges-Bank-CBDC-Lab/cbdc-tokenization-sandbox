import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// BondsPage loads bonds via BondsApi, renders the index, supports the
// ISIN filter, and opens the create-bond modal. We stub BondsApi at
// the module boundary so the page sees a fixed roster without a real
// backend.

const FIXTURE_BONDS = [
  {
    isin: 'NO0012345678',
    status: 'outstanding',
    totalSupply: '5000000000',
    contracts: { token: '0xaaaa', auction: '0xbbbb' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '126144000' },
    coupon: {
      duration: '31536000',
      rateBps: '425',
      payments: { total: '5', made: '1', remaining: '4' },
    },
    holders: [],
    auctions: [],
    disabled: false,
    md5: 'abc',
  },
  {
    isin: 'NO0098765432',
    status: 'outstanding',
    totalSupply: '2500000000',
    contracts: { token: '0xcccc', auction: '0xdddd' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '126144000' },
    coupon: {
      duration: '31536000',
      rateBps: '385',
      payments: { total: '10', made: '0', remaining: '10' },
    },
    holders: [],
    auctions: [],
    disabled: false,
    md5: 'def',
  },
  {
    isin: 'NO0011223344',
    status: 'matured',
    totalSupply: '1000000000',
    contracts: { token: '0xeeee', auction: '0xffff' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '0' },
    coupon: {
      duration: '31536000',
      rateBps: '275',
      payments: { total: '3', made: '3', remaining: '0' },
    },
    holders: [],
    auctions: [],
    disabled: false,
    md5: 'ghi',
  },
];

const FIXTURE_BOND_DISABLED = {
  isin: 'NO9999DISABLE',
  status: 'staged',
  totalSupply: '0',
  contracts: { token: '0x1', auction: '0x2' },
  maturity: { duration: null, date: null, remaining: null },
  coupon: null,
  holders: [],
  auctions: [],
  disabled: true,
  md5: 'jkl',
};

const listBondsMock = vi.fn(({ includeDisabled } = {}) =>
  Promise.resolve(includeDisabled ? [...FIXTURE_BONDS, FIXTURE_BOND_DISABLED] : FIXTURE_BONDS),
);

vi.mock('../src/api/bondsApi.js', () => ({
  BondsApi: {
    listBonds: listBondsMock,
    getBond: vi.fn(),
    createBond: vi.fn(),
    disableBond: vi.fn(),
    listBondHistory: vi.fn(),
    payCoupon: vi.fn(),
    redeem: vi.fn(),
  },
}));

describe('BondsPage', () => {
  beforeEach(() => {
    window.location.hash = '#/bonds';
    // The shipped localStorage shim in this vitest setup doesn't implement
    // .clear(); remove just the key we care about.
    try {
      window.localStorage.removeItem('nb-ui:bonds:showDisabled');
    } catch {
      /* ignore — best effort */
    }
    listBondsMock.mockClear();
  });

  it('renders the bond list from the API', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    expect(screen.getByText('Bonds')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('NO0012345678')).toBeInTheDocument();
    });
    expect(screen.getByText('NO0098765432')).toBeInTheDocument();
    expect(screen.getByText('NO0011223344')).toBeInTheDocument();
  });

  it('filters bonds by ISIN substring', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('NO0012345678'));

    const filter = screen.getByPlaceholderText(/Filter by ISIN/i);
    await user.type(filter, '9876');

    await waitFor(() => {
      expect(screen.queryByText('NO0012345678')).not.toBeInTheDocument();
    });
    expect(screen.getByText('NO0098765432')).toBeInTheDocument();
  });

  it('opens the bond-only create modal when the action button is clicked', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    const newBondButtons = await screen.findAllByRole('button', { name: /\+ New bond/i });
    await user.click(newBondButtons[0]);

    // Per D2: the modal collects only ISIN + maturity. No auction fields.
    expect(await screen.findByRole('heading', { name: 'Create new bond' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/NO0012345678/i)).toBeInTheDocument();
    // The modal's <label>Maturity</label> + the table column header both
    // read "Maturity" — narrow to the <label> via the modal's parent div.
    const modalLabels = Array.from(document.querySelectorAll('.modal label')).map(
      (el) => el.textContent,
    );
    expect(modalLabels).toContain('Maturity');
    expect(screen.queryByText(/Auction type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offering size/i)).not.toBeInTheDocument();
  });

  it('hides disabled bonds by default; "Show disabled" toggle surfaces them', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('NO0012345678'));
    expect(screen.queryByText('NO9999DISABLE')).not.toBeInTheDocument();

    const toggle = screen.getByLabelText(/Show disabled/i);
    await user.click(toggle);

    await waitFor(() => expect(screen.getByText('NO9999DISABLE')).toBeInTheDocument());
    // The DISABLED pill renders next to the row's status.
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
  });

  it('persists the Show-disabled toggle to localStorage', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('NO0012345678'));
    expect(window.localStorage.getItem('nb-ui:bonds:showDisabled')).toBeNull();

    await user.click(screen.getByLabelText(/Show disabled/i));
    expect(window.localStorage.getItem('nb-ui:bonds:showDisabled')).toBe('true');
  });

  it('passes includeDisabled to listBonds based on the toggle state', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => expect(listBondsMock).toHaveBeenCalled());
    expect(listBondsMock.mock.calls[0][0]).toMatchObject({ includeDisabled: false });

    await user.click(screen.getByLabelText(/Show disabled/i));
    await waitFor(() => {
      const lastCall = listBondsMock.mock.calls[listBondsMock.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ includeDisabled: true });
    });
  });
});
