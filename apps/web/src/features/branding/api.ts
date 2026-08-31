import { queryOptions, useMutation, useQuery, useQueryClient, type FetchStatus, type QueryStatus } from '@tanstack/react-query';
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
 *
 * F-75 (D-076): shared between the shell's hook and `RequireAuth`'s prefetch
 * (the no-flash mechanism), so both read one key, one staleTime and one
 * null-tolerant queryFn — the prefetch cannot drift from the hook.
 */
export function publishedBrandingOptions() {
  return queryOptions({
    queryKey: brandingKeys.current,
    // The brand only changes on publish; no need to refetch on every focus.
    staleTime: 5 * 60_000,
    // A "no brand" answer is normal, not an error to retry — retrying would
    // churn the shell (re-renders that can race focus) for every unbranded or
    // org-less user, which is most of them.
    retry: false,
    queryFn: async ({ signal }): Promise<PublishedBrandingT | null> => {
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

export function usePublishedBranding() {
  return useQuery(publishedBrandingOptions());
}

/**
 * F-75 (D-076): the shell's skeleton gate, pure. Open — hold the neutral
 * skeleton — only while the brand has NEVER answered and a fetch is in flight:
 * `status === 'pending'` (in query-core v5 a data-less query re-entering a
 * fetch is 'pending' again, which is exactly the pre-login 401 → sign-in
 * refetch R8 gates against a platform flash) AND `fetchStatus === 'fetching'`.
 * An errored, idle query — a 5xx, the 10 s client timeout, a snapshot that
 * fails `PublishedBranding.parse` — is closed: the shell renders in the
 * platform look. A query that has data keeps `status 'success'` through any
 * background refetch, so it never re-gates. AppLayout is the query's ONLY
 * observer (BrandStyle, BrandMark and BrandDocument take the branding as a
 * prop): nothing under the gate can start a fetch when it opens, so an error
 * cannot re-open it — the skeleton ↔ shell loop the F-75 review measured
 * (1215 requests in 15.6 s on one tab with the endpoint answering 500) is
 * structurally gone; f75-brand-paint.e2e.ts's third test holds it there.
 */
export function brandingGateOpen(q: { status: QueryStatus; fetchStatus: FetchStatus }): boolean {
  return q.status === 'pending' && q.fetchStatus === 'fetching';
}

/** The three published-asset slots the shell renders (`email_logo`/`login_bg` have no consumer yet). */
export type BrandAssetSlot = 'logo_light' | 'logo_dark' | 'favicon';

/**
 * The URL of a PUBLISHED brand asset, from the contract path (ADR-002) — never
 * a hand-written string. `organization_id` is required because the route
 * resolves through `soleOrg`, which answers 404 for a member of several
 * organizations; `store_id` scopes a rooftop sub-brand; `v` is the published
 * version, the cache-buster behind the route's one-year `immutable` cache on a
 * slot URL (a new logo is a new version).
 */
export function assetUrl(
  b: Pick<PublishedBrandingT, 'organization_id' | 'store_id' | 'version'>,
  slot: BrandAssetSlot,
): string {
  const qs = new URLSearchParams({ organization_id: b.organization_id });
  if (b.store_id !== null) qs.set('store_id', b.store_id);
  qs.set('v', String(b.version));
  return `${routes.branding.asset.path.replace(':slot', slot)}?${qs.toString()}`;
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
      // Never-branded → 200 with a null body (CR-16 fix); a stale 404 means the
      // same. Either way the editor opens on the shared defaults.
      if (res.status === 404 || res.body === null) return null;
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

/** A file body needs more room than a JSON envelope; the slot ceiling is 200 KB. */
const UPLOAD_TIMEOUT_MS = 30_000;

/**
 * F-75: upload one brand asset — the raw `File` bytes as the body with the
 * file's own content-type (the route reads `content-type` to pick the
 * extension). `apiRequest` JSON-encodes every body and cannot carry bytes, so
 * this is the one direct `fetch` in the branding feature; the path and method
 * still come from the contract. Answers the recomputed DRAFT (status back to
 * draft — an asset is an edit like any other; nothing shows until publish).
 */
export async function uploadBrandAsset(orgId: string, slot: BrandAssetSlot, file: File): Promise<TenantBrandingT> {
  const path = routes.branding.uploadAsset.path
    .replace(':id', encodeURIComponent(orgId))
    .replace(':slot', slot);
  const res = await fetch(path, {
    method: routes.branding.uploadAsset.method,
    credentials: 'include',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (res.status !== 201) fail(res.status, body);
  return TenantBranding.parse(body);
}

export function useUploadBrandAsset(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, file }: { slot: BrandAssetSlot; file: File }) => uploadBrandAsset(orgId, slot, file),
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
