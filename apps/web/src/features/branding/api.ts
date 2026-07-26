import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PublishedBranding, TenantBranding, type UpdateBrandingInput } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/** The zod const and its inferred type share the name; alias the type for use. */
export type PublishedBrandingT = PublishedBranding;
export type TenantBrandingT = TenantBranding;

export const brandingKeys = {
  current: ['branding', 'current'] as const,
  draft: (orgId: string) => ['branding', 'draft', orgId] as const,
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
    // A "no brand" answer is normal, not an error to retry — retrying would
    // churn the shell (re-renders that can race focus) for every unbranded or
    // org-less user, which is most of them.
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.branding.current, { signal });
      // The boot answer for an unbranded or org-less caller is 200 with a null
      // body (Ahmad fixed the endpoint so "no org" is no longer a 404). The 404
      // branch is now purely defensive — a cosmetic boot query must never break
      // first paint, so any "no brand / can't tell" answer falls back to the
      // platform theme rather than throwing.
      if (res.status === 404 || res.body === null) return null;
      if (res.status !== 200) fail(res.status, res.body);
      return PublishedBranding.parse(res.body);
    },
  });
}

/**
 * F-14 editor: the tenant's DRAFT brand (needs organization:update). A
 * never-branded org has no draft row yet → 404, which the editor reads as
 * "start from the platform defaults" (the first save creates it). CR-16 asks
 * the server to answer with a default draft instead, per its own published-
 * endpoint fix.
 */
export function useBrandingDraft(orgId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: brandingKeys.draft(orgId),
    enabled: (opts?.enabled ?? true) && orgId !== '',
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.branding.get, { params: { id: orgId }, signal });
      if (res.status === 404) return null; // no draft yet — editor uses defaults
      if (res.status !== 200) fail(res.status, res.body);
      return TenantBranding.parse(res.body);
    },
  });
}

export function useUpdateBranding(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof UpdateBrandingInput>) => {
      const res = await apiRequest(routes.branding.update, { params: { id: orgId }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return TenantBranding.parse(res.body);
    },
    // The PUT answers with the recomputed draft (contrast fixes included) — write
    // it straight in so the adjustments show without a refetch.
    onSuccess: (draft) => queryClient.setQueryData(brandingKeys.draft(orgId), draft),
  });
}

export function usePublishBranding(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(routes.branding.publish, { params: { id: orgId }, body: {} });
      if (res.status !== 200) fail(res.status, res.body);
      return TenantBranding.parse(res.body);
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(brandingKeys.draft(orgId), draft);
      // The live brand changed — every reader reloads the published palette.
      void queryClient.invalidateQueries({ queryKey: brandingKeys.current });
    },
  });
}
