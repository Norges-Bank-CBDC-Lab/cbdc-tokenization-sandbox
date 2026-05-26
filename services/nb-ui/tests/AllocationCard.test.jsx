import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AllocationCard } from '../src/pages/AuctionDetailPage.jsx';

// Allocation rate semantics depend on auction type the same way bid
// rate does: bps yield for RATE, price-per-100 for PRICE/BUYBACK.
// Rendering must match so the operator doesn't misread a price as a %.

const allocation = {
  clearingRate: '420',
  entries: [
    { bidder: '0xaaaa', units: '100000', rate: '380' },
    { bidder: '0xbbbb', units: '250000', rate: '420' },
  ],
};

describe('AllocationCard', () => {
  it('RATE: column header "Yield", rates as %, clearing label "Clearing yield"', () => {
    render(<AllocationCard allocation={allocation} status="finalised" auctionType="RATE" />);
    expect(screen.getByRole('columnheader', { name: 'Yield' })).toBeInTheDocument();
    expect(screen.getByText('3.80%')).toBeInTheDocument();
    expect(screen.getByText(/Clearing yield/)).toHaveTextContent('Clearing yield 4.20%');
  });

  it('PRICE: column header "Price", rates without %, clearing label "Clearing price"', () => {
    render(<AllocationCard allocation={allocation} status="finalised" auctionType="PRICE" />);
    expect(screen.getByRole('columnheader', { name: 'Price' })).toBeInTheDocument();
    expect(screen.getByText('3.80')).toBeInTheDocument();
    expect(screen.queryByText('3.80%')).toBeNull();
    expect(screen.getByText(/Clearing price/)).toHaveTextContent('Clearing price 4.20');
  });

  it('BUYBACK: column header "Repurchase price", rates without %, clearing label adapts', () => {
    render(<AllocationCard allocation={allocation} status="finalised" auctionType="BUYBACK" />);
    expect(screen.getByRole('columnheader', { name: 'Repurchase price' })).toBeInTheDocument();
    expect(screen.getByText('3.80')).toBeInTheDocument();
    expect(screen.queryByText('3.80%')).toBeNull();
    expect(screen.getByText(/Clearing repurchase price/)).toHaveTextContent(
      'Clearing repurchase price 4.20',
    );
  });

  it('open auction: empty state, no table, no clearing label', () => {
    render(<AllocationCard allocation={null} status="open" auctionType="PRICE" />);
    expect(screen.getByText(/No allocation yet/i)).toBeInTheDocument();
    expect(document.querySelector('.tbl')).toBeNull();
    expect(screen.queryByText(/Clearing/)).toBeNull();
  });

  it('cancelled auction: cancelled empty state, no table', () => {
    render(<AllocationCard allocation={allocation} status="cancelled" auctionType="PRICE" />);
    expect(screen.getByText(/Auction cancelled/i)).toBeInTheDocument();
    expect(document.querySelector('.tbl')).toBeNull();
  });
});
