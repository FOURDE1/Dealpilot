import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DuplicatePair, LeadDuplicate, type LeadDuplicateT } from '@dealpilot/schemas';
import { z } from 'zod';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { leadKeys } from './api.js';

const Page = z.object({ items: z.array(DuplicatePair), next_cursor: z.string().nullable() });

export const duplicateKeys = {
  all: ['duplicates'] as const,
  list: (orgId: string | undefined, status: string, leadId?: string) =>
    ['duplicates', orgId ?? 'single-org', status, leadId ?? 'any'] as const,
};

export function useDuplicates(
  orgId: string | undefined,
  opts: { status?: LeadDuplicateT['status']; leadId?: string; cursor?: string; enabled?: boolean },
) {
  return useQuery({
    queryKey: [...duplicateKeys.list(orgId, opts.status ?? 'any', opts.leadId), opts.cursor ?? ''],
    enabled: (opts.enabled ?? true) && orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.duplicates.list, {
        query: {
          organization_id: orgId,
          status: opts.status,
          lead_id: opts.leadId,
          cursor: opts.cursor,
          limit: 50,
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Page.parse(res.body);
    },
  });
}

function useResolveMutation(action: 'merge' | 'dismiss') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.duplicates[action], { params: { id } });
      if (res.status !== 200) fail(res.status, res.body);
      return LeadDuplicate.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
      // A merge rewrites both leads AND re-points their children, and the
      // retired source enters the be-back population — every one of those
      // caches lies now.
      for (const key of [leadKeys.all, ['activity'], ['beback'], ['appointments'], ['deals'], ['conversations']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useMergePair() {
  return useResolveMutation('merge');
}

export function useDismissPair() {
  return useResolveMutation('dismiss');
}
