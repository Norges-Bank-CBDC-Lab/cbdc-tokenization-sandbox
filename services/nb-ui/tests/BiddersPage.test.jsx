import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Feature: BiddersPage lists the mock roster, renders the sandbox banner,
// and opens the AddBidder + PlaceBid modals. Full mock client live.

describe('BiddersPage', () => {
  beforeEach(() => {
    vi.resetModules();
    window.__APP_CONFIG__.USE_MOCK = true;
    window.__APP_CONFIG__.MOCK_LATENCY_MS = 0;
    window.location.hash = '#/bidders';
  });

  it('renders the seeded mock roster + sandbox banner', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Bidders' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Sandbox only/i);

    await waitFor(() => {
      expect(screen.getByText('Nordea')).toBeInTheDocument();
    });
    expect(screen.getByText('DNB')).toBeInTheDocument();
    expect(screen.getByText('Alice.tbd')).toBeInTheDocument();
  });

  it('opens the AddBidder modal with generate-vs-import radio', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    const addBtn = await screen.findByRole('button', { name: /\+ Add bidder/i });
    await user.click(addBtn);

    expect(await screen.findByRole('heading', { name: 'Add bidder' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Generate new keypair/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Import existing private key/i)).toBeInTheDocument();
  });

  it('opens the PlaceBid modal when "Place bid" is clicked on a row', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('Nordea'));
    const nordeaRow = screen.getByText('Nordea').closest('tr');
    const placeBid = within(nordeaRow).getByRole('button', { name: /Place bid/i });
    await user.click(placeBid);

    expect(await screen.findByRole('heading', { name: /Place bid as Nordea/ })).toBeInTheDocument();
  });
});
