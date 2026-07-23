import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';

describe('Client smoke test', () => {
  it('queryClient is configured correctly', () => {
    expect(queryClient).toBeDefined();
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries.staleTime).toBe(30000);
    expect(defaults.queries.retry).toBe(1);
  });

  it('renders without crashing when wrapped in providers', () => {
    function TestComponent() {
      return <div data-testid="smoke">Kia Deal Tracker</div>;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TestComponent />
        </BrowserRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('smoke')).toHaveTextContent('Kia Deal Tracker');
  });
});
