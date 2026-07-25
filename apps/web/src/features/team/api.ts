import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Member,
  paginated,
  type AddMemberInputT,
  type MemberT,
  type UpdateMemberInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { leadKeys } from '../leads/api.js';

const PaginatedMembers = paginated(Member);

export const teamKeys = {
  /** Prefix key — invalidating it refreshes the working AND removed rosters. */
  all: (orgId: string | undefined) => ['members', orgId] as const,
  list: (orgId: string | undefined, status?: 'revoked') =>
    ['members', orgId, status ?? 'working'] as const,
};

/** Always org-keyed: one cache entry per roster, shared by every screen. */
export function useMembers(
  orgId: string | undefined,
  opts?: { enabled?: boolean; status?: 'revoked' },
) {
  return useQuery({
    queryKey: teamKeys.list(orgId, opts?.status),
    enabled: (opts?.enabled ?? true) && orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.members.list, {
        query: { organization_id: orgId, status: opts?.status, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedMembers.parse(res.body);
    },
  });
}

export function useAddMember(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddMemberInputT) => {
      const res = await apiRequest(routes.members.add, { body });
      if (res.status !== 201) fail(res.status, res.body);
      // The 201 body carries `reinstated: true` when an existing same-org
      // membership was re-activated instead of a new one created.
      const reinstated = (res.body as { reinstated?: boolean }).reinstated === true;
      return { member: Member.parse(res.body), reinstated };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all(orgId) }),
  });
}

export function useUpdateMember(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateMemberInputT }) => {
      const res = await apiRequest(routes.members.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Member.parse(res.body);
    },
    onSuccess: (_member, { body }) => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.all(orgId) });
      // Revoking releases the member's leads server-side (same transaction) —
      // every cached lead view is potentially stale.
      if (body.status && body.status !== 'active') {
        void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      }
    },
  });
}

/** Active members only — what the assignee picker offers. */
export function activeMembers(items: readonly MemberT[] | undefined): MemberT[] {
  return (items ?? []).filter((m) => m.status === 'active');
}
