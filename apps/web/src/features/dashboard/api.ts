import { useQuery } from '@tanstack/react-query';
import { GmDashboardReport } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/**
 * F-78 — the GM Command Center report (reports-analytics.md §14.1, D-079).
 *
 * orgId is the caller's FIRST org, passed unconditionally (the shipped
 * win-loss pattern, win-loss-page.tsx) — never the old scopeOrg dance, which
 * passes undefined for every single-org tenant and would 400 the pilot owner
 * on his own page. The fetch is enabled only once the org is known AND the
 * caller holds report:view (the page mounts the report on that check), so a
 * non-holder never fires the request; the server stays the authority and a
 * 403 still surfaces as an error state.
 */
export function useGmDashboard(orgId: string | undefined, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: ['gm-dashboard', orgId ?? 'single-org'] as const,
    enabled: opts.enabled,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.analytics.gmDashboard, {
        query: { organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      // A parse, never a cast — the D-078 (2b) lesson; the render test pins it.
      return GmDashboardReport.parse(res.body);
    },
  });
}
