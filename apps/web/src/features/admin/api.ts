import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueueNameT } from '@dealpilot/contracts';
import {
  AdminAnnouncement,
  AdminAnnouncementList,
  AdminDlqPage,
  AdminMeResponse,
  AdminQueueDepthList,
  AdminRetryResult,
  AdminTenantDetail,
  AdminTenantEventsResponse,
  AdminTenantMembers,
  AdminTenantPage,
  AdminTenantProvisioned,
  AdminTenantUsage,
  ImpersonationList,
  ImpersonationSession,
  ImpersonationSessionDetail,
  OwnerInvitationReissued,
  PlanList,
  PlatformSetting,
  PlatformSettingList,
  PlatformStaffGranted,
  PlatformStaffList,
  TenantStatusChangeResult,
  type AdminUpdateTenantInputT,
  type AnnouncementSeverityT,
  type GrantPlatformStaffInputT,
  type OrganizationStatusT,
  type PlanTierT,
  type PlatformSettingKeyT,
  type ProvisionTenantInputT,
  type PublishAnnouncementInputT,
  type ReissueOwnerInvitationInputT,
  type SetPlatformSettingInputT,
  type StartImpersonationInputT,
  type RetryJobsInputT,
  type TenantStatusChangeInputT,
  type UsagePeriodT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { ME_KEY } from '../../shared/api/use-me.js';

/** F-69 — the platform console's client side (admin-console.md §3/§4/§11). */

export interface TenantFilters {
  status?: OrganizationStatusT;
  plan?: PlanTierT;
  q?: string;
}

export const adminKeys = {
  all: ['admin'] as const,
  me: ['admin', 'me'] as const,
  plans: ['admin', 'plans'] as const,
  tenants: (f: TenantFilters) => ['admin', 'tenants', f] as const,
  tenant: (id: string) => ['admin', 'tenant', id] as const,
  events: (id: string) => ['admin', 'tenant', id, 'events'] as const,
  staff: ['admin', 'staff'] as const,
  impersonations: ['admin', 'impersonations'] as const,
  impersonation: (id: string) => ['admin', 'impersonation', id] as const,
  members: (id: string) => ['admin', 'tenant', id, 'members'] as const,
  announcements: (severity: AnnouncementSeverityT | undefined) => ['admin', 'announcements', severity ?? 'all'] as const,
  announcement: (id: string) => ['admin', 'announcement', id] as const,
  settings: ['admin', 'settings'] as const,
  // F-73: the period is part of the identity, not a filter over one cache
  // entry — 'mtd' and '90d' are different windows of different numbers.
  usage: (id: string, period: UsagePeriodT) => ['admin', 'tenant', id, 'usage', period] as const,
  // No `snapshot` key here on purpose: the snapshot console screen is a
  // recorded cut (D-074 / O-51), so nothing reads or invalidates one. A cache
  // key naming an entry nothing writes is the dead-vocabulary failure one
  // layer up from the event bus — it comes back with the hook that needs it.
  queues: ['admin', 'queues'] as const,
  // The tenant filter is part of the identity for the same reason the period
  // is: the server pages by POSITION inside the filtered result, so a cursor
  // taken under one filter is refused under another.
  dlq: (name: QueueNameT, organizationId: string | undefined) => ['admin', 'queues', name, 'dlq', organizationId ?? 'all'] as const,
};

function compact<T extends Record<string, string | undefined>>(q: T): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter((kv): kv is [string, string] => kv[1] !== undefined && kv[1] !== ''));
}

/**
 * The console's identity probe. `retry: false` on purpose: a 404 (not
 * staff), 403 (not enrolled) or 401 (re-auth) is the answer, not a blip.
 */
export function useAdminMe() {
  return useQuery({
    queryKey: adminKeys.me,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.me, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminMeResponse.parse(res.body);
    },
  });
}

export function useAdminPlans() {
  return useQuery({
    queryKey: adminKeys.plans,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.plans, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return PlanList.parse(res.body);
    },
  });
}

