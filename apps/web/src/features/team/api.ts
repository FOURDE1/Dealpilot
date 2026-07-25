import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Member,
  paginated,
  type AddMemberInputT,
  type MemberT,
  type UpdateMemberInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedMembers = paginated(Member);

export const teamKeys = {
  list: (orgId: string | undefined) => ['members', orgId] as const,
};

/** Always org-keyed: one cache entry per roster, shared by every screen. */
export function useMembers(orgId: string | undefined, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: teamKeys.list(orgId),
    enabled: (opts?.enabled ?? true) && orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.members.list, {
        query: { organization_id: orgId, limit: 100 },
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
      return Member.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.list(orgId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.list(orgId) }),
  });
}

/** Active members only — what the assignee picker offers. */
export function activeMembers(items: readonly MemberT[] | undefined): MemberT[] {
  return (items ?? []).filter((m) => m.status === 'active');
}
