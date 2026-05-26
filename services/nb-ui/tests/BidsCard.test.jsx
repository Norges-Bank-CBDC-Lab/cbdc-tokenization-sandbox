import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BidsCard } from '../src/pages/AuctionDetailPage.jsx';

// The BidsCard footer is the deliverable for operator-ui-backlog #8.
// "Best" direction depends on auction type, and sealed bids must NOT
// leak rate data via the footer.

const sealedBids = [
  {
    state: 'sealed',
    bidder: '0xaaaa',
    ciphertext: '0xc1',
    plaintextHash: '0xh1',
  },
  {
    state: 'sealed',
    bidder: '0xbbbb',
    ciphertext: '0xc2',
    plaintextHash: '0xh2',
  },
];

const unsealedBids = [
  { state: 'unsealed', bidder: '0xaaaa', rate: '420', units: '100000' },
  { state: 'unsealed', bidder: '0xbbbb', rate: '380', units: '250000' },
  { state: 'unsealed', bidder: '0xcccc', rate: '500', units: '50000' },
];

function getFooter() {
  return document.querySelector('.tbl tfoot');
}

describe('BidsCard totals row', () => {
  it('renders nothing for an empty bid list (EmptyState only)', () => {
    render(<BidsCard bids={[]} auctionType="RATE" auctionStatus="open" />);
    expect(screen.getByText(/No bids yet/i)).toBeInTheDocument();
    expect(getFooter()).toBeNull();
  });

  it('sealed bids: footer shows only the bid count, no rate data', () => {
    render(<BidsCard bids={sealedBids} auctionType="RATE" auctionStatus="open" />);
    const footer = getFooter();
    expect(footer).not.toBeNull();
    expect(within(footer).getByText(/Total bids:/i)).toBeInTheDocument();
    expect(within(footer).getByText('2')).toBeInTheDocument();
    // Encrypted: no percent / numeric rate values leaked into the footer
    expect(footer.textContent).not.toMatch(/%/);
  });

  it('RATE: picks the LOWEST yield as best, sums units', () => {
    render(<BidsCard bids={unsealedBids} auctionType="RATE" auctionStatus="closed" />);
    expect(screen.getByRole('columnheader', { name: 'Yield' })).toBeInTheDocument();
    const footer = getFooter();
    expect(within(footer).getByText('3.80%')).toBeInTheDocument();
    expect(within(footer).getByText('400,000')).toBeInTheDocument();
  });

  it('PRICE: picks the HIGHEST price as best, sums units', () => {
    render(<BidsCard bids={unsealedBids} auctionType="PRICE" auctionStatus="closed" />);
    expect(screen.getByRole('columnheader', { name: 'Price' })).toBeInTheDocument();
    const footer = getFooter();
    expect(within(footer).getByText('5.00')).toBeInTheDocument();
    expect(within(footer).getByText('400,000')).toBeInTheDocument();
  });

  it('BUYBACK: picks the LOWEST repurchase price as best, sums units', () => {
    render(<BidsCard bids={unsealedBids} auctionType="BUYBACK" auctionStatus="finalised" />);
    expect(screen.getByRole('columnheader', { name: 'Repurchase price' })).toBeInTheDocument();
    const footer = getFooter();
    expect(within(footer).getByText('3.80')).toBeInTheDocument();
    expect(within(footer).getByText('400,000')).toBeInTheDocument();
  });

  it('renders per-row PRICE values without a % suffix', () => {
    render(<BidsCard bids={unsealedBids} auctionType="PRICE" auctionStatus="closed" />);
    // The per-row 380 must render as "3.80" (price), not "3.80%" (yield).
    const cells = screen.getAllByText('3.80');
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.queryByText('3.80%')).toBeNull();
  });
});
