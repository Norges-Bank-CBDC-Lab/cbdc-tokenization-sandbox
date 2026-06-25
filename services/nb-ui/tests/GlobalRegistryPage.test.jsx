import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// GlobalRegistryPage renders a read-only table of registered contracts.
// We stub RegistryApi at the module boundary.

const FIXTURE_REGISTRY = [
  { name: 'Global Registry', address: '0x1111111111111111111111111111111111111111' },
  { name: 'Wholesale NOK', address: '0x2222222222222222222222222222222222222222' },
  { name: 'Bond Manager', address: '0x3333333333333333333333333333333333333333' },
];

vi.mock('../src/api/registryApi.js', () => ({
  RegistryApi: {
    listRegistry: vi.fn().mockResolvedValue(FIXTURE_REGISTRY),
  },
}));

describe('GlobalRegistryPage', () => {
  beforeEach(() => {
    window.location.hash = '#/registry';
  });

  it('renders the registry table with name + address rows', async () => {
    const { GlobalRegistryPage } = await import('../src/pages/GlobalRegistryPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <GlobalRegistryPage />
      </ToastProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Global Registry' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Wholesale NOK')).toBeInTheDocument();
    });
    expect(screen.getByText('Bond Manager')).toBeInTheDocument();
    // The registry itself is a row in the table as well as the page heading.
    expect(screen.getAllByText('Global Registry').length).toBeGreaterThanOrEqual(2);
  });
});
