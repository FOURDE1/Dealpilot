import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Invitation,
  InvitationPreview,
  paginated,
  type CreateInvitationInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedInvitations = paginated(Invitation);

export const invitationKeys = {
  list: (orgId: string | undefined) => ['invitations', orgId ?? 'single-org'] as const,
};

/** Open invitations — the roster's "Invited" rows until each one is accepted. */
export function useInvitations(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: invitationKeys.list(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.invitations.list, {
        query: { organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedInvitations.parse(res.body);
    },
  });
}

export function useCreateInvitation(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateInvitationInputT) => {
      const res = await apiRequest(routes.invitations.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Invitation.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useRevokeInvitation(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.invitations.revoke, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

/** PUBLIC — what the accept screen may show before any session exists. */
export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation-preview', token],
    enabled: token !== '',
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.invitations.preview, { body: { token }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return InvitationPreview.parse(res.body);
    },
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await apiRequest(routes.invitations.accept, { body: { token } });
      if (res.status !== 201) fail(res.status, res.body);
      return res.body as { organization_id: string; membership_id: string };
    },
    onSuccess: () => queryClient.clear(),
  });
}
