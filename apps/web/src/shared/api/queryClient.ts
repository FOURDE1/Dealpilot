import { QueryClient } from '@tanstack/react-query';

/** Defaults carried from the legacy client (frontend-stack §4.1). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
      throwOnError: false,
    },
    mutations: { retry: 0 },
  },
});
