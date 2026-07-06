import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// OperationsPage renders the read-only operator audit trail. We stub
// OperationsApi at the module boundary.

const NOW_SECS = Math.floor(Date.now() / 1000);

const LONG_ERROR = `execution reverted ${'x'.repeat(200)}`;

const FIXTURE_OPERATIONS = [
  {
    id: 4,
    opType: 'REDEMPTION',
    target: 'NO0012345678',
    status: 'FAILED',
    txHash: null,
    error: LONG_ERROR,
    detail: null,
    createdAt: NOW_SECS - 30,
  },
  {
    id: 3,
    opType: 'COUPON_PAYMENT',
    target: 'NO0012345678',
    status: 'REVERTED',
    txHash: null,
    error: 'coupon payment reverted on-chain: CouponNotReady()',
    detail: { holders: 2 },
    createdAt: NOW_SECS - 60,
  },
  {
    id: 2,
    opType: 'WNOK_MINT',
    target: '0x2222222222222222222222222222222222222222',
    status: 'SUCCEEDED',
    txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    error: null,
    detail: { amount: '1000' },
    createdAt: NOW_SECS - 120,
  },
];

vi.mock('../src/api/operationsApi.js', () => ({
  OperationsApi: {
    listOperations: vi.fn().mockResolvedValue(FIXTURE_OPERATIONS),
  },
}));

describe('OperationsPage', () => {
  beforeEach(() => {
    window.location.hash = '#/operations';
  });

  it('renders attempts with status badges, decoded errors and tx hashes', async () => {
    const { OperationsPage } = await import('../src/pages/OperationsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <OperationsPage />
      </ToastProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Operations' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('REVERTED')).toBeInTheDocument();
    });

    // Humanised op type, decoded revert reason, success row with detail.
    expect(screen.getByText('COUPON payment')).toBeInTheDocument();
    expect(
      screen.getByText('coupon payment reverted on-chain: CouponNotReady()'),
    ).toBeInTheDocument();
    expect(screen.getByText('SUCCEEDED')).toBeInTheDocument();
    expect(screen.getByText('amount: 1000')).toBeInTheDocument();

    // Status badge classes map to existing palette classes; Status is the
    // last column.
    expect(screen.getByText('REVERTED').className).toContain('badge-rejected');
    expect(screen.getByText('SUCCEEDED').className).toContain('badge-open');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Time', 'Operation', 'Target', 'Result', 'Tx', 'Status']);

    // Tx hash renders shortened and links to the explorer's tx page
    // (EXPLORER_BASE_URL default from src/config.js in tests).
    const txLink = screen.getByRole('link', { name: '0xaaaaaaaa…' });
    expect(txLink).toHaveAttribute(
      'href',
      'http://blockscout.cbdc-sandbox.local/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(txLink).toHaveAttribute('target', '_blank');

    // Oversized decoded errors are excerpted so the row cannot stretch
    // the table outside the card; the full text stays on the hover title.
    const failedCell = screen.getByTitle(LONG_ERROR);
    expect(failedCell.textContent.length).toBeLessThanOrEqual(141);
    expect(failedCell.textContent.endsWith('…')).toBe(true);
  });

  it('shows the empty state when the trail has no rows', async () => {
    const { OperationsApi } = await import('../src/api/operationsApi.js');
    OperationsApi.listOperations.mockResolvedValueOnce([]);
    const { OperationsPage } = await import('../src/pages/OperationsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <OperationsPage />
      </ToastProvider>,
    );

    expect(await screen.findByText('No operations recorded yet')).toBeInTheDocument();
  });
});
