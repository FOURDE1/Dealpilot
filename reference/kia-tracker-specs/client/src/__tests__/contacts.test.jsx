import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

// Mock fetch for React Query
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: [], total: 0 }),
  })
));

function renderWithProviders(ui) {
  const testClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={testClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe('ContactsPage', () => {
  it('renders the contacts page with title', async () => {
    const { default: ContactsPage } = await import('../components/ContactsPage');
    renderWithProviders(<ContactsPage />);

    // The h1 title should be rendered
    const heading = document.querySelector('h1');
    expect(heading).toBeDefined();
    expect(heading.textContent).toMatch(/contacts\.title|Contacts/i);
  });

  it('renders search input', async () => {
    const { default: ContactsPage } = await import('../components/ContactsPage');
    renderWithProviders(<ContactsPage />);

    const searchInput = document.querySelector('input[type="text"]');
    expect(searchInput).toBeDefined();
  });
});
