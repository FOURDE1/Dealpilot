import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';

/**
 * Defaults carried from the legacy client (frontend-stack §4.1), with one
 * refinement: deterministic 4xx responses (401/403/404/409/422) never retry —
 * only network failures and 5xx get the single retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 1;
      },
      throwOnError: false,
    },
    mutations: { retry: 0 },
  },
});
