import { useQuery } from '@tanstack/react-query';
import { PublishedBranding } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/** The zod const and its inferred type share the name; alias the type for use. */
export type PublishedBrandingT = PublishedBranding;

export const brandingKeys = {
  current: ['branding', 'current'] as const,
};

/**
 * F-14: the tenant's PUBLISHED brand, loaded once on boot. `null` is the normal
 * answer for a tenant who never opened the editor — the app then uses the
 * platform default theme. Any member may read it; gating it would leave the
 * app unbranded for everyone but the owner.
 */
export function usePublishedBranding(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: brandingKeys.current,
    enabled: opts?.enabled ?? true,
    // The brand only changes on publish; no need to refetch on every focus.
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.branding.current, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return res.body === null ? null : PublishedBranding.parse(res.body);
    },
  });
}
