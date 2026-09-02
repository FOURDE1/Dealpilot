import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lender, type CreateLenderInputT, type UpdateLenderInputT } from '@dealpilot/schemas';
import { z } from 'zod';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/**
 * F-80 — the lender registry hooks (the lost-reason-api.ts family).
 *
 * The list GET requires `organization_id` (the API 400s `organization_required`
 * without it — f53 shape), so callers pass the RESOLVED org id, never the
 * multiOrg-ternary `undefined` (A10): the hook simply disables until the org is
 * known. Management screens ask `includeInactive: true` (deactivated lenders
 * keep their history and their name on every render site); pick-lists for NEW
 * choices filter client-side.
 */
const Page = z.object({ items: z.array(Lender), next_cursor: z.string().nullable() });

export const lenderKeys = {
  all: ['lenders'] as const,
  list: (orgId: string | undefined, includeInactive: boolean) =>
    ['lenders', orgId ?? 'no-org', includeInactive] as const,
};

export function useLenders(
  orgId: string | undefined,
  opts?: { enabled?: boolean; includeInactive?: boolean },
) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: lenderKeys.list(orgId, includeInactive),
    enabled: (opts?.enabled ?? true) && orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.lenders.list, {
        query: {
          organization_id: orgId,
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

export function useCreateLender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLenderInputT) => {
      const res = await apiRequest(routes.lenders.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return Lender.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: lenderKeys.all }),
  });
}

/** `active: false` IS the deactivate; `active: true` reactivates (R15). */
export function useUpdateLender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateLenderInputT & { id: string }) => {
      const res = await apiRequest(routes.lenders.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return Lender.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: lenderKeys.all }),
  });
}