export function useAdminTenants(filters: TenantFilters) {
  return useInfiniteQuery({
    queryKey: adminKeys.tenants(filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined,
    queryFn: async ({ pageParam, signal }) => {
      const res = await apiRequest(routes.admin.tenants.list, {
        query: compact({ status: filters.status, plan: filters.plan, q: filters.q, cursor: pageParam, limit: '25' }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantPage.parse(res.body);
    },
  });
}

export function useAdminTenant(id: string) {
  return useQuery({
    queryKey: adminKeys.tenant(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.tenants.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantDetail.parse(res.body);
    },
  });
}

export function useAdminTenantEvents(id: string) {
  return useQuery({
    queryKey: adminKeys.events(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.tenants.events, { params: { id }, query: { limit: '100' }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantEventsResponse.parse(res.body);
    },
  });
}

/**
 * F-73 §6 — one tenant's usage for one window (admin-console.md §6).
 *
 * The period rides the query key rather than a `select`, so switching windows
 * refetches instead of re-slicing: `allowances` is null for anything but
 * `mtd`, and a cached `mtd` body re-read as `90d` would put a monthly plan
 * number beside a ninety-day count — the exact comparison the server refuses
 * to enable.
 */
export function useAdminTenantUsage(id: string, period: UsagePeriodT) {
  return useQuery({
    queryKey: adminKeys.usage(id, period),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.tenants.usage, { params: { id }, query: { period }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantUsage.parse(res.body);
    },
  });
}

function invalidateTenant(queryClient: ReturnType<typeof useQueryClient>, id: string): void {
  void queryClient.invalidateQueries({ queryKey: adminKeys.tenant(id) });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
}

export function useUpdateAdminTenant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminUpdateTenantInputT) => {
      const res = await apiRequest(routes.admin.tenants.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantDetail.parse(res.body);
    },
    onSuccess: () => invalidateTenant(queryClient, id),
  });
}

export function useChangeTenantStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TenantStatusChangeInputT) => {
      const res = await apiRequest(routes.admin.tenants.setStatus, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return TenantStatusChangeResult.parse(res.body);
    },
    onSuccess: () => invalidateTenant(queryClient, id),
    // A 409 (stale or now-illegal transition) means the tenant moved under
    // us: refetch so the buttons and `expected_from` catch up (review).
    onError: () => invalidateTenant(queryClient, id),
  });
}

/** F-70: the birth of a tenant. 201 carries the detail AND the owner seat (with the link when no mail reaches them). */
export function useProvisionTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionTenantInputT) => {
      const res = await apiRequest(routes.admin.tenants.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return AdminTenantProvisioned.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  });
}

/** F-70: re-send or correct the owner seat. A 409 means an owner is now active: refetch. */
export function useReissueOwnerInvitation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReissueOwnerInvitationInputT) => {
      const res = await apiRequest(routes.admin.tenants.inviteOwner, { params: { id }, body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return OwnerInvitationReissued.parse(res.body);
    },
    onSuccess: () => {
      invalidateTenant(queryClient, id);
      void queryClient.invalidateQueries({ queryKey: adminKeys.events(id) });
    },
    onError: () => invalidateTenant(queryClient, id),
  });
}

/** F-71 — the support-session register (admin-console.md §7). */
export function useImpersonations(filters: { tenantId?: string; active?: 'true' | 'false' }) {
  return useQuery({
    queryKey: [...adminKeys.impersonations, filters] as const,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.impersonation.list, {
        query: compact({ tenant_id: filters.tenantId, active: filters.active, limit: '200' }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return ImpersonationList.parse(res.body);
    },
  });
}

export function useImpersonation(id: string) {
  return useQuery({
    queryKey: adminKeys.impersonation(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.impersonation.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return ImpersonationSessionDetail.parse(res.body);
    },
  });
}

/** The target picker — a tenant's active members with a sign-in identity. */
export function useAdminTenantMembers(id: string, enabled = true) {
  return useQuery({
    queryKey: adminKeys.members(id),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.tenants.members, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminTenantMembers.parse(res.body);
    },
  });
}

/** From the 201 on, the same cookie acts as the target: the caller clears the cache and leaves the console. */
export function useStartImpersonation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartImpersonationInputT) => {
      const res = await apiRequest(routes.admin.impersonation.start, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return ImpersonationSession.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.me });
      void queryClient.invalidateQueries({ queryKey: adminKeys.impersonations });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    // A 409 means a session is already live on this console session: the probe must catch up.
    onError: () => void queryClient.invalidateQueries({ queryKey: adminKeys.me }),
  });
}

/** 200 + the closed row. The register, the probe and the tenant-side /me all move. */
export function useEndImpersonation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.admin.impersonation.end, { params: { id } });
      if (res.status !== 200) fail(res.status, res.body);
      return ImpersonationSession.parse(res.body);
    },
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.me });
      void queryClient.invalidateQueries({ queryKey: adminKeys.impersonations });
      void queryClient.invalidateQueries({ queryKey: adminKeys.impersonation(session.id) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.events(session.tenant.id) });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: () => {
      // A 409 impersonation_ended means it was already over: both identities
      // must catch up or the banner keeps showing a dead session (review).
      void queryClient.invalidateQueries({ queryKey: adminKeys.me });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function usePlatformStaff() {
  return useQuery({
    queryKey: adminKeys.staff,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.staff.list, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return PlatformStaffList.parse(res.body);
    },
  });
}

export function useGrantStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GrantPlatformStaffInputT) => {
      const res = await apiRequest(routes.admin.staff.grant, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return PlatformStaffGranted.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.staff }),
  });
}

