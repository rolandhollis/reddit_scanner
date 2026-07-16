import { QueryClient } from "@tanstack/react-query";

/**
 * Single app-wide TanStack Query client.
 *
 * Retries are disabled by default because our API errors are almost
 * always programmer errors (bad body, forgotten auth); retrying just
 * makes debugging slower. staleTime is 5s so a rapid follow-up click
 * doesn't spam the API but a manual refresh reflects real changes.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
