import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LostReason,
  type CreateLostReasonInputT,
  type UpdateLostReasonInputT,
} from '@dealpilot/schemas';
import { z } from 'zod';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const Page = z.object({ items: z.array(LostReason), next_cursor: z.string().nullable() });

export const lostReasonKeys = {
  all: ['lost-reasons'] as const,
  list: (orgId: string | undefined, includeInactive: boolean, storeId: string | undefined) =>
    ['lost-reasons', orgId ?? 'single-org', includeInactive, storeId ?? 'org-wide'] as const,
};

export function useLostReasons(
  orgId: string | undefined,
  opts?: { enabled?: boolean; includeInactive?: boolean; storeId?: string },
) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: lostReasonKeys.list(orgId, includeInactive, opts?.storeId),
    enabled: (opts?.enabled ?? true) && orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.lostReasons.list, {
        query: {
          organization_id: orgId,
          store_id: opts?.storeId,
          limit: 100,
          include_inactive: includeInactive ? 'true' : undefined,
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Page.parse(res.body);
    },
  });
}

export function useCreateLostReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLostReasonInputT) => {
      const res = await apiRequest(routes.lostReasons.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return LostReason.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: lostReasonKeys.all }),
  });
}

export function useUpdateLostReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateLostReasonInputT & { id: string }) => {
      const res = await apiRequest(routes.lostReasons.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return LostReason.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: lostReasonKeys.all }),
  });
}

export function useDeleteLostReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.lostReasons.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: lostReasonKeys.all }),
  });
}