export function useRevokeStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(routes.admin.staff.revoke, { params: { userId } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.staff }),
  });
}

/** F-72 — announcements and the kill switches (admin-console.md §8, §5.3). */

export function useAdminAnnouncements(severity: AnnouncementSeverityT | undefined) {
  return useInfiniteQuery({
    queryKey: adminKeys.announcements(severity),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined,
    queryFn: async ({ pageParam, signal }) => {
      const res = await apiRequest(routes.admin.announcements.list, {
        query: compact({ severity, cursor: pageParam, limit: '25' }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminAnnouncementList.parse(res.body);
    },
  });
}

export function useAdminAnnouncement(id: string) {
  return useQuery({
    queryKey: adminKeys.announcement(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.announcements.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminAnnouncement.parse(res.body);
    },
  });
}

/**
 * Publishing IS creating (§12): there is no draft, no PATCH and no delete,
 * so this mutation runs exactly once per announcement and the 201 it returns
 * is the whole history of the row.
 */
export function usePublishAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PublishAnnouncementInputT) => {
      const res = await apiRequest(routes.admin.announcements.publish, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return AdminAnnouncement.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] }),
  });
}

/** The one legal mutation: move the display window earlier, never later. */
export function useEndAnnouncement(id: string) {
  const queryClient = useQueryClient();
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.announcement(id) });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
  };
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(routes.admin.announcements.end, { params: { id } });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminAnnouncement.parse(res.body);
    },
    onSuccess: settle,
    // A 409 means it ended under us — from another console, or because its
    // own window closed. The page must catch up or it keeps offering End.
    onError: settle,
  });
}

/**
 * The switches, read UNCACHED by the server on purpose: a staffer who has
 * just flipped one must see the truth, not the five-second TTL's picture of
 * it. `enabled` is the caller's `settings:read` — the console shell asks for
 * every staffer, and platform billing holds no such capability.
 */
export function usePlatformSettings(enabled = true) {
  return useQuery({
    queryKey: adminKeys.settings,
    enabled,
    // Someone else's flip must not stay invisible on this screen; there is no
    // invalidation channel between processes, only this poll and the TTL.
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.settings.list, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return PlatformSettingList.parse(res.body);
    },
  });
}

/**
 * F-73 §9 — the ten queues and what each one is holding (admin-console.md §9).
 *
 * Polled, and deliberately: a stuck queue is a live incident, the console is
 * the only surface that shows one, and there is no invalidation channel
 * between a worker and this browser. `queue_state` is why the counts are
 * nullable rather than zero — "we could not reach Redis" and "nothing has
 * failed" are different answers and only one of them means walk away.
 */
export function useAdminQueues(enabled = true) {
  return useQuery({
    queryKey: adminKeys.queues,
    enabled,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.admin.queues.list, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminQueueDepthList.parse(res.body);
    },
  });
}

/**
 * One queue's failed set, a page at a time.
 *
 * The page is addressed by POSITION in a live capped zset, not by a keyset:
 * BullMQ offers no stable sort key over the failed set, so entries genuinely
 * move between pages as jobs are retried or evicted. The response carries
 * `paging_basis` and the screen carries the caption — the client does not get
 * to present a shifting list as a stable one.
 */
export function useAdminDlq(name: QueueNameT, organizationId: string | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: adminKeys.dlq(name, organizationId),
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined,
    queryFn: async ({ pageParam, signal }) => {
      const res = await apiRequest(routes.admin.queues.dlq, {
        params: { name },
        query: compact({ organization_id: organizationId, cursor: pageParam, limit: '25' }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminDlqPage.parse(res.body);
    },
  });
}

/**
 * F-73 §9 — the one mutation, and the most dangerous call this client makes.
 *
 * On `deferred-send`, `assistant-turn`, `first-touch` or `drip-tick` this can
 * put a SECOND text message in front of a real dealer customer, which is why
 * the dialog above it makes the operator type the queue name back. There is no
 * optimistic update and no retry-on-error: a request whose outcome is unknown
 * must be re-decided by a person, never re-sent by a query client.
 *
 * Both the failed page and the depths are invalidated on success, because a
 * requeued job leaves the failed set — a screen still showing it is an
 * invitation to send the customer a third message.
 */
export function useRetryDlqJobs(name: QueueNameT, organizationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: RetryJobsInputT) => {
      const res = await apiRequest(routes.admin.queues.retry, { params: { name }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return AdminRetryResult.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.dlq(name, organizationId) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.queues });
    },
  });
}

export function useSetPlatformSetting(settingKey: PlatformSettingKeyT) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetPlatformSettingInputT) => {
      const res = await apiRequest(routes.admin.settings.set, { params: { setting_key: settingKey }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return PlatformSetting.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.settings }),
  });
}
