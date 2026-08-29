import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminMeResponse,
  AdminTenantDetail,
  AdminTenantEventsResponse,
  AdminTenantMembers,
  AdminTenantPage,
  AdminTenantProvisioned,
  ImpersonationList,
  ImpersonationSession,
  ImpersonationSessionDetail,
  OwnerInvitationReissued,
  PlanList,
  PlatformStaffGranted,
  PlatformStaffList,
  TenantStatusChangeResult,
  type AdminUpdateTenantInputT,
  type GrantPlatformStaffInputT,
  type OrganizationStatusT,
  type PlanTierT,
  type ProvisionTenantInputT,
  type ReissueOwnerInvitationInputT,
  type StartImpersonationInputT,
  type TenantStatusChangeInputT,
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
