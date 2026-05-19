import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: BondsPage loads bonds, renders the index table, supports the ISIN
// filter, and opens the create-bond modal. We exercise the full path with the
// mock client live (no shallow rendering, no per-prop assertion).

describe('BondsPage', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
    window.__APP_CONFIG__.MOCK_LATENCY_MS = 0;
    window.location.hash = '#/bonds';
  });

  it('renders the bond list from the mock backend', async () => {
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

  it('opens the create-bond modal when the action button is clicked', async () => {
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

    expect(await screen.findByText('Issue new bond')).toBeInTheDocument();
  });
});
